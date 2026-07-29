-- センサーログ。SwitchBot のデータ収集側が管理するテーブル。
-- ダッシュボードは参照のみで、このファイルは収集側スキーマの参考用（自動実行はしない）。
-- status_data の JSON 例: { "temperature": 24.9, "humidity": 55, "CO2": 718 }
--
-- 索引について（実測の詳細は docs/db-performance.md を参照）:
--
--   idx_recorded_at (recorded_at)
--     表示窓クエリ（recorded_at の範囲で絞る）を救う索引。これが無いと全行フルスキャン
--     + filesort になる。本番実測で 24 時間窓が type: range になり 56 ms で返る。
--
--   idx_device_recorded (device_id, recorded_at)
--     表示窓クエリには効かない（WHERE に device_id の等値条件が無く先頭列を絞れない）。
--     さらに総件数クエリ（GROUP BY device_id）では索引スキャンが選ばれ、索引に無い
--     status_data を引くために全件で主キーへのランダムアクセスが発生して遅くなる。
--     ただし外部キー device_status_logs_ibfk_1 の裏付け索引でもあるため削除できない。
--     (device_id) 単独索引に置き換えても実行計画は変わらず改善しないことを実測済み。
CREATE TABLE device_status_logs (
  id BIGINT NOT NULL AUTO_INCREMENT,
  device_id INT NOT NULL COMMENT 'devices.id',
  status_data JSON NOT NULL COMMENT 'APIから取得したステータスデータ(JSON)',
  recorded_at DATETIME NOT NULL COMMENT 'データ収集日時',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_device_recorded (device_id, recorded_at),
  KEY idx_recorded_at (recorded_at),
  CONSTRAINT device_status_logs_ibfk_1 FOREIGN KEY (device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='デバイスステータス収集ログ';
