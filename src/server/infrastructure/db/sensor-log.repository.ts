import type { SensorLogRepository } from '../../application/ports.js';
import type { Reading } from '../../domain/sensor.js';
import type { RangeKey } from '../../../shared/ranges.js';
import type { Db } from './create-db.js';
import { hasSensorReading } from './filters.js';
import { applyWindow } from './window.js';

type StatusValues = {
  temperature: number | null;
  humidity: number | null;
  co2?: number;
  battery?: number;
};

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

/**
 * status_data（JSON 列）からダッシュボードが使う値を取り出す。
 * mysql2 は JSON 列をパース済みで返すが、ドライバ設定や列型の違いで
 * 文字列のまま来る場合もあるため両方を受ける。
 * 収集側が決める JSON なので、想定外の形は「値なし」として扱い落とさない。
 */
export function parseStatusData(raw: unknown): StatusValues {
  const source = typeof raw === 'string' ? tryParseJson(raw) : raw;
  if (typeof source !== 'object' || source === null) {
    return { temperature: null, humidity: null };
  }

  const s = source as Record<string, unknown>;
  const co2 = numberOrNull(s['CO2']);
  const battery = numberOrNull(s['battery']);
  return {
    temperature: numberOrNull(s['temperature']),
    humidity: numberOrNull(s['humidity']),
    ...(battery !== null ? { battery } : {}),
    ...(co2 !== null ? { co2 } : {}),
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createSensorLogRepository(db: Db): SensorLogRepository {
  return {
    async listReadings(range: RangeKey, offset: number): Promise<Reading[]> {
      const rows = await applyWindow(
        db
          .selectFrom('device_status_logs as l')
          .select(['l.device_id', 'l.status_data', 'l.recorded_at'])
          .where(hasSensorReading),
        range,
        offset,
      )
        .orderBy('l.device_id')
        .orderBy('l.recorded_at', 'asc')
        .execute();

      const readings: Reading[] = [];
      for (const row of rows) {
        // recorded_at が NULL の行を落とすのは旧実装からの意図的な変更。
        // 旧 lib/transform.cjs にはこのガードが無く、new Date(null) で
        // エポック0（1970/1/1）の点として出力していた。ORDER BY recorded_at
        // ASC では NULL は先頭に並び、LTTB は最初の点を必ず残す仕様なので、
        // 間引いても消えず range=all のグラフの横軸が1970年まで引き伸ばされ、
        // 実データが右端に潰れて読めなくなる。旧挙動は表示上の不具合であり
        // 引き継がない。
        if (row.device_id === null || row.recorded_at === null) continue;
        readings.push({
          deviceId: row.device_id,
          ts: new Date(row.recorded_at).getTime(),
          ...parseStatusData(row.status_data),
        });
      }
      return readings;
    },

    async countByDevice(): Promise<Map<number, number>> {
      const rows = await db
        .selectFrom('device_status_logs as l')
        .select(({ fn }) => ['l.device_id', fn.countAll<number>().as('total')])
        .where(hasSensorReading)
        .groupBy('l.device_id')
        .execute();

      const totals = new Map<number, number>();
      for (const row of rows) {
        if (row.device_id !== null) totals.set(row.device_id, Number(row.total));
      }
      return totals;
    },
  };
}
