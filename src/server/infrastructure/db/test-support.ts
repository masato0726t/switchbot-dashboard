// 統合テスト用の MySQL コンテナ。ddl/ の 3 ファイルをそのまま適用するので、
// 本番と同じスキーマ（索引を含む）に対して検証できる。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { sql } from 'kysely';
import { createDb, type Db } from './create-db.js';

const DDL_DIR = fileURLToPath(new URL('../../../../ddl/', import.meta.url));

export interface SeedRow {
  deviceId: number;
  /** 現在時刻から何分前の測定か（時間窓のテストで境界を作るのに使う） */
  minutesAgo: number;
  status: Record<string, unknown>;
}

export interface TestMysql {
  db: Db;
  seedDevices: (devices: { id: number; name: string; type: string; virtual?: boolean }[]) => Promise<void>;
  seedLogs: (rows: SeedRow[]) => Promise<void>;
  truncate: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startMysql(): Promise<TestMysql> {
  const container: StartedMySqlContainer = await new MySqlContainer('mysql:8.0')
    .withDatabase('switchbot_db')
    .withUsername('dash')
    .withUserPassword('dash')
    .start();

  const { db, close } = createDb({
    host: container.getHost(),
    port: container.getPort(),
    user: 'dash',
    password: 'dash',
    database: 'switchbot_db',
    poolLimit: 5,
  });

  for (const file of ['devices.sql', 'device_status_logs.sql', 'device_settings.sql']) {
    await sql.raw(await readFile(`${DDL_DIR}${file}`, 'utf8')).execute(db);
  }

  return {
    db,
    async seedDevices(devices) {
      await db.insertInto('devices').values(devices.map((d) => ({
        id: d.id,
        device_name: d.name,
        device_type: d.type,
        is_virtual_infrared: d.virtual ? 1 : 0,
      }))).execute();
    },
    async seedLogs(rows) {
      await db.insertInto('device_status_logs').values(rows.map((r) => ({
        device_id: r.deviceId,
        status_data: JSON.stringify(r.status),
        recorded_at: sql<Date>`DATE_SUB(NOW(), INTERVAL ${r.minutesAgo} MINUTE)`,
      }))).execute();
    },
    async truncate() {
      for (const table of ['device_status_logs', 'device_settings', 'devices'] as const) {
        await sql.raw(`TRUNCATE TABLE ${table}`).execute(db);
      }
    },
    async stop() {
      await close();
      await container.stop();
    },
  };
}
