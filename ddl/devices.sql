-- デバイス一覧。SwitchBot のデータ収集側が管理するテーブル。
-- ダッシュボードは参照のみで、このファイルは収集側スキーマの参考用（自動実行はしない）。
--
-- ダッシュボードが使うのは id / device_name / device_type / is_virtual_infrared の 4 列だけ。
-- 残りは収集側の都合の列で、参照していない。
-- device_id は SwitchBot API 上のデバイス ID（文字列）で、主キーの id とは別物。
CREATE TABLE devices (
  id INT NOT NULL AUTO_INCREMENT,
  api_account_id INT NOT NULL COMMENT 'api_accounts.id',
  device_id VARCHAR(255) NOT NULL COMMENT 'SwitchBot デバイスID',
  device_name VARCHAR(255) DEFAULT NULL COMMENT 'デバイス名',
  device_type VARCHAR(100) DEFAULT NULL COMMENT 'デバイス種別',
  hub_device_id VARCHAR(255) DEFAULT NULL COMMENT '接続先ハブのデバイスID',
  enable_cloud_service TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'クラウドサービス有効フラグ',
  is_virtual_infrared TINYINT(1) NOT NULL DEFAULT 0 COMMENT '仮想赤外線リモコンフラグ',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_device (api_account_id, device_id),
  CONSTRAINT devices_ibfk_1 FOREIGN KEY (api_account_id) REFERENCES api_accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SwitchBot デバイス情報';
