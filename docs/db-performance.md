# DB パフォーマンスチューニング手順

Web 画面（`GET /api/sensor-data`）の表示が遅い場合の DB 側チューニング手順。
アプリ側の対策（総件数の TTL キャッシュ・コネクションプール）はすでにコードに
入っているため、ここでは残る候補として**インデックス追加**を試みた経緯を扱う。

**結論を先に書く。** 実際に追加・実測した結果（下記「検証結果」参照）、この索引は
表示窓クエリにも総件数クエリにも効かなかった。`device_id` の等値条件を持たない
表示窓クエリはこの複合索引をレンジスキャンできず、総件数クエリはそもそも時間窓を
持たないため索引で絞り込めない。索引追加自体は `ddl/device_status_logs.sql` に
含まれておりスキーマ上は存在するが、**このドキュメントの手順だけで表示が速くなる
わけではない**。以下は当初の想定に基づく手順と、それが実測でどう裏切られたかの
記録である。

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

`/api/sensor-data` の表示窓クエリは `recorded_at` で範囲を絞り、
`device_id, recorded_at` で並べ替える。索引が無いと毎リクエストで
**全行フルスキャン + filesort** になり、行数に比例して遅くなる。

> このテーブルは「収集側管理・参照のみ」のため、ダッシュボード起動時の
> 自動 DDL（`ddl/device_settings.sql`）には**含めない**。索引追加は
> 収集側の運用者と合意のうえ、下記を手動で実行する。

## 手順

### 1. 現状の実行計画を確認（任意・効果測定用）

適用前後で比較すると効果が分かる。`type: ALL`（フルスキャン）や
`Using filesort` が出ていれば改善余地あり。

```sql
EXPLAIN
SELECT l.device_id, l.status_data, l.recorded_at
  FROM device_status_logs l
 WHERE JSON_LENGTH(l.status_data) > 0
   AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL
   AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
 ORDER BY l.device_id, l.recorded_at ASC;
```

### 2. 複合インデックスを追加

```sql
ALTER TABLE device_status_logs
  ADD INDEX idx_device_recorded (device_id, recorded_at);
```

- `(device_id, recorded_at)` の順にすることで、`device_id` の等値条件を持つ
  クエリであれば `ORDER BY device_id, recorded_at` を索引順スキャンでまかない
  filesort を解消し、`recorded_at` 範囲もデバイス単位のレンジスキャンにできる
  ——というのがこの索引を追加する動機（一般論）である。**ただし、この
  ダッシュボードの表示窓クエリ自体は `device_id` の等値条件を持たないため、
  この効果は実際には発生しない。** 詳しくは下記「検証結果」を参照。
- MySQL 8 の `ALTER TABLE ... ADD INDEX` は既定で **オンライン（`ALGORITHM=INPLACE`,
  `LOCK=NONE`）** で動くため、収集の書き込みを止めずに追加できる。
  明示するなら:

```sql
ALTER TABLE device_status_logs
  ADD INDEX idx_device_recorded (device_id, recorded_at),
  ALGORITHM=INPLACE, LOCK=NONE;
```

### 3. 効果を再確認（この手順は当初の期待であり、下記「検証結果」の実測では成立していない）

手順 1 の `EXPLAIN` を再実行し、`type` が `range`/`ref` になり
`Using filesort` が消えていることを**期待していた**。しかし下記「検証結果（Task 11:
Testcontainers での実測）」の通り、表示窓クエリでは実際には `type: ALL` / `key: NULL` の
ままで変化しないことを確認済み。索引追加の効果を判断する際は、この節の記述ではなく
実測結果の節を参照すること。

## 検証結果（Task 11: Testcontainers での実測）

上記手順 3 は「索引を追加すれば `type` が `range`/`ref` になる」ことを期待して
書かれていたが、実際に `idx_device_recorded` を含むスキーマ（`ddl/` をそのまま
適用）に対して手順 1 の `EXPLAIN` を実行したところ、**期待は成立しなかった**。

行数を増やす前の少数行（6 行）では確認に意味がないため、`device_status_logs`
に約 5,000 行投入した上で、手順 1 と全く同じ `EXPLAIN`（`status_data` を含む
SELECT・`JSON_LENGTH`/`JSON_EXTRACT` 述語つき）を実行した結果:

```
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+
| id | select_type | table | partitions | type | possible_keys | key  | key_len | ref  | rows | filtered | Extra                       |
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+
|  1 | SIMPLE      | l     | NULL       | ALL  | NULL          | NULL | NULL    | NULL | 5000 |    33.33 | Using where; Using filesort |
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+
```

`type: ALL`・`key: NULL`・`Using filesort` のままで、索引 `idx_device_recorded`
は選ばれない。理由は次の2点:

- クエリに `device_id` の等値条件が無い（全デバイスの行を横断して取得する）ため、
  複合索引 `(device_id, recorded_at)` を `recorded_at` だけでレンジスキャンする
  ことができない。
- `JSON_LENGTH` / `JSON_EXTRACT` の述語は sargable でなく、索引だけでは評価できない。

**これは今回の移行（`server.cjs` → Kysely）が生んだ回帰ではない。** 同じ
`EXPLAIN` を旧 `server.cjs`（`SENSOR_LOG_FILTER` + `windowClause` が組み立てる、
文字列として同一の SQL）に対しても実行し、新実装とまったく同じ実行計画
（`type: ALL` / `key: NULL` / `Using where; Using filesort`）になることを確認した。
つまり `idx_device_recorded` は手順1〜2の想定どおりには効いておらず、これは
索引追加前からこのクエリ形状が持っていた性質であり、Task 11 で初めて
Testcontainers を使って実測するまで検証されていなかった。

改善するには、上記いずれかの制約を崩す変更（例: デバイス別に分けてクエリする、
JSON 値を生成列に切り出して索引化する等）が必要で、収集側スキーマとの調整を
伴うためこのドキュメントの範囲を超える。対応要否の判断は別途行う。

このため `src/server/infrastructure/db/repositories.integration.test.ts` の
該当テスト（`listReadings 相当のクエリが EXPLAIN 可能で、索引
idx_device_recorded がスキーマに存在する`）は、repository と同じ
ビルディングブロック（`hasSensorReading` / `applyWindow`）で組み立てた
本番同等の SQL を実データに対して `EXPLAIN` 実行し、それが構文的に妥当で
実行できること、そして「索引 `idx_device_recorded` がスキーマ上に存在すること」
（`SHOW INDEX FROM device_status_logs`）の 2 点だけを検証する形にしている。
`type` / `key` を特定の値（`ALL` / `NULL`）に固定するアサーションは意図的に
置いていない。すでに最悪の実行計画のため pin してもリグレッションは検出できず
（悪化しようがない）、唯一起こり得るのは将来ここが本当に改善されたときに
テストが失敗することだけになるためである。上記の実測プランはこの
ドキュメントとテスト内のコメントに記録している。

## 補足：JSON フィルタについて

`SENSOR_LOG_FILTER`（`JSON_LENGTH` / `JSON_EXTRACT`）は sargable でないため、
索引の有無にかかわらず JSON 条件自体は行ごとの評価のまま残る。

**当初の想定（この節の元々の記述）**: 手順 2 の索引があれば、少なくとも表示窓
クエリの評価対象行が `recorded_at` の時間範囲で絞られ、それだけでも十分速くなる
だろう、というものだった。

**実測（上記「検証結果（Task 11: Testcontainers での実測）」）**: この想定は
成立しなかった。表示窓クエリは `device_id` の等値条件を持たないため複合索引
`(device_id, recorded_at)` をレンジスキャンできず、`type: ALL` / `key: NULL` の
フルスキャンのままになる。フルスキャンでは全行を走査したうえで `recorded_at`
と JSON 条件を行ごとに評価するため、索引を追加しても走査行数・JSON 評価回数の
どちらも減らない。したがって「索引で評価対象行が絞られて速くなる」という
記述は誤りであり、ここで訂正する。

総件数クエリ（時間窓なし＝全行に JSON 評価）が索引で速くできない、という点は
上記の実測と当初の想定が一致しており、そのまま正しい。アプリ側で TTL キャッシュ
（`src/server/infrastructure/totals-cache.ts` / `TOTALS_TTL_MS`、既定 60 秒）して
実行頻度を下げているのはこのため。さらに削りたい場合の選択肢:

- JSON 値を**生成列（generated column）+ 索引**に切り出して sargable 化する
  （収集側スキーマ変更が必要）。表示窓クエリの `type: ALL` を解消するにも
  同様の対応が要る。
- 総件数をデバイス別サマリーテーブルに持たせ、収集時に更新する。

## 関連する環境変数

| 変数名 | 既定値 | 説明 |
|--------|--------|------|
| `DB_POOL_LIMIT` | `10` | コネクションプールの最大接続数（`src/server/infrastructure/db/create-db.ts`） |
| `TOTALS_TTL_MS` | `60000` | 総件数キャッシュの有効期間ミリ秒（`src/server/infrastructure/totals-cache.ts`） |
