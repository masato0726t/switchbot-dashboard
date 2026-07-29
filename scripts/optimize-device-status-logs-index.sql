-- device_status_logs の索引を実測に基づいて置き換える手動マイグレーション。
--
-- 実行方法（本番の DB に対して実行する。ダッシュボードは自動実行しない）:
--   mysql -h <DB_HOST> -P <DB_PORT> -u <DB_USER> -p <DB_NAME> < scripts/optimize-device-status-logs-index.sql
--
-- このテーブルは SwitchBot のデータ収集側が管理している。索引の追加・削除は
-- 収集側の運用者と合意のうえで実行すること。とくに手順 2 は既存の索引を消すため、
-- 収集側が同じ索引に依存していないことを先に確認する必要がある（下記の注意を参照）。
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- なぜこの変更が必要か（実測値。MySQL 8.0 / 約 209 万行 / 4 デバイスで計測）
-- ---------------------------------------------------------------------------
--
-- ダッシュボードが発行するクエリは 2 種類ある。
--
--   A. 表示窓クエリ  … recorded_at で範囲を絞り、device_id, recorded_at で並べ替える。
--                      画面の更新ごと（既定 30 秒間隔）に実行される。
--   B. 総件数クエリ  … 時間窓を持たず、device_id ごとに全期間の件数を数える。
--                      TTL キャッシュ（既定 60 秒）越しに実行される。
--
-- 既存の複合索引 idx_device_recorded (device_id, recorded_at) は、この 2 つの
-- どちらにも効かない。それどころか B には有害である。
--
--   A: WHERE 句に device_id の等値条件が無いため、複合索引の先頭列が絞り込まれず
--      レンジスキャンに使えない。オプティマイザはフルスキャン + filesort を選ぶ。
--
--   B: GROUP BY device_id に対して複合索引が並び順を提供するため、オプティマイザは
--      索引フルスキャン（type: index）を選ぶ。しかし WHERE 句が必要とする
--      status_data は索引に含まれないので、索引エントリ 209 万件すべてで主キーへの
--      ランダムアクセスが発生する。テーブルを順次スキャンする方が圧倒的に速い。
--
-- 実測（3 回計測の代表値。バッファプールをウォームアップ後）:
--
--   構成                                A: 表示窓(24h)   B: 総件数
--   ---------------------------------  --------------  ----------
--   現状 idx_device_recorded のみ            2.365 s      50.2 s
--   推奨 idx_recorded_at のみ                0.013 s       3.0 s
--                                          (182 倍速)   (16.7 倍速)
--
-- 表示窓クエリのスキャン行数は 2,083,820 行 → 480 行になる。
--
-- 書き込み側への影響: recorded_at は単調増加なので、追加する索引は常に B ツリーの
-- 右端に追記され、挿入コストはほぼ増えない。むしろ手順 2 で索引が 1 つ減るぶん、
-- 収集側の INSERT は現状より軽くなる。

-- ---------------------------------------------------------------------------
-- 手順 1: recorded_at の単独索引を追加する（必須）
-- ---------------------------------------------------------------------------
--
-- ALGORITHM=INPLACE, LOCK=NONE により、実行中も読み書きをブロックしない。
-- MySQL 8.0 の既定でもこの動作になるが、意図を明示するため指定する。
-- 万一この構文が拒否された場合は、そのサーバーではオンライン DDL が使えない
-- ということなので、収集が止まっている時間帯に実行し直すこと。
--
-- range=all（時間窓なし）ではこの索引も使われないが、それは全行を読む以上
-- 正しい選択であり、問題ではない。

ALTER TABLE device_status_logs
  ADD INDEX idx_recorded_at (recorded_at),
  ALGORITHM=INPLACE, LOCK=NONE;

-- ---------------------------------------------------------------------------
-- 手順 2: 複合索引を削除する（推奨。ただし収集側の確認が必要）
-- ---------------------------------------------------------------------------
--
-- ★★ 実行前に必ず確認すること ★★
--
-- idx_device_recorded はダッシュボードのどのクエリも利用しておらず、総件数クエリを
-- 15 倍以上遅くしている。ダッシュボードの観点では削除が正しい。
--
-- ただしこのテーブルは収集側が管理しており、収集側のプログラムが
-- 「特定デバイスの直近データを引く」ような device_id の等値条件を持つクエリを
-- 発行している場合、この索引はそちらで有効に働いている可能性がある。
--
-- 収集側のクエリを確認できない場合は、手順 2 を実行せず手順 1 だけを適用しても
-- よい。その場合でも表示窓クエリは 182 倍速くなる（総件数クエリは遅いままだが
-- TTL キャッシュ越しなので画面の体感には出にくい）。
--
-- 削除するときは下の行のコメントを外して実行する。

-- ALTER TABLE device_status_logs
--   DROP INDEX idx_device_recorded,
--   ALGORITHM=INPLACE, LOCK=NONE;

-- ---------------------------------------------------------------------------
-- 手順 3: 結果を確認する
-- ---------------------------------------------------------------------------

SELECT '--- 索引の一覧 ---' AS '';
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_status_logs'
 GROUP BY INDEX_NAME;

SELECT '--- 表示窓クエリ(24h) の実行計画。type=range / key=idx_recorded_at になれば成功 ---' AS '';
EXPLAIN SELECT l.device_id, l.status_data, l.recorded_at
  FROM device_status_logs l
 WHERE (JSON_LENGTH(l.status_data) > 0
        AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL)
   AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
 ORDER BY l.device_id, l.recorded_at ASC;

SELECT '--- 総件数クエリの実行計画。手順2を実行した場合 type=ALL になるのが正しい ---' AS '';
EXPLAIN SELECT l.device_id, COUNT(*) AS total
  FROM device_status_logs l
 WHERE (JSON_LENGTH(l.status_data) > 0
        AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL)
 GROUP BY l.device_id;
