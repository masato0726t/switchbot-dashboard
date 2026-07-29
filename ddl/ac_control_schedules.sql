-- 時間帯別の目標値。
--
-- 所有者は制御ツール auto-air-conditioner。ここにあるのは参照用の写しで、
-- ダッシュボードは起動時に実行しない。
--
-- start_minute > end_minute は日跨ぎ（例 22:00〜07:00）を表す。終了は排他。
-- 同一ルール内で時間帯が重ならないことは、ダッシュボードの入力検証
-- （src/shared/ac-contract.ts）で保証する。
CREATE TABLE IF NOT EXISTS ac_control_schedules (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    rule_id      INT       NOT NULL COMMENT 'ac_control_rules.id',
    start_minute SMALLINT  NOT NULL COMMENT '開始(0-1439分, JST)',
    end_minute   SMALLINT  NOT NULL COMMENT '終了(0-1439分, 排他)。start>endは日跨ぎ',
    target_temp  TINYINT   NOT NULL COMMENT '目標温度(℃)',
    humidity_max TINYINT   NULL COMMENT '湿度上限(%)',
    humidity_min TINYINT   NULL COMMENT '湿度下限(%)。警告表示専用',
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rule (rule_id),
    FOREIGN KEY (rule_id) REFERENCES ac_control_rules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='時間帯別の目標値';
