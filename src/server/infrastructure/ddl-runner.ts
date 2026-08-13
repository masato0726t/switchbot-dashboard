// ダッシュボード専用テーブルの DDL は ddl/ に外出しし、起動時に読み込んで実行する。
// データ収集側の devices / device_status_logs には触れず、device_settings だけを
// 自己管理する（利用者に手動マイグレーションを求めない）。
//
// ただし CREATE TABLE IF NOT EXISTS は「呼び出し側から見て無害」なだけで、サーバー
// から見れば DDL そのもの。実行のたびに対象テーブルのメタデータロックを取り、
// binlog にも書かれる。さらにアプリの DB ユーザーに CREATE 権限を持たせ続ける
// 理由にもなる。テーブルが既にあるなら送らない。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Db } from './db/create-db.js';

/** 現在のデータベースに指定のベーステーブルが存在するか。 */
export async function tableExists(db: Db, table: string): Promise<boolean> {
  const result = await sql<{ n: number }>`
    SELECT COUNT(*) AS n
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ${table}
       AND table_type = 'BASE TABLE'
  `.execute(db);
  return Number(result.rows[0]?.n ?? 0) > 0;
}

export async function applySettingsDdl(db: Db, ddlDir: string): Promise<void> {
  if (await tableExists(db, 'device_settings')) return;
  const ddl = await readFile(join(ddlDir, 'device_settings.sql'), 'utf8');
  await sql.raw(ddl).execute(db);
}
