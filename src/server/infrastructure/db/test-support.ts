// 統合テスト用の MySQL コンテナ。ddl/ をそのまま適用するので、本番と同じスキーマ
// （索引・外部キーを含む）に対して検証できる。外部キーの有無は実行計画の選択に
// 影響するため、簡略化したスキーマで代用しない。

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

  // 外部キーの依存順に適用する（api_accounts → devices → device_status_logs、
  // ac_control_rules → その子テーブル）。ac_*.sql は本番では制御ツールが作る
  // 参照用の写しだが、テストでは実物と同じスキーマに対して検証したいので適用する。
  for (const file of [
    'api_accounts.sql', 'devices.sql', 'device_status_logs.sql', 'device_settings.sql',
    'ac_control_rules.sql', 'ac_control_schedules.sql', 'ac_command_logs.sql',
  ]) {
    await sql.raw(await readFile(`${DDL_DIR}${file}`, 'utf8')).execute(db);
  }

  // devices.api_account_id は NOT NULL かつ外部キーなので、デバイスを入れる前に
  // 親行が要る。認証情報の列にはダミー値だけを入れる。
  await sql`INSERT INTO api_accounts (id, name, token, secret)
            VALUES (1, 'test', 'dummy-token', 'dummy-secret')`.execute(db);

  return {
    db,
    async seedDevices(devices) {
      await db.insertInto('devices').values(devices.map((d) => ({
        id: d.id,
        // 収集側が必須にしている列。ダッシュボードは参照しないので値は何でもよいが、
        // uq_account_device (api_account_id, device_id) が UNIQUE なので重複させない。
        api_account_id: 1,
        device_id: `dummy-${d.id}`,
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
      // 外部キーがあるので TRUNCATE は使えない（子行が無くても拒否される）。
      // 子 → 親の順に DELETE し、AUTO_INCREMENT は使わないので採番は戻さない。
      // ac_control_rules は devices を参照するため devices より先に消す。
      for (const table of [
        'ac_command_logs', 'ac_control_schedules', 'ac_control_rules',
        'device_status_logs', 'device_settings', 'devices',
      ] as const) {
        await sql.raw(`DELETE FROM ${table}`).execute(db);
      }
    },
    async stop() {
      await close();
      await container.stop();
    },
  };
}
