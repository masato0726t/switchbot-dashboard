import { describe, expect, test } from 'vitest';
import { SensorDataResponseSchema } from '../../shared/api-contract.js';
import type { DeviceSeries } from '../domain/sensor.js';
import { toSensorDataResponse } from './dto.js';

const TS = Date.UTC(2026, 4, 31, 10, 0);   // JST 2026/5/31 19:00:00

function series(overrides: Partial<DeviceSeries> = {}): DeviceSeries {
  return {
    deviceId: 1,
    name: 'リビング',
    type: 'WoIOSensor',
    placement: 'outdoor',
    total: 52431,
    downsampled: false,
    points: [{ ts: TS, temperature: 24.9, humidity: 55 }],
    ...overrides,
  };
}

describe('toSensorDataResponse', () => {
  test('device_id / name / type / placement / total / downsampled / data を持つ', () => {
    const [dto] = toSensorDataResponse([series()]);
    expect(dto).toMatchObject({
      device_id: 1, name: 'リビング', type: 'WoIOSensor',
      placement: 'outdoor', total: 52431, downsampled: false,
    });
    expect(dto!.data).toHaveLength(1);
  });

  test('各点は ts（エポックミリ秒）と time（JST 表示文字列）を持つ', () => {
    const [dto] = toSensorDataResponse([series()]);
    const point = dto!.data[0]!;
    expect(point.ts).toBe(TS);
    expect(point.time).toBe(
      new Date(TS).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    );
  });

  test('time は toLocaleString と 1 文字も違わない（0 埋めの境界を含む）', () => {
    // 高速化のために Intl.DateTimeFormat を使い回しているが、書式コンポーネントの
    // 指定を 1 つ間違えるだけで「2026/07/29」「09:00:00」のように 0 埋めが変わり、
    // レスポンスが壊れる。月・日・時・分・秒それぞれの 1 桁 / 2 桁の境界を突く。
    const cases = [
      Date.UTC(2026, 0, 1, 15, 4, 5),     // JST 2026/1/2 0:04:05  … 月日時が 1 桁
      Date.UTC(2026, 6, 28, 15, 0, 0),    // JST 2026/7/29 0:00:00 … 分秒が 0
      Date.UTC(2026, 11, 31, 14, 59, 59), // JST 2026/12/31 23:59:59 … すべて 2 桁
      Date.UTC(2026, 9, 9, 0, 9, 9),      // JST 2026/10/9 9:09:09 … 混在
      0,                                   // JST 1970/1/1 9:00:00  … エポック
    ];
    for (const ts of cases) {
      const [dto] = toSensorDataResponse([series({
        points: [{ ts, temperature: 1, humidity: 1 }],
      })]);
      expect(dto!.data[0]!.time).toBe(
        new Date(ts).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      );
    }
  });

  test('点のキー順は ts, time, temperature, humidity, battery, co2', () => {
    const [dto] = toSensorDataResponse([series({
      points: [{ ts: TS, temperature: 24.9, humidity: 55, battery: 88, co2: 718 }],
    })]);
    expect(Object.keys(dto!.data[0]!)).toEqual(
      ['ts', 'time', 'temperature', 'humidity', 'battery', 'co2'],
    );
  });

  test('co2 / battery を持たない点にはキー自体を付けない', () => {
    const [dto] = toSensorDataResponse([series()]);
    const point = dto!.data[0]!;
    expect('co2' in point).toBe(false);
    expect('battery' in point).toBe(false);
  });

  test('欠損値は null のまま公開する', () => {
    const [dto] = toSensorDataResponse([series({
      points: [{ ts: TS, temperature: 24, humidity: null }],
    })]);
    expect(dto!.data[0]!.humidity).toBeNull();
  });

  test('生成した JSON は API 契約スキーマを満たす', () => {
    const response = toSensorDataResponse([series()]);
    expect(() => SensorDataResponseSchema.parse(response)).not.toThrow();
  });
});
