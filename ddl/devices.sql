-- デバイス一覧。SwitchBot のデータ収集側が管理するテーブル。
-- ダッシュボードは参照のみで、このファイルは収集側スキーマの参考用（自動実行はしない）。
CREATE TABLE devices (
  id INT PRIMARY KEY,
  device_name VARCHAR(255),
  device_type VARCHAR(255),
  is_virtual_infrared TINYINT(1)
);
