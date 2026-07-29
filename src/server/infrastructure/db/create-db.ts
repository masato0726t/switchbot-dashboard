// MySQL 接続の生成。接続はリクエスト毎に張り直さずプールで使い回す
// （TCP/認証ハンドシェイクを毎回払うのを避け、表示のレイテンシを下げる）。

import {
  DummyDriver, Kysely, MysqlAdapter, MysqlDialect,
  MysqlIntrospector, MysqlQueryCompiler,
} from 'kysely';
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

/**
 * SQL のコンパイルだけを行うダミー DB。`DummyDriver` は接続もクエリ実行も
 * 一切行わず、`.execute()` してもエラーにはならず常に空の結果（0 行）を
 * 返すだけなので、使い道は `.compile()` で生成 SQL とバインド値を見ること
 * に限られる。
 *
 * `createDb` と取り違えて合成ルート（本番のクエリ実行経路）に紛れ込むと、
 * 例外で落ちて気づけるのではなく「クエリは成功するがデータが常に 0 件」
 * という気づきにくい壊れ方をする。テストファイル以外から import しないこと。
 */
export function createTestDb(): Db {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  });
}
