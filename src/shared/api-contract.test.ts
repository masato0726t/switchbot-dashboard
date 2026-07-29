import { describe, expect, test } from 'vitest';
import {
  DeviceSeriesSchema, PlacementUpdateRequestSchema, SensorPointSchema,
} from './api-contract.js';

describe('SensorPointSchema', () => {
  test('最小構成（ts / time / temperature / humidity）を受け付ける', () => {
    expect(() => SensorPointSchema.parse({
      ts: 1_748_685_600_000, time: '2026/5/31 19:00:00', temperature: 24.9, humidity: 55,
    })).not.toThrow();
  });

  test('temperature / humidity は null を許容する', () => {
    expect(() => SensorPointSchema.parse({
      ts: 1, time: 'x', temperature: null, humidity: null,
    })).not.toThrow();
  });

  test('co2 / battery は任意', () => {
    const parsed = SensorPointSchema.parse({
      ts: 1, time: 'x', temperature: 1, humidity: 1, co2: 700, battery: 90,
    });
    expect(parsed.co2).toBe(700);
    expect(parsed.battery).toBe(90);
  });
});

describe('DeviceSeriesSchema', () => {
  test('name / type は null を許容する（DB のカラムが NULL 許容のため）', () => {
    expect(() => DeviceSeriesSchema.parse({
      device_id: 1, name: null, type: null, placement: 'indoor',
      total: 0, downsampled: false, data: [],
    })).not.toThrow();
  });

  test('placement は indoor / outdoor のみ', () => {
    expect(() => DeviceSeriesSchema.parse({
      device_id: 1, name: 'x', type: 'y', placement: 'garden',
      total: 0, downsampled: false, data: [],
    })).toThrow();
  });
});

describe('PlacementUpdateRequestSchema', () => {
  test('indoor / outdoor を受け付け、それ以外は失敗する', () => {
    expect(PlacementUpdateRequestSchema.safeParse({ placement: 'indoor' }).success).toBe(true);
    expect(PlacementUpdateRequestSchema.safeParse({ placement: 'outdoor' }).success).toBe(true);
    expect(PlacementUpdateRequestSchema.safeParse({ placement: 'garden' }).success).toBe(false);
    expect(PlacementUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(PlacementUpdateRequestSchema.safeParse(null).success).toBe(false);
  });
});
