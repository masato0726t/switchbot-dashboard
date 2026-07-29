import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { CompiledQuery, sql } from 'kysely';
import { applySettingsDdl } from '../ddl-runner.js';
import { createDeviceRepository } from './device.repository.js';
import { hasSensorReading } from './filters.js';
import { createSensorLogRepository } from './sensor-log.repository.js';
import { startMysql, type SeedRow, type TestMysql } from './test-support.js';
import { applyWindow } from './window.js';
import { fileURLToPath } from 'node:url';

/** EXPLAIN の1行。今回使う列だけに絞って受ける（mysql2 は他にも id・table 等を返す）。 */
interface ExplainRow {
  type: string;
  key: string | null;
  Extra: string | null;
}

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
    // device 2 側にしか「温度なし」除外行が無いと、総件数と窓クエリの一致は
    // 「たまたま手計算した2つの数値が合っている」ことしか示せない
    // （device 1 は素通し=フィルタ無しでも同じ結果になってしまう）。
    // device 1 側にも対称に除外行を1つ加え、フィルタが両者で効くようにする。
    await mysql.seedLogs([
      { deviceId: 1, minutesAgo: 5, status: { humidity: 40 } },   // 温度なし → 除外
    ]);

    const repo = createSensorLogRepository(mysql.db);
    const readings = await repo.listReadings('all', 0);
    const totals = await repo.countByDevice();

    // listReadings（窓クエリ）と countByDevice（総件数）を独立に実行し、
    // 前者を deviceId で集計した結果が後者と一致することを直接確認する。
    // これにより「2つのクエリが同じ行集合を見ている」こと自体を検証する
    // （手計算の期待値同士を突き合わせるだけでは、フィルタの中身が
    // 両クエリで実際に一致しているかまでは分からない）。
    const countFromReadings = new Map<number, number>();
    for (const r of readings) {
      countFromReadings.set(r.deviceId, (countFromReadings.get(r.deviceId) ?? 0) + 1);
    }
    expect(totals).toEqual(countFromReadings);
    expect(totals.get(1)).toBe(3);   // 温度を持つ 3 行すべて（除外行を足しても変わらない）
    expect(totals.get(2)).toBe(1);   // 温度なしの 2 行は除外
  });

  test('listReadings 相当のクエリが idx_recorded_at をレンジスキャンする', async () => {
    // 検証するのは「本番が実際に発行する SQL」でなければ意味がない。
    // SELECT l.device_id だけを射影する手書きクエリは索引の列だけで完結する
    // covering index scan になり、行数に関係なく索引が選ばれてしまう。本番クエリは
    // status_data（JSON・索引に無い）を含むためその性質を持たない。そこで repository と
    // 同じ部品（hasSensorReading / applyWindow）でクエリを組み立て直し、.compile() した
    // SQL とバインド値をそのまま EXPLAIN に渡して構造的な一致を保証する。
    //
    // 索引選択はテーブル規模と選択率に左右されるため、5,000 行を 30 日ぶんに散らして
    // から計測する（beforeEach の 6 行ではオプティマイザの判断材料として少なすぎ、
    // 24 時間窓の選択率も出ない）。
    const bulk: SeedRow[] = Array.from({ length: 5000 }, (_, i) => ({
      deviceId: (i % 2) + 1,
      minutesAgo: i % (60 * 24 * 30),
      status: { temperature: 15 + (i % 15), humidity: 50 },
    }));
    await mysql.seedLogs(bulk);

    // 大量挿入の直後は InnoDB の永続統計が古いままで、オプティマイザが実際の
    // 選択率を知らずにフルスキャンを選ぶ。本番のテーブルは統計が自然に蓄積されて
    // いるので、その状態を再現するために明示的に更新する。これが無いと
    // type: ALL になり、クエリ形状ではなく統計の鮮度を測るテストになってしまう。
    await sql`ANALYZE TABLE device_status_logs`.execute(mysql.db);

    const compiled = applyWindow(
      mysql.db
        .selectFrom('device_status_logs as l')
        .select(['l.device_id', 'l.status_data', 'l.recorded_at'])
        .where(hasSensorReading),
      '24h',
      0,
    )
      .orderBy('l.device_id')
      .orderBy('l.recorded_at', 'asc')
      .compile();

    // ここは type/key を pin する。以前の複合索引 (device_id, recorded_at) の頃は
    // 実行計画が type: ALL / key: NULL という最悪の状態で固定されており、pin しても
    // 悪化のしようがないため回帰を検出できず、将来の改善でテストが落ちるだけだった。
    // idx_recorded_at (recorded_at) に置き換えたことでレンジスキャンが成立するように
    // なったので、pin が本来の意味（クエリ形状の変更で索引が効かなくなったら気づく）を
    // 持つ。実測値と経緯は docs/db-performance.md を参照。
    const explainResult = await mysql.db.executeQuery<ExplainRow>(
      CompiledQuery.raw(`EXPLAIN ${compiled.sql}`, [...compiled.parameters]),
    );
    expect(explainResult.rows).toHaveLength(1);

    const plan = explainResult.rows[0]!;
    expect(plan.key).toBe('idx_recorded_at');
    expect(plan.type).toBe('range');   // ALL（全行スキャン）に戻っていないこと

    const indexes = await sql<{ Key_name: string }>`SHOW INDEX FROM device_status_logs`.execute(mysql.db);
    expect(indexes.rows.some((r) => r.Key_name === 'idx_recorded_at')).toBe(true);
  });
});

describe('applySettingsDdl', () => {
  test('二度実行してもエラーにならない（冪等）', async () => {
    const ddlDir = fileURLToPath(new URL('../../../../ddl', import.meta.url));
    await applySettingsDdl(mysql.db, ddlDir);
    await expect(applySettingsDdl(mysql.db, ddlDir)).resolves.toBeUndefined();
  });
});
