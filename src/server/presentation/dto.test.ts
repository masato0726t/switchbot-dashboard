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
