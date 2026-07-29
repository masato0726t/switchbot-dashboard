-- 旧新の JSON 突き合わせ用のシード。ddl/ を適用したあとに実行する。

-- mysql クライアントは接続文字セットを（サーバー既定や実行環境によっては）
-- latin1 と解釈することがあり、その場合このファイルの UTF-8 バイト列を
-- 再エンコードしてデータを壊してしまう。呼び出し側のフラグに頼らずこの
-- ファイル単体で常に正しく動くよう、先頭で明示的に utf8mb4 を指定する。
SET NAMES utf8mb4;

INSERT INTO devices (id, device_name, device_type, is_virtual_infrared) VALUES
  (1, 'リビング', 'WoIOSensor',    0),
  (2, '書斎',     'MeterPro(CO2)', 0),
  (3, 'エアコン', 'Virtual',       1),
  (4, '物置',     NULL,            0);   -- device_type が NULL のデバイス

-- 1 分刻みで 3 日ぶんの測定を作る（24h の窓境界と offset の両方を跨がせる）。
INSERT INTO device_status_logs (device_id, status_data, recorded_at)
SELECT
  d.id,
  CASE d.id
    WHEN 1 THEN JSON_OBJECT('temperature', 20 + (n.i % 100) / 10, 'humidity', 50 + (n.i % 20), 'battery', 88)
    WHEN 2 THEN JSON_OBJECT('temperature', 22 + (n.i % 50) / 10, 'humidity', 60, 'CO2', 700 + (n.i % 300))
    ELSE JSON_OBJECT('temperature', 15 + (n.i % 30) / 10, 'humidity', 40)
  END,
  DATE_SUB(NOW(), INTERVAL n.i MINUTE)
FROM devices d
CROSS JOIN (
  SELECT a.i + b.i * 10 + c.i * 100 + e.i * 1000 AS i
  FROM (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
  CROSS JOIN (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
  CROSS JOIN (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) c
  CROSS JOIN (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3) e
) n
WHERE d.is_virtual_infrared = 0;

-- フィルタで除外されるべき行（温度なし・空 JSON）も混ぜる。
INSERT INTO device_status_logs (device_id, status_data, recorded_at) VALUES
  (1, JSON_OBJECT('humidity', 55), NOW()),
  (1, JSON_OBJECT(),               NOW());

-- 設置場所を明示的に持つデバイスと、持たないデバイスの両方を作る。
INSERT INTO device_settings (device_id, placement) VALUES (2, 'outdoor');
