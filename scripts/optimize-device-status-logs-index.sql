-- device_status_logs に表示窓クエリ用の索引を追加する手動マイグレーション。
--
-- 実行方法（本番の DB に対して実行する。ダッシュボードは自動実行しない）:
--   mysql -h <DB_HOST> -P <DB_PORT> -u <DB_USER> -p <DB_NAME> < scripts/optimize-device-status-logs-index.sql
--
-- このテーブルは SwitchBot のデータ収集側が管理している。索引の追加は収集側の
-- 運用者と合意のうえで実行すること。
--
-- 適用済みかどうかは手順 2 の出力（索引一覧に idx_recorded_at があるか）で分かる。
-- すでに適用済みの環境で再実行すると手順 1 が「Duplicate key name」で失敗するので、
-- その場合は手順 1 を飛ばして手順 2 だけを実行してよい。
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- なぜこの索引が必要か
-- ---------------------------------------------------------------------------
--
-- ダッシュボードが発行するクエリは 2 種類ある。
--
--   A. 表示窓クエリ  … recorded_at で範囲を絞り、device_id, recorded_at で並べ替える。
--                      画面の更新ごと（既定 30 秒間隔）に実行される。
--   B. 総件数クエリ  … 時間窓を持たず、device_id ごとに全期間の件数を数える。
--                      TTL キャッシュ（既定 60 秒）越しに実行される。
--
-- 既存の複合索引 idx_device_recorded (device_id, recorded_at) は A に効かない。
-- A の WHERE 句には device_id の等値条件が無く、複合索引の先頭列が絞り込まれない
-- ためレンジスキャンに使えないからである。索引が無いのと同じくフルスキャン +
-- filesort になる。
--
-- recorded_at の単独索引を足すと A はレンジスキャンになる。約 209 万行の検証環境で
-- 24 時間窓の応答が 2.365 秒 → 0.013 秒（182 倍）、スキャン行数が 2,083,820 行 →
-- 480 行になった。
--
-- 書き込み側への影響: recorded_at は単調増加するので、この索引は常に B ツリーの
-- 右端に追記される。挿入コストはほぼ増えない。

-- ---------------------------------------------------------------------------
-- 手順 1: recorded_at の単独索引を追加する
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
-- idx_device_recorded は削除しないこと
-- ---------------------------------------------------------------------------
--
-- 複合索引 idx_device_recorded は B（総件数クエリ）を遅くしている。GROUP BY device_id
-- に対して索引が並び順を提供するためオプティマイザが索引スキャンを選ぶが、WHERE 句が
-- 必要とする status_data は索引に含まれないので、全件で主キーへのランダムアクセスが
-- 発生するためである。
--
-- それでも削除してはいけない理由が 2 つある。
--
--   1. 外部キー device_status_logs_ibfk_1 (device_id) → devices(id) の裏付け索引に
--      なっている。そのまま削除しようとすると MySQL が拒否する:
--        ERROR 1553 (HY000): Cannot drop index 'idx_device_recorded':
--        needed in a foreign key constraint
--
--   2. 外部キーを満たすために (device_id) 単独索引を先に足してから複合索引を落とす、
--      という回避策は効果が無い。209 万行で実測したところ総件数クエリは 51.1 秒 →
--      50.0 秒でほぼ変わらなかった。オプティマイザは単独索引でも同じ実行計画
--      （索引スキャン + ランダムアクセス）を選ぶ。
--
-- つまり外部キーがある限り B の実行計画は改善できない。B は TTL キャッシュ越しに
-- しか実行されないので、テーブルが十分小さいうちは実害が出ない。将来問題になった
-- 場合の選択肢は docs/db-performance.md を参照。

-- ---------------------------------------------------------------------------
-- 手順 2: 結果を確認する
-- ---------------------------------------------------------------------------

SELECT '--- 索引の一覧。idx_recorded_at があれば適用済み ---' AS '';
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_status_logs'
 GROUP BY INDEX_NAME;

SELECT '--- 表示窓クエリ(24h)。type=range / key=idx_recorded_at になれば成功 ---' AS '';
EXPLAIN SELECT l.device_id, l.status_data, l.recorded_at
  FROM device_status_logs l
 WHERE (JSON_LENGTH(l.status_data) > 0
        AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL)
   AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
 ORDER BY l.device_id, l.recorded_at ASC;

SELECT '--- 総件数クエリ。type=index のままだが上記のとおり改善手段が無い ---' AS '';
EXPLAIN SELECT l.device_id, COUNT(*) AS total
  FROM device_status_logs l
 WHERE (JSON_LENGTH(l.status_data) > 0
        AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL)
 GROUP BY l.device_id;
