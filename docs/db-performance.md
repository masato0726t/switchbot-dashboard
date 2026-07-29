# DB パフォーマンスチューニング手順

Web 画面（`GET /api/sensor-data`）の表示が遅い場合の DB 側チューニング手順。
アプリ側の対策（総件数の TTL キャッシュ・コネクションプール）はすでにコードに
入っているため、ここでは DB の索引を扱う。

**結論を先に書く。** `recorded_at` の単独索引を追加すると表示窓クエリが劇的に速く
なる（実測 182 倍）。一方、以前このドキュメントが推奨していた複合索引
`(device_id, recorded_at)` は表示窓クエリに効かないうえ、総件数クエリを 15 倍以上
遅くしていたため削除を推奨する。実行する SQL は
`scripts/optimize-device-status-logs-index.sql` にある。

## 背景

`device_status_logs` は収集側が管理するテーブルで、初期スキーマは主キーしか
索引を持たない。

```sql
CREATE TABLE device_status_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id INT,
  status_data JSON,
  recorded_at DATETIME
);
```

ダッシュボードが発行するクエリは 2 種類ある。

| | クエリ | 実行頻度 |
|---|---|---|
| **A. 表示窓** | `recorded_at` で範囲を絞り、`device_id, recorded_at` で並べ替える | 画面更新ごと（既定 30 秒） |
| **B. 総件数** | 時間窓を持たず `device_id` ごとに全期間の件数を数える | TTL キャッシュ（既定 60 秒）越し |

索引が無いと A は毎リクエストで全行フルスキャン + filesort になり、行数に比例して
遅くなる。

> このテーブルは「収集側管理・参照のみ」のため、ダッシュボード起動時の
> 自動 DDL（`ddl/device_settings.sql`）には**含めない**。索引の変更は
> 収集側の運用者と合意のうえで手動実行する。

## 実測

MySQL 8.0 / 約 209 万行 / 4 デバイス。バッファプールをウォームアップ後に 3 回計測した
代表値。

| 索引構成 | A: 表示窓(24h) | B: 総件数 |
|---|---|---|
| 主キーのみ（初期状態） | 2.365 s | 3.2 s |
| `idx_device_recorded (device_id, recorded_at)` のみ | 2.365 s | **50.2 s** |
| **`idx_recorded_at (recorded_at)` のみ（推奨）** | **0.013 s** | **3.0 s** |

表示窓クエリのスキャン行数は 2,083,820 行 → 480 行になる。

### なぜ複合索引は効かなかったのか

**A（表示窓）に効かない理由** — WHERE 句に `device_id` の等値条件が無い。複合索引は
先頭列が絞り込まれないとレンジスキャンに使えないため、`recorded_at` の範囲条件だけでは
利用できない。オプティマイザは `type: ALL` のフルスキャン + filesort を選ぶ。

**B（総件数）を遅くしていた理由** — `GROUP BY device_id` に対して複合索引が並び順を
提供するため、オプティマイザは索引フルスキャン（`type: index`）を選ぶ。ところが WHERE 句が
必要とする `status_data` は索引に含まれていないので、索引エントリ 209 万件すべてで主キーへの
ランダムアクセスが発生する。テーブルを順次スキャンする方が圧倒的に速い。

これは「索引を足せば速くなる」が成り立たない典型例で、**カバーしていない列を参照する
クエリでは索引フルスキャンが全表スキャンより遅くなりうる**という InnoDB の性質による。

### JSON フィルタについて

センサー行フィルタ `JSON_LENGTH(status_data) > 0 AND JSON_EXTRACT(...) IS NOT NULL` は
sargable でないため、どんな索引でも絞り込めない。ただし A では `recorded_at` の範囲で
候補行が数百件まで減ったあとに評価されるので、実質的な負荷にはならない。B では全行に
対して評価されるが、順次スキャンなので 3 秒程度で完了する（かつ TTL キャッシュ越し）。

## 手順

`scripts/optimize-device-status-logs-index.sql` をそのまま実行する。

```bash
mysql -h <DB_HOST> -P <DB_PORT> -u <DB_USER> -p <DB_NAME> \
  < scripts/optimize-device-status-logs-index.sql
```

このスクリプトは次を行う。

1. **`idx_recorded_at (recorded_at)` を追加**（必須）。`ALGORITHM=INPLACE, LOCK=NONE`
   なので実行中も読み書きをブロックしない
2. **`idx_device_recorded` の削除**（推奨・既定ではコメントアウト）。下記の確認を
   済ませてからコメントを外す
3. 索引一覧と両クエリの実行計画を表示して結果を確認

### 手順 2 を実行する前に確認すること

`idx_device_recorded` はダッシュボードのどのクエリも利用しておらず、総件数クエリを
遅くしているだけなので、ダッシュボードの観点では削除が正しい。

ただしこのテーブルは収集側が管理している。収集側のプログラムが「特定デバイスの直近
データを引く」ような `device_id` の等値条件を持つクエリを発行している場合、この索引は
そちらで有効に働いている可能性がある。**収集側のクエリを確認できない場合は手順 2 を
実行せず、手順 1 だけを適用してもよい。** その場合でも表示窓クエリは 182 倍速くなる。

### 期待される実行計画

```
-- A: 表示窓クエリ
type: range | key: idx_recorded_at | rows: 数百 | Extra: Using index condition; Using where; Using filesort

-- B: 総件数クエリ（手順 2 実行後）
type: ALL | key: NULL | Extra: Using where; Using temporary
```

A の `Using filesort` は残るが、対象が数百行なので無視できる。B が `type: ALL` に
なるのは**正しい状態**で、全行を数える以上フルスキャンが最速である。

## 書き込み側への影響

`recorded_at` は単調増加するので、追加する索引は常に B ツリーの右端に追記され、挿入
コストはほぼ増えない。手順 2 まで実行すると索引が 1 つ減るため、収集側の INSERT は
現状より軽くなる。

## 関連するテスト

`src/server/infrastructure/db/repositories.integration.test.ts` が Testcontainers で
実 MySQL を起動し、索引がスキーマに存在することと表示窓クエリが `EXPLAIN` 可能である
ことを検証する。実行計画そのもの（`type` / `key`）は固定していない。将来この
ドキュメントの手順で索引構成を改善したときにテストが落ちるのを避けるためで、実測値の
記録はこのドキュメントが担う。

## 関連する環境変数

| 変数 | 既定値 | 効果 |
|---|---|---|
| `TOTALS_TTL_MS` | 60000 | 総件数クエリの結果を使い回す時間。長くすると B の実行頻度が下がる |
| `DB_POOL_LIMIT` | 10 | コネクションプールの上限。接続確立のオーバーヘッドを避ける |
