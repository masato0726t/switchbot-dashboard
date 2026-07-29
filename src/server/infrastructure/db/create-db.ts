// MySQL 接続の生成。接続はリクエスト毎に張り直さずプールで使い回す
// （TCP/認証ハンドシェイクを毎回払うのを避け、表示のレイテンシを下げる）。

import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { AppConfig } from '../../config.js';
import type { Database } from './schema.js';

export type Db = Kysely<Database>;

export function createDb(config: AppConfig['db']): { db: Db; close: () => Promise<void> } {
  const pool = createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.poolLimit,
    maxIdle: config.poolLimit,
  });

  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
  // destroy はプールごと閉じる。閉じ忘れるとプロセスが終了しない。
  return { db, close: () => db.destroy() };
}
