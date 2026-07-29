-- デバイスの設置場所（室内 / 屋外）を保持するダッシュボード専用テーブル。
-- データ収集側の devices テーブルには触れず、ここで自己管理する。
-- src/server/main.ts が起動時に applySettingsDdl()（src/server/infrastructure/
-- ddl-runner.ts）経由でこのファイルを読み込んで実行する（手動マイグレーション不要）。
CREATE TABLE IF NOT EXISTS device_settings (
  device_id INT PRIMARY KEY,
  placement ENUM('indoor', 'outdoor') NOT NULL DEFAULT 'indoor'
);
