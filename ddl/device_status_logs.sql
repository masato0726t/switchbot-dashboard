-- センサーログ。SwitchBot のデータ収集側が管理するテーブル。
-- ダッシュボードは参照のみで、このファイルは収集側スキーマの参考用（自動実行はしない）。
-- status_data の JSON 例: { "temperature": 24.9, "humidity": 55, "CO2": 718 }
--
-- idx_recorded_at: 表示窓クエリ（recorded_at の範囲で絞る）を救う索引。約 209 万行で
-- 実測したところ、この索引でスキャン行数が 2,083,820 → 480 行、24 時間窓の応答が
-- 2.365 秒 → 0.013 秒になった。
--
-- 以前ここにあった複合索引 (device_id, recorded_at) は削除した。表示窓クエリは
-- device_id の等値条件を持たないため先頭列が絞り込まれず使えないうえ、総件数クエリ
-- （GROUP BY device_id）ではオプティマイザが索引フルスキャンを選び、索引に無い
-- status_data を引くために全件で主キーへのランダムアクセスが発生して、順次スキャン
-- より 15 倍以上遅くなっていた（50.2 秒 → 3.0 秒）。
--
-- 既存テーブルへの適用手順と実測の詳細は docs/db-performance.md を参照。
-- 実行する SQL は scripts/optimize-device-status-logs-index.sql にある。
CREATE TABLE device_status_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id INT,
  status_data JSON,
  recorded_at DATETIME,
  INDEX idx_recorded_at (recorded_at)
);
