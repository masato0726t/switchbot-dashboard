-- SwitchBot API のアカウント情報。データ収集側が管理するテーブル。
-- ダッシュボードはこのテーブルを一切参照しないが、devices が外部キーで参照しており
-- devices を作るには先に必要なため、参考用に置いてある（自動実行はしない）。
--
-- token / secret は認証情報なので、テストやローカル検証で投入する値は必ずダミーにする。
CREATE TABLE api_accounts (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL COMMENT 'アカウント識別名',
  token VARCHAR(255) NOT NULL COMMENT 'SwitchBot APIトークン',
  secret VARCHAR(255) NOT NULL COMMENT 'SwitchBot APIシークレット',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SwitchBot APIアカウント';
