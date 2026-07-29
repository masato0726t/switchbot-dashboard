import { describe, expect, test } from 'vitest';
import { MAX_POINTS, buildSeries, type DeviceInfo, type Reading } from './build-series.js';

const DEVICES: DeviceInfo[] = [
  { id: 1, name: 'リビング', type: 'WoIOSensor',   placement: null },
  { id: 2, name: '書斎',     type: 'MeterPro(CO2)', placement: null },
  { id: 3, name: '物置',     type: 'Meter',         placement: null },  // ログなし
];

function reading(deviceId: number, iso: string, extra: Partial<Reading> = {}): Reading {
  return {
    deviceId,
    ts: Date.parse(iso),
    temperature: extra.temperature ?? null,
    humidity: extra.humidity ?? null,
    ...(extra.co2 !== undefined ? { co2: extra.co2 } : {}),
    ...(extra.battery !== undefined ? { battery: extra.battery } : {}),
  };
}

describe('buildSeries', () => {
  test('デバイスごとに時系列をまとめ、ログの無いデバイスは除外する', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24.9, humidity: 55 }),
      reading(1, '2026-05-31T10:05:00Z', { temperature: 25.1, humidity: 54 }),
      reading(2, '2026-05-31T10:00:00Z', { temperature: 22.0, humidity: 60, co2: 718 }),
    ]);

    expect(out).toHaveLength(2);
    const living = out.find((d) => d.deviceId === 1)!;
    expect(living.name).toBe('リビング');
    expect(living.points).toHaveLength(2);
    expect(living.points[0]!.temperature).toBe(24.9);
    expect(living.points[0]!.humidity).toBe(55);
    expect(living.points[0]!.co2).toBeUndefined();
  });

  test('CO2 がある点だけ co2 を持つ', () => {
    const out = buildSeries(DEVICES, [
      reading(2, '2026-05-31T10:00:00Z', { temperature: 22, humidity: 60, co2: 718 }),
    ]);
    expect(out[0]!.points[0]!.co2).toBe(718);
  });

  test('ts はエポックミリ秒をそのまま持つ', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 }),
    ]);
    expect(out[0]!.points[0]!.ts).toBe(Date.parse('2026-05-31T10:00:00Z'));
  });

  test('欠損値は null になる', () => {
    const out = buildSeries(DEVICES, [reading(1, '2026-05-31T10:00:00Z', { temperature: 24 })]);
    expect(out[0]!.points[0]!.humidity).toBeNull();
  });

  test('未知の device_id の測定値は無視する', () => {
    const out = buildSeries(DEVICES, [
      reading(999, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 }),
    ]);
    expect(out).toHaveLength(0);
  });

  test('点数が maxPoints 以下なら downsampled=false で全件返す', () => {
    const readings = Array.from({ length: 10 }, (_, i) =>
      reading(1, new Date(Date.UTC(2026, 4, 31, 10, i)).toISOString(), { temperature: 20 + i, humidity: 50 }));
    const out = buildSeries(DEVICES, readings, undefined, 800);
    expect(out[0]!.downsampled).toBe(false);
    expect(out[0]!.points).toHaveLength(10);
  });

  test('点数が maxPoints を超えると downsampled=true で間引かれる', () => {
    const readings = Array.from({ length: 2000 }, (_, i) =>
      reading(1, new Date(Date.UTC(2026, 4, 31, 0, 0, i)).toISOString(), { temperature: 20 + (i % 5), humidity: 50 }));
    const out = buildSeries(DEVICES, readings, undefined, 800);
    expect(out[0]!.downsampled).toBe(true);
    expect(out[0]!.points).toHaveLength(800);
  });

  test('total は渡された全期間の総件数を使う', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24.9, humidity: 55 }),
      reading(1, '2026-05-31T10:05:00Z', { temperature: 25.1, humidity: 54 }),
    ], new Map([[1, 12345]]));
    expect(out[0]!.total).toBe(12345);
    expect(out[0]!.points).toHaveLength(2);
  });

  test('総件数が渡されなければ表示範囲の生の点数で代替する', () => {
    const out = buildSeries(DEVICES, [reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })]);
    expect(out[0]!.total).toBe(1);
  });

  test('placement 未設定なら type から推測する', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 }),
      reading(2, '2026-05-31T10:00:00Z', { temperature: 22, humidity: 60 }),
    ]);
    expect(out.find((d) => d.deviceId === 1)!.placement).toBe('outdoor');
    expect(out.find((d) => d.deviceId === 2)!.placement).toBe('indoor');
  });

  test('placement が設定されていれば推測より優先する', () => {
    const devices: DeviceInfo[] = [{ id: 1, name: 'リビング', type: 'WoIOSensor', placement: 'indoor' }];
    const out = buildSeries(devices, [reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })]);
    expect(out[0]!.placement).toBe('indoor');
  });

  test('MAX_POINTS は正の数', () => {
    expect(MAX_POINTS).toBeGreaterThan(0);
  });
});
