require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const { rangeClause } = require('./lib/ranges');
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

    const [logs] = await conn.query(
      `SELECT
        l.device_id,
        l.status_data,
        l.recorded_at
       FROM device_status_logs l
       WHERE JSON_LENGTH(l.status_data) > 0
         AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL
         ${rangeClause(req.query.range)}
       ORDER BY l.device_id, l.recorded_at ASC`
    );

    res.json(buildSensorData(devices, logs));
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
