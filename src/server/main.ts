// 合成ルート。依存の生成と配線はここだけで行い、他の層は import で外界に触らない。

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import closeWithGrace from 'close-with-grace';
import 'dotenv/config';

import { makeGetAcCommandLogs, makeListAcDevices } from './application/get-ac-command-logs.js';
import { makeGetAcRules } from './application/get-ac-rules.js';
import { makeGetSensorData } from './application/get-sensor-data.js';
import { makeCreateAcRule, makeDeleteAcRule, makeUpdateAcRule } from './application/save-ac-rule.js';
import { makeSetAcRuleEnabled, makeSnoozeAcRule } from './application/set-ac-rule-state.js';
import { makeSetDevicePlacement } from './application/set-device-placement.js';
import { loadConfig } from './config.js';
import { createAcRuleRepository } from './infrastructure/db/ac-rule.repository.js';
import { createDb } from './infrastructure/db/create-db.js';
import { createDeviceRepository } from './infrastructure/db/device.repository.js';
import { createSensorLogRepository } from './infrastructure/db/sensor-log.repository.js';
import { applySettingsDdl } from './infrastructure/ddl-runner.js';
import { createLogger } from './infrastructure/logger.js';
import { createTotalsCache } from './infrastructure/totals-cache.js';
import { createApp } from './presentation/create-app.js';

// dist/server/main.js（ビルド後）からも src/server/main.ts（tsx 実行）からも
// 2 階層上がるとリポジトリルートになる。この下の public/・ddl/ 参照はどちらも
// ROOT（リポジトリルート）基準なので、本番配置は dist/ 単体では完結しない。
// public/・ddl/（と node_modules/）を含むリポジトリ全体を配置すること
// （README の「起動」節にも明記）。
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel, config.nodeEnv !== 'production');

const { db, close: closeDb } = createDb(config.db);

const deviceRepository = createDeviceRepository(db);
const sensorLogRepository = createSensorLogRepository(db);
const acRuleRepository = createAcRuleRepository(db);
const totalsCache = createTotalsCache(config.totalsTtlMs);

const app = createApp({
  getSensorData: makeGetSensorData({
    devices: deviceRepository,
    logs: sensorLogRepository,
    totalsCache,
  }),
  setDevicePlacement: makeSetDevicePlacement({ devices: deviceRepository }),
  ac: {
    getAcRules: makeGetAcRules({ acRules: acRuleRepository }),
    createAcRule: makeCreateAcRule({ acRules: acRuleRepository }),
    updateAcRule: makeUpdateAcRule({ acRules: acRuleRepository }),
    deleteAcRule: makeDeleteAcRule({ acRules: acRuleRepository }),
    setAcRuleEnabled: makeSetAcRuleEnabled({ acRules: acRuleRepository }),
    snoozeAcRule: makeSnoozeAcRule({ acRules: acRuleRepository }),
    getAcCommandLogs: makeGetAcCommandLogs({ acRules: acRuleRepository }),
    listAcDevices: makeListAcDevices({ acRules: acRuleRepository }),
  },
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

// PM2 の reload / stop（SIGINT・SIGTERM）と uncaughtException を捌いてプロセスを
// 終了する。unhandledRejection はここでは終了させず、`skip` で close-with-grace の
// 対象から外し、下の専用ハンドラでログのみ出して継続する。両者を分ける理由:
//
// - uncaughtException は同期的な例外が誰にも catch されずに投げられた状態で、
//   スタックやモジュール内部の状態がどこまで壊れているか保証できない。Node 自身も
//   uncaughtException 後にプロセスを継続させず再起動する運用を推奨しているため、
//   ここは従来どおり close-with-grace に任せて HTTP を閉じてから終了する。
// - unhandledRejection は事情が異なる。Promise の catch 漏れは 1 箇所のバグでも
//   起こり得るが、影響範囲は多くの場合その 1 件の非同期処理に閉じる。これだけで
//   プロセス全体を終了させると、上の「DDL 未適用時は listen を継続する」判断
//   （46-56 行目）が避けようとしたのと同じ壊れ方——PM2 が min_uptime 未満の
//   再起動を繰り返し max_restarts で諦めて errored のまま停止し、静的ファイルすら
//   配信されなくなる全断——を、旧 server.cjs には無かった障害モードとして
//   新たに持ち込んでしまう（旧実装は uncaughtException/unhandledRejection の
//   どちらもログのみ出して継続していた）。そのため unhandledRejection は
//   ログに残して握りつぶし、プロセスは生かし続ける。
// HTTP を閉じ切ってから DB プールも解放する（残すとプロセスが終了しない）。
process.on('unhandledRejection', (err) => {
  logger.error({ err }, '未処理の Promise rejection を検出（プロセスは継続します）');
});

closeWithGrace({ delay: 10_000, logger, skip: ['unhandledRejection'] }, async ({ err }) => {
  if (err) logger.error({ err }, '想定外の例外で終了します');
  await new Promise<void>((resolve, reject) => {
    server.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
  });
  await closeDb();
  logger.info('全接続をクローズ、プロセス終了');
});
