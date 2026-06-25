require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const { withConnection, closePool } = require('./lib/db');
const { windowClause } = require('./lib/ranges');
const { buildSensorData } = require('./lib/transform');
const { isValidPlacement } = require('./lib/placement');
const log = require('./lib/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// ダッシュボードが扱う有効なセンサー行だけに絞る共通フィルタ。
// 総件数の集計と表示窓の抽出で必ず同じ条件を使い、件数の整合を保つ。
const SENSOR_LOG_FILTER = `JSON_LENGTH(l.status_data) > 0
          AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL`;

// 総件数クエリは range/offset に依存せず全行を走査する重い集計で、JSON 関数の
// ため索引も効かない。値は新規ログでしか増えず変化が緩やかなので、TTL の間は
// 結果を使い回して実行頻度を下げる（UI は 30 秒ごとに更新するため毎回は不要）。
const TOTALS_TTL_MS = Number(process.env.TOTALS_TTL_MS) || 60_000;
let totalsCache = { value: null, at: 0 };

async function getTotals(conn) {
  const now = Date.now();
  if (totalsCache.value && now - totalsCache.at < TOTALS_TTL_MS) {
    log.debug('総件数キャッシュ命中');
    return totalsCache.value;
  }
  const [totalRows] = await conn.query(
    `SELECT l.device_id, COUNT(*) AS total
       FROM device_status_logs l
      WHERE ${SENSOR_LOG_FILTER}
      GROUP BY l.device_id`
  );
  const totals = {};
  for (const r of totalRows) totals[r.device_id] = Number(r.total);
  totalsCache = { value: totals, at: now };
  log.debug('総件数キャッシュ更新');
  return totals;
}

// 全リクエストのアクセスログ。完了時にステータスと所要時間を出力する。
app.use((req, res, next) => {
  const start = Date.now();
  log.info(`--> ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    log.info(`<-- ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ダッシュボード専用テーブルの DDL は ddl/ に外出しし、起動時に読み込んで実行する。
// データ収集側の devices テーブルには触れず、ここで自己管理する（手動マイグレーション不要）。
const DDL_DIR = path.join(__dirname, 'ddl');

async function ensureSettingsTable() {
  try {
    const ddl = fs.readFileSync(path.join(DDL_DIR, 'device_settings.sql'), 'utf8');
    await withConnection((conn) => conn.query(ddl));
    log.info('device_settings テーブルを確認');
  } catch (err) {
    log.error('device_settings テーブルの確認に失敗', err);
  }
}

app.get('/api/sensor-data', async (req, res) => {
  const t0 = Date.now();
  const { range, offset } = req.query;
  log.info('sensor-data リクエスト受信', { range: range ?? '(default)', offset: offset ?? 0 });

  try {
    const result = await withConnection(async (conn) => {
      const [devices] = await conn.query(
        `SELECT d.id, d.device_name, d.device_type, s.placement
           FROM devices d
           LEFT JOIN device_settings s ON s.device_id = d.id
          WHERE d.is_virtual_infrared = 0
          ORDER BY d.id`
      );
      log.debug(`デバイス取得: ${devices.length} 件`);

      // 全期間の総件数（表示範囲・offset に依存しない DB 行数）をデバイス別に集計。
      // 重い全行スキャンのため TTL キャッシュ経由で取得する。
      const totals = await getTotals(conn);

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

      const data = buildSensorData(devices, logs, totals);
      log.info(`sensor-data 応答`, {
        devices: data.length,
        logs: logs.length,
        points: data.reduce((sum, d) => sum + d.data.length, 0),
        ms: Date.now() - t0,
      });
      return data;
    });
    res.json(result);
  } catch (err) {
    log.error('sensor-data 処理に失敗', err);
    res.status(500).json({ error: err.message });
  }
});

// デバイスの設置場所（室内 / 屋外）を更新する。服装提案の室内 / 屋外の振り分けに使う。
app.put('/api/devices/:id/placement', async (req, res) => {
  const id = Number(req.params.id);
  const { placement } = req.body || {};
  if (!Number.isInteger(id) || !isValidPlacement(placement)) {
    log.warn('placement 更新の不正リクエスト', { id: req.params.id, placement });
    return res.status(400).json({ error: 'placement は indoor / outdoor のいずれか、id は整数が必要です' });
  }

  try {
    await withConnection((conn) => conn.query(
      `INSERT INTO device_settings (device_id, placement) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE placement = VALUES(placement)`,
      [id, placement]
    ));
    log.info('placement を更新', { device_id: id, placement });
    res.json({ device_id: id, placement });
  } catch (err) {
    log.error('placement 更新に失敗', err);
    res.status(500).json({ error: err.message });
  }
});

let server;

// 設置場所テーブルの用意を待ってから listen する。先に listen すると、
// テーブル作成完了前のリクエストで sensor-data の JOIN が失敗し得るため。
async function start() {
  await ensureSettingsTable();
  server = app.listen(PORT, () => {
    log.info(`SwitchBot ダッシュボード起動: http://localhost:${PORT} (pid ${process.pid})`);
  });
}

start();

// PM2 の reload / stop（SIGINT・SIGTERM）で接続を捌き切ってから終了する。
function shutdown(signal) {
  log.info(`${signal} を受信、graceful shutdown 開始`);
  // listen 前（テーブル準備中）にシグナルを受けた場合は即終了する。
  if (!server) {
    log.info('listen 前のため即終了');
    process.exit(0);
  }
  server.close(async (err) => {
    if (err) {
      log.error('server.close でエラー', err);
      process.exit(1);
    }
    // HTTP を閉じ切ってから DB プールも解放する。残すとプロセスが終了しない。
    try {
      await closePool();
    } catch (poolErr) {
      log.error('DB プールのクローズに失敗', poolErr);
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
