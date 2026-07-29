import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { sql } from 'kysely';
import { applySettingsDdl } from '../ddl-runner.js';
import { createDeviceRepository } from './device.repository.js';
import { createSensorLogRepository } from './sensor-log.repository.js';
import { startMysql, type TestMysql } from './test-support.js';
import { fileURLToPath } from 'node:url';

let mysql: TestMysql;

beforeAll(async () => { mysql = await startMysql(); });
afterAll(async () => { await mysql?.stop(); });

beforeEach(async () => {
  await mysql.truncate();
  await mysql.seedDevices([
    { id: 1, name: 'リビング', type: 'WoIOSensor' },
    { id: 2, name: '書斎', type: 'MeterPro(CO2)' },
    { id: 3, name: 'エアコン', type: 'Virtual', virtual: true },
  ]);
});

describe('DeviceRepository', () => {
  test('仮想赤外線デバイスを除いた一覧を id 順で返す', async () => {
    const devices = await createDeviceRepository(mysql.db).listSensorDevices();
    expect(devices.map((d) => d.id)).toEqual([1, 2]);
    expect(devices[0]).toEqual({ id: 1, name: 'リビング', type: 'WoIOSensor', placement: null });
  });

  test('設置場所を挿入し、二度目は更新する', async () => {
    const repo = createDeviceRepository(mysql.db);
    await repo.savePlacement(1, 'outdoor');
    expect((await repo.listSensorDevices())[0]!.placement).toBe('outdoor');

    await repo.savePlacement(1, 'indoor');
    expect((await repo.listSensorDevices())[0]!.placement).toBe('indoor');

    const rows = await mysql.db.selectFrom('device_settings').selectAll().execute();
    expect(rows).toHaveLength(1);   // 重複行を作らない
  });
});

describe('SensorLogRepository', () => {
  beforeEach(async () => {
    await mysql.seedLogs([
      { deviceId: 1, minutesAgo: 10,     status: { temperature: 24.9, humidity: 55 } },
      { deviceId: 1, minutesAgo: 100,    status: { temperature: 23.0, humidity: 57 } },   // 1h 窓の外
      { deviceId: 1, minutesAgo: 60 * 30, status: { temperature: 10.0, humidity: 70 } },  // 24h 窓の外
      { deviceId: 2, minutesAgo: 5,      status: { temperature: 22.0, humidity: 60, CO2: 718, battery: 88 } },
      { deviceId: 2, minutesAgo: 5,      status: {} },                                     // 温度なし → 除外
      { deviceId: 2, minutesAgo: 5,      status: { humidity: 60 } },                       // 温度なし → 除外
    ]);
  });

  test('1h の窓には直近 1 時間の測定だけが入る', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('1h', 0);
    expect(readings.map((r) => r.temperature)).toEqual([24.9, 22.0]);
  });

  test('24h の窓には 24 時間以内の測定が入る', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('24h', 0);
    expect(readings.filter((r) => r.deviceId === 1).map((r) => r.temperature)).toEqual([23.0, 24.9]);
  });

  test('offset=1 は 1 区間ぶん過去の窓を返す', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('1h', 1);
    expect(readings.map((r) => r.temperature)).toEqual([23.0]);   // 100 分前だけ
  });

  test("'all' は全期間を返し、offset を無視する", async () => {
    const repo = createSensorLogRepository(mysql.db);
    expect(await repo.listReadings('all', 0)).toHaveLength(4);
    expect(await repo.listReadings('all', 5)).toHaveLength(4);
  });

  test('device_id・recorded_at の昇順で返る', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('all', 0);
    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1]!, cur = readings[i]!;
      expect(cur.deviceId > prev.deviceId || (cur.deviceId === prev.deviceId && cur.ts >= prev.ts)).toBe(true);
    }
  });

  test('CO2 / battery を持つ行だけがその値を持つ', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('1h', 0);
    const study = readings.find((r) => r.deviceId === 2)!;
    expect(study.co2).toBe(718);
    expect(study.battery).toBe(88);
    const living = readings.find((r) => r.deviceId === 1)!;
    expect('co2' in living).toBe(false);
  });

  test('総件数は窓に依存せず、窓クエリと同じフィルタで数える', async () => {
    const totals = await createSensorLogRepository(mysql.db).countByDevice();
    expect(totals.get(1)).toBe(3);   // 温度を持つ 3 行すべて
    expect(totals.get(2)).toBe(1);   // 温度なしの 2 行は除外
  });

  test('窓クエリが idx_device_recorded を使う', async () => {
    const plan = await sql<{ key: string | null }>`
      EXPLAIN SELECT l.device_id FROM device_status_logs l
       WHERE l.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY l.device_id, l.recorded_at
    `.execute(mysql.db);
    expect(plan.rows[0]!.key).toBe('idx_device_recorded');
  });
});

describe('applySettingsDdl', () => {
  test('二度実行してもエラーにならない（冪等）', async () => {
    const ddlDir = fileURLToPath(new URL('../../../../ddl', import.meta.url));
    await applySettingsDdl(mysql.db, ddlDir);
    await expect(applySettingsDdl(mysql.db, ddlDir)).resolves.toBeUndefined();
  });
});
