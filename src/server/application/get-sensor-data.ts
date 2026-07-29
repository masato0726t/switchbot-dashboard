// センサーデータ取得のユースケース。SQL も HTTP も知らず、手順だけを書く。

import { buildSeries } from '../domain/build-series.js';
import { resolveOffset, resolveRange } from '../domain/range.js';
import type { DeviceSeries } from '../domain/sensor.js';
import type { DeviceRepository, SensorLogRepository, TotalsCache } from './ports.js';

export interface GetSensorDataDeps {
  readonly devices: DeviceRepository;
  readonly logs: SensorLogRepository;
  readonly totalsCache: TotalsCache;
}

export interface SensorDataQuery {
  readonly range: unknown;
  readonly offset: unknown;
}

export function makeGetSensorData(deps: GetSensorDataDeps) {
  return async function getSensorData(query: SensorDataQuery): Promise<DeviceSeries[]> {
    const range = resolveRange(query.range);
    const offset = resolveOffset(query.offset);

    const [devices, totals, readings] = await Promise.all([
      deps.devices.listSensorDevices(),
      getTotals(deps),
      deps.logs.listReadings(range, offset),
    ]);

    return buildSeries(devices, readings, totals);
  };
}

async function getTotals(deps: GetSensorDataDeps): Promise<Map<number, number>> {
  const cached = deps.totalsCache.get();
  if (cached) return cached;

  const totals = await deps.logs.countByDevice();
  deps.totalsCache.set(totals);
  return totals;
}
