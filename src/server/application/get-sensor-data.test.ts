import { describe, expect, test, vi } from 'vitest';
import type { RangeKey } from '../../shared/ranges.js';
import type { DeviceInfo, Reading } from '../domain/sensor.js';
import { makeGetSensorData } from './get-sensor-data.js';
import type { DeviceRepository, SensorLogRepository, TotalsCache } from './ports.js';

const DEVICES: DeviceInfo[] = [
  { id: 1, name: 'リビング', type: 'WoIOSensor', placement: null },
];

const READINGS: Reading[] = [
  { deviceId: 1, ts: Date.UTC(2026, 4, 31, 10, 0), temperature: 24.9, humidity: 55 },
];

function fakes(overrides: {
  readings?: Reading[];
  totals?: Map<number, number>;
  cached?: Map<number, number>;
} = {}) {
  const listReadings = vi.fn<SensorLogRepository['listReadings']>()
    .mockResolvedValue(overrides.readings ?? READINGS);
  const countByDevice = vi.fn<SensorLogRepository['countByDevice']>()
    .mockResolvedValue(overrides.totals ?? new Map([[1, 12345]]));
  let stored = overrides.cached;

  const devices: DeviceRepository = {
    listSensorDevices: vi.fn().mockResolvedValue(DEVICES),
    savePlacement: vi.fn(),
  };
  const logs: SensorLogRepository = { listReadings, countByDevice };
  const totalsCache: TotalsCache = {
    get: () => stored,
    set: (totals) => { stored = totals; },
  };
  return { devices, logs, totalsCache, listReadings, countByDevice };
}

describe('makeGetSensorData', () => {
  test('デバイス・測定値・総件数を組み合わせて時系列を返す', async () => {
    const { devices, logs, totalsCache } = fakes();
    const result = await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0]!.deviceId).toBe(1);
    expect(result[0]!.total).toBe(12345);
    expect(result[0]!.points).toHaveLength(1);
  });

  test('不正な range / offset は既定へ丸めて repository に渡す', async () => {
    const { devices, logs, totalsCache, listReadings } = fakes();
    await makeGetSensorData({ devices, logs, totalsCache })({ range: 'bogus', offset: -5 });

    expect(listReadings).toHaveBeenCalledWith('24h' satisfies RangeKey, 0);
  });

  test('有効な range / offset はそのまま渡す', async () => {
    const { devices, logs, totalsCache, listReadings } = fakes();
    await makeGetSensorData({ devices, logs, totalsCache })({ range: '1w', offset: '3' });

    expect(listReadings).toHaveBeenCalledWith('1w', 3);
  });

  test('キャッシュに総件数があれば集計クエリを実行しない', async () => {
    const { devices, logs, totalsCache, countByDevice } = fakes({ cached: new Map([[1, 999]]) });
    const result = await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(countByDevice).not.toHaveBeenCalled();
    expect(result[0]!.total).toBe(999);
  });

  test('キャッシュが空なら集計してキャッシュへ書き戻す', async () => {
    const { devices, logs, totalsCache, countByDevice } = fakes();
    await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(countByDevice).toHaveBeenCalledTimes(1);
    expect(totalsCache.get()).toEqual(new Map([[1, 12345]]));
  });

  test('測定値が無ければ空配列を返す', async () => {
    const { devices, logs, totalsCache } = fakes({ readings: [] });
    const result = await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(result).toEqual([]);
  });
});
