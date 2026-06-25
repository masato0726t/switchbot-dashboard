-- センサーログ。SwitchBot のデータ収集側が管理するテーブル。
-- ダッシュボードは参照のみで、このファイルは収集側スキーマの参考用（自動実行はしない）。
-- status_data の JSON 例: { "temperature": 24.9, "humidity": 55, "CO2": 718 }
-- idx_device_recorded: ダッシュボードの表示窓クエリ（recorded_at の範囲絞り込み +
-- device_id, recorded_at での並べ替え）をフルスキャン + filesort から救う索引。
-- 既存テーブルへの後付けは docs/db-performance.md の ALTER TABLE 手順を参照。
CREATE TABLE device_status_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id INT,
  status_data JSON,
  recorded_at DATETIME,
  INDEX idx_device_recorded (device_id, recorded_at)
);
