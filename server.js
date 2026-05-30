require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

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
       ORDER BY l.device_id, l.recorded_at ASC`
    );

    const deviceMap = {};
    for (const d of devices) {
      deviceMap[d.id] = { name: d.device_name, type: d.device_type, data: [] };
    }

    for (const log of logs) {
      const dev = deviceMap[log.device_id];
      if (!dev) continue;
      const s = log.status_data;
      const entry = {
        time: new Date(log.recorded_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        temperature: s.temperature ?? null,
        humidity:    s.humidity    ?? null,
      };
      if (s.CO2 !== undefined) entry.co2 = s.CO2;
      dev.data.push(entry);
    }

    const result = Object.entries(deviceMap)
      .filter(([, v]) => v.data.length > 0)
      .map(([id, v]) => ({ device_id: Number(id), ...v }));

    res.json(result);
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
