require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const { windowClause } = require('./lib/ranges');
const { buildSensorData } = require('./lib/transform');
const log = require('./lib/logger');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// ダッシュボードが扱う有効なセンサー行だけに絞る共通フィルタ。
// 総件数の集計と表示窓の抽出で必ず同じ条件を使い、件数の整合を保つ。
const SENSOR_LOG_FILTER = `JSON_LENGTH(l.status_data) > 0
          AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL`;

// 全リクエストのアクセスログ。完了時にステータスと所要時間を出力する。
app.use((req, res, next) => {
  const start = Date.now();
  log.info(`--> ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    log.info(`<-- ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sensor-data', async (req, res) => {
  const t0 = Date.now();
  const { range, offset } = req.query;
  log.info('sensor-data リクエスト受信', { range: range ?? '(default)', offset: offset ?? 0 });

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    log.debug(`DB 接続確立 (${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);

    const [devices] = await conn.query(
      `SELECT id, device_name, device_type FROM devices WHERE is_virtual_infrared = 0 ORDER BY id`
    );
    log.debug(`デバイス取得: ${devices.length} 件`);

    // 全期間の総件数（表示範囲・offset に依存しない DB 行数）をデバイス別に集計。
    const [totalRows] = await conn.query(
      `SELECT l.device_id, COUNT(*) AS total
         FROM device_status_logs l
        WHERE ${SENSOR_LOG_FILTER}
        GROUP BY l.device_id`
    );
    const totals = {};
    for (const r of totalRows) totals[r.device_id] = Number(r.total);

    const { clause, params } = windowClause(range, offset);

    const [logs] = await conn.query(
      `SELECT
        l.device_id,
        l.status_data,
        l.recorded_at
       FROM device_status_logs l
       WHERE ${SENSOR_LOG_FILTER}
         ${clause}
       ORDER BY l.device_id, l.recorded_at ASC`,
      params
    );
    log.debug(`ログ取得: ${logs.length} 行`);

    const result = buildSensorData(devices, logs, totals);
    log.info(`sensor-data 応答`, {
      devices: result.length,
      logs: logs.length,
      points: result.reduce((sum, d) => sum + d.data.length, 0),
      ms: Date.now() - t0,
    });
    res.json(result);
  } catch (err) {
    log.error('sensor-data 処理に失敗', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

const server = app.listen(PORT, () => {
  log.info(`SwitchBot ダッシュボード起動: http://localhost:${PORT} (pid ${process.pid})`);
});

// PM2 の reload / stop（SIGINT・SIGTERM）で接続を捌き切ってから終了する。
function shutdown(signal) {
  log.info(`${signal} を受信、graceful shutdown 開始`);
  server.close((err) => {
    if (err) {
      log.error('server.close でエラー', err);
      process.exit(1);
    }
    log.info('全接続をクローズ、プロセス終了');
    process.exit(0);
  });
  // 既存接続が残って閉じ切れない場合に備えた強制終了の保険。
  setTimeout(() => {
    log.warn('graceful shutdown がタイムアウト、強制終了');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 想定外のエラーも握りつぶさずログに残す。
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));
process.on('uncaughtException', (err) => log.error('uncaughtException', err));
