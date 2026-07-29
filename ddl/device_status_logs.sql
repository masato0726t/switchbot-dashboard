-- センサーログ。SwitchBot のデータ収集側が管理するテーブル。
-- ダッシュボードは参照のみで、このファイルは収集側スキーマの参考用（自動実行はしない）。
-- status_data の JSON 例: { "temperature": 24.9, "humidity": 55, "CO2": 718 }
-- idx_device_recorded: (device_id, recorded_at) の複合索引。device_id の等値条件を
-- 持つクエリのフルスキャン + filesort を救う想定で追加したが、ダッシュボードの表示窓
-- クエリは device_id の等値条件を持たず JSON_LENGTH/JSON_EXTRACT という sargable でない
-- 述語も伴うため、実測ではこの索引は選ばれず type: ALL / key: NULL のフルスキャンの
-- ままである（回帰ではなく索引追加前からの性質）。実測手順・数値・関連テストは
-- docs/db-performance.md を参照。既存テーブルへの後付け手順も同ドキュメントに記載。
CREATE TABLE device_status_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id INT,
  status_data JSON,
  recorded_at DATETIME,
  INDEX idx_device_recorded (device_id, recorded_at)
);
