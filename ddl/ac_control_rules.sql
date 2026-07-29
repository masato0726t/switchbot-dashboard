-- エアコン自動制御ルール。
--
-- このテーブルの所有者は制御ツール auto-air-conditioner で、goose の
-- マイグレーション（internal/infra/mysql/migrations/）が作成する。
-- ここにあるのは参照用の写しで、ダッシュボードは起動時に実行しない
-- （devices / device_status_logs / api_accounts と同じ扱い）。
--
-- ダッシュボードのエアコン設定画面を使う前に、制御ツールを 1 回実行すること。
CREATE TABLE IF NOT EXISTS ac_control_rules (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    name                 VARCHAR(255) NOT NULL COMMENT 'ルール名',
    ac_device_id         INT          NOT NULL COMMENT 'devices.id（赤外線エアコン）',
    sensor_device_id     INT          NOT NULL COMMENT 'devices.id（基準にする温湿度計）',
    enabled              TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '自動制御の有効/無効',
    snooze_until         DATETIME     NULL COMMENT 'この時刻まで自動制御を停止',
    default_target_temp  TINYINT      NOT NULL DEFAULT 25 COMMENT '既定の目標温度(℃)',
    default_humidity_max TINYINT      NULL COMMENT '既定の湿度上限(%)。NULLなら湿度で運転しない',
    default_humidity_min TINYINT      NULL COMMENT '既定の湿度下限(%)。警告表示専用',
    temp_hysteresis      DECIMAL(2,1) NOT NULL DEFAULT 1.0 COMMENT '温度の許容幅(±℃)',
    humidity_hysteresis  TINYINT      NOT NULL DEFAULT 5 COMMENT '湿度の許容幅(%)',
    min_interval_min     INT          NOT NULL DEFAULT 10 COMMENT '最短操作間隔(分)',
    resend_interval_min  INT          NOT NULL DEFAULT 60 COMMENT '同一コマンドの再送間隔(分)。0なら再送しない',
    sensor_max_age_min   INT          NOT NULL DEFAULT 20 COMMENT 'センサー値の鮮度上限(分)',
    fan_speed            TINYINT      NOT NULL DEFAULT 1 COMMENT '1=自動 2=弱 3=中 4=強',
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ac_device (ac_device_id),
    FOREIGN KEY (ac_device_id)     REFERENCES devices(id),
    FOREIGN KEY (sensor_device_id) REFERENCES devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='エアコン自動制御ルール';
