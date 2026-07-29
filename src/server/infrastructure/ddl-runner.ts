// ダッシュボード専用テーブルの DDL は ddl/ に外出しし、起動時に読み込んで実行する。
// データ収集側の devices / device_status_logs には触れず、device_settings だけを
// 自己管理する（利用者に手動マイグレーションを求めない）。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Db } from './db/create-db.js';

export async function applySettingsDdl(db: Db, ddlDir: string): Promise<void> {
  const ddl = await readFile(join(ddlDir, 'device_settings.sql'), 'utf8');
  await sql.raw(ddl).execute(db);
}
