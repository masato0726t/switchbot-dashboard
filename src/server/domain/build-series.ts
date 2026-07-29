// 測定値の集合を、デバイス別の時系列へ組み立てる規則。
// DB も HTTP も知らない。表示用の日時文字列も作らない（presentation の担当）。

import { lttb } from './downsample.js';
import { defaultPlacement } from './placement.js';
import type { DeviceInfo, DeviceSeries, Reading, SeriesPoint } from './sensor.js';

export type { DeviceInfo, DeviceSeries, Reading, SeriesPoint };

/** 1 デバイスあたりの最大点数。これを超えたら LTTB で間引く。 */
export const MAX_POINTS = 800;

/**
 * デバイス一覧と測定値から、デバイス別の時系列を組み立てる。
 * 測定値は recorded_at の昇順に並んでいる前提（SQL 側で並べ替え済み）。
 * totals が無いデバイスは、表示範囲の生の点数で total を代替する。
 */
export function buildSeries(
  devices: readonly DeviceInfo[],
  readings: readonly Reading[],
  totals: ReadonlyMap<number, number> = new Map(),
  maxPoints: number = MAX_POINTS,
): DeviceSeries[] {
  const byDevice = new Map<number, SeriesPoint[]>();
  for (const device of devices) byDevice.set(device.id, []);

  for (const { deviceId, ...point } of readings) {
    byDevice.get(deviceId)?.push(point);
  }

  return devices.flatMap((device) => {
    const points = byDevice.get(device.id) ?? [];
    if (points.length === 0) return [];
    return [{
      deviceId: device.id,
      name: device.name,
      type: device.type,
      placement: device.placement ?? defaultPlacement(device.type),
      total: totals.get(device.id) ?? points.length,
      downsampled: points.length > maxPoints,
      // 温度を基準に実データ点を選ぶ。温度が欠けている点は 0 とみなす（元実装と同じ）。
      points: lttb(points, maxPoints, (p) => p.ts, (p) => p.temperature ?? 0),
    }];
  });
}
