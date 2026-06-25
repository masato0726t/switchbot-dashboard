# DB パフォーマンスチューニング手順

Web 画面（`GET /api/sensor-data`）の表示が遅い場合の DB 側チューニング手順。
アプリ側の対策（総件数の TTL キャッシュ・コネクションプール）はすでにコードに
入っているため、ここでは残る最大要因である**インデックス追加**を扱う。

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

- `(device_id, recorded_at)` の順にすることで、`ORDER BY device_id, recorded_at`
  を索引順スキャンでまかない **filesort を解消**でき、表示窓の `recorded_at`
  範囲もデバイス単位のレンジスキャンになる。
- MySQL 8 の `ALTER TABLE ... ADD INDEX` は既定で **オンライン（`ALGORITHM=INPLACE`,
  `LOCK=NONE`）** で動くため、収集の書き込みを止めずに追加できる。
  明示するなら:

```sql
ALTER TABLE device_status_logs
  ADD INDEX idx_device_recorded (device_id, recorded_at),
  ALGORITHM=INPLACE, LOCK=NONE;
```

### 3. 効果を再確認

手順 1 の `EXPLAIN` を再実行し、`type` が `range`/`ref` になり
`Using filesort` が消えていることを確認する。

## 補足：JSON フィルタについて

`SENSOR_LOG_FILTER`（`JSON_LENGTH` / `JSON_EXTRACT`）は sargable でないため、
上記の索引でも JSON 条件自体は行評価のまま残る。ただし手順 2 の索引で
**評価対象の行が時間窓に絞られる**ため、表示窓クエリは十分速くなる。

総件数クエリ（時間窓なし＝全行に JSON 評価）は索引で速くできないため、
アプリ側で TTL キャッシュ（`server.js` の `getTotals` / `TOTALS_TTL_MS`、
既定 60 秒）して実行頻度を下げている。さらに削りたい場合の選択肢:

- JSON 値を**生成列（generated column）+ 索引**に切り出して sargable 化する
  （収集側スキーマ変更が必要）。
- 総件数をデバイス別サマリーテーブルに持たせ、収集時に更新する。

## 関連する環境変数

| 変数名 | 既定値 | 説明 |
|--------|--------|------|
| `DB_POOL_LIMIT` | `10` | コネクションプールの最大接続数（`lib/db.js`） |
| `TOTALS_TTL_MS` | `60000` | 総件数キャッシュの有効期間ミリ秒（`server.js`） |
