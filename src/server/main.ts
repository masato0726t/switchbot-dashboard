// 合成ルート。依存の生成と配線はここだけで行い、他の層は import で外界に触らない。

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import closeWithGrace from 'close-with-grace';
import 'dotenv/config';

import { makeGetSensorData } from './application/get-sensor-data.js';
import { makeSetDevicePlacement } from './application/set-device-placement.js';
import { loadConfig } from './config.js';
import { createDb } from './infrastructure/db/create-db.js';
import { createDeviceRepository } from './infrastructure/db/device.repository.js';
import { createSensorLogRepository } from './infrastructure/db/sensor-log.repository.js';
import { applySettingsDdl } from './infrastructure/ddl-runner.js';
import { createLogger } from './infrastructure/logger.js';
import { createTotalsCache } from './infrastructure/totals-cache.js';
import { createApp } from './presentation/create-app.js';

// dist/server/main.js（ビルド後）からも src/server/main.ts（tsx 実行）からも
// 2 階層上がるとリポジトリルートになる。
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel, config.nodeEnv !== 'production');

const { db, close: closeDb } = createDb(config.db);

const deviceRepository = createDeviceRepository(db);
const sensorLogRepository = createSensorLogRepository(db);
const totalsCache = createTotalsCache(config.totalsTtlMs);

const app = createApp({
  getSensorData: makeGetSensorData({
    devices: deviceRepository,
    logs: sensorLogRepository,
    totalsCache,
  }),
  setDevicePlacement: makeSetDevicePlacement({ devices: deviceRepository }),
  logger,
  // フロントエンドはまだ移行しておらず、ビルド後も public/ は dist/ 配下に
  // 生成されない。フロントエンド移行までは、リポジトリルート直下の
  // public/ をそのまま配信する。
  staticDir: join(ROOT, 'public'),
});

// 設置場所テーブルの用意を待ってから listen する。先に listen すると、
// テーブル作成完了前のリクエストで sensor-data の JOIN が失敗し得るため。
//
// ここで例外を投げずに握りつぶすのは意図的。DB の一時的な不在（再起動中・
// ネットワーク瞬断など）は自力で回復する種類の障害で、旧 server.cjs の
// ensureSettingsTable() も同じ判断でログのみ出して listen を続行していた。
// もしここで落とすと、PM2 は min_uptime 未満の再起動を「不安定」とみなし、
// max_restarts に達した時点で再起動自体を諦めて errored のまま停止する。
// 静的ファイルすら配信されなくなり、DB が復旧しても自動で戻らない全断に
// なってしまう。listen だけは続行させ、DB を使う各エンドポイントは
// 自分の try/catch で個別にクリーンな 500 を返す形に留める。
try {
  await applySettingsDdl(db, join(ROOT, 'ddl'));
  logger.info('device_settings テーブルを確認');
} catch (err) {
  logger.error({ err }, 'device_settings テーブルの確認に失敗');
}

const server = app.listen(config.port, () => {
  logger.info(`SwitchBot ダッシュボード起動: http://localhost:${config.port} (pid ${process.pid})`);
});

// PM2 の reload / stop（SIGINT・SIGTERM）と想定外の例外をまとめて捌く。
// HTTP を閉じ切ってから DB プールも解放する（残すとプロセスが終了しない）。
closeWithGrace({ delay: 10_000, logger }, async ({ err }) => {
  if (err) logger.error({ err }, '想定外のエラーで終了します');
  await new Promise<void>((resolve, reject) => {
    server.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
  });
  await closeDb();
  logger.info('全接続をクローズ、プロセス終了');
});
