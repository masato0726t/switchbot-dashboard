require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const { windowClause } = require('./lib/ranges');
const { buildSensorData } = require('./lib/transform');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sensor-data', async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    const [devices] = await conn.query(
      `SELECT id, device_name, device_type FROM devices WHERE is_virtual_infrared = 0 ORDER BY id`
    );

    // 全期間の総件数（表示範囲・offset に依存しない DB 行数）をデバイス別に集計。
    // window 句のフィルタと条件を揃え、ダッシュボードが扱う有効なセンサー行のみ数える。
    const [totalRows] = await conn.query(
      `SELECT l.device_id, COUNT(*) AS total
         FROM device_status_logs l
        WHERE JSON_LENGTH(l.status_data) > 0
          AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL
        GROUP BY l.device_id`
    );
    const totals = {};
    for (const r of totalRows) totals[r.device_id] = Number(r.total);

    const { clause, params } = windowClause(req.query.range, req.query.offset);

    const [logs] = await conn.query(
      `SELECT
        l.device_id,
        l.status_data,
        l.recorded_at
       FROM device_status_logs l
       WHERE JSON_LENGTH(l.status_data) > 0
         AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL
         ${clause}
       ORDER BY l.device_id, l.recorded_at ASC`,
      params
    );

    res.json(buildSensorData(devices, logs, totals));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

app.listen(PORT, () => {
  console.log(`SwitchBot ダッシュボード: http://localhost:${PORT}`);
});
