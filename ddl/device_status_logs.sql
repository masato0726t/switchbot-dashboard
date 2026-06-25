-- センサーログ。SwitchBot のデータ収集側が管理するテーブル。
-- ダッシュボードは参照のみで、このファイルは収集側スキーマの参考用（自動実行はしない）。
-- status_data の JSON 例: { "temperature": 24.9, "humidity": 55, "CO2": 718 }
CREATE TABLE device_status_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id INT,
  status_data JSON,
  recorded_at DATETIME
);
