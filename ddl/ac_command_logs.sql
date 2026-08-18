-- エアコン制御コマンドの送信履歴。
--
-- 所有者は制御ツール auto-air-conditioner。ここにあるのは参照用の写しで、
-- ダッシュボードは起動時に実行しない。
--
-- 実際に送信した回だけを記録する（見送った回は残さない。5 分ごとに
-- 「何もしなかった」行を積むと表が無意味に膨らむため）。制御ツールは
-- result='success' の最新行を「現在の運転状態」とみなす。
CREATE TABLE IF NOT EXISTS ac_command_logs (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    rule_id         INT          NOT NULL COMMENT 'ac_control_rules.id',
    executed_at     DATETIME     NOT NULL COMMENT '送信時刻',
    power           ENUM('on','off') NOT NULL COMMENT '送った電源状態',
    mode            TINYINT      NOT NULL COMMENT '送ったモード(2=冷房 3=ドライ 5=暖房)',
    target_temp     TINYINT      NOT NULL COMMENT '送った設定温度(℃)',
    fan_speed       TINYINT      NOT NULL COMMENT '送った風量',
    sensor_temp     DECIMAL(4,1) NULL COMMENT '判定時の室温',
    sensor_humidity DECIMAL(4,1) NULL COMMENT '判定時の湿度',
    outdoor_temp    DECIMAL(4,1) NULL COMMENT '判定時の外気温(℃)',
    reason          VARCHAR(255) NOT NULL COMMENT '送信理由',
    result          ENUM('success','failure') NOT NULL COMMENT 'API呼び出しの結果',
    error_message   TEXT         NULL COMMENT '失敗時のメッセージ',
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rule_executed (rule_id, executed_at),
    FOREIGN KEY (rule_id) REFERENCES ac_control_rules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='エアコン制御コマンドの送信履歴';
