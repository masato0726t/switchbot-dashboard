import { describe, expect, test } from 'vitest';
import { parseStatusData } from './sensor-log.repository.js';

describe('parseStatusData', () => {
  test('温度・湿度を取り出す', () => {
    expect(parseStatusData({ temperature: 24.9, humidity: 55 }))
      .toEqual({ temperature: 24.9, humidity: 55 });
  });

  test('CO2 は co2 という名前に付け替える（API のフィールド名に合わせる）', () => {
    expect(parseStatusData({ temperature: 22, humidity: 60, CO2: 718 }))
      .toEqual({ temperature: 22, humidity: 60, co2: 718 });
  });

  test('battery があれば取り出す', () => {
    expect(parseStatusData({ temperature: 22, humidity: 60, battery: 88 }))
      .toEqual({ temperature: 22, humidity: 60, battery: 88 });
  });

  test('欠けている温度・湿度は null になる', () => {
    expect(parseStatusData({ temperature: 24 })).toEqual({ temperature: 24, humidity: null });
  });

  test('CO2 / battery が無ければキー自体を付けない', () => {
    const parsed = parseStatusData({ temperature: 24, humidity: 50 });
    expect('co2' in parsed).toBe(false);
    expect('battery' in parsed).toBe(false);
  });

  test('MySQL が文字列で返した JSON も解釈する', () => {
    expect(parseStatusData('{"temperature":24.9,"humidity":55,"CO2":700}'))
      .toEqual({ temperature: 24.9, humidity: 55, co2: 700 });
  });

  test('壊れた値・非オブジェクトは全項目 null として扱う', () => {
    expect(parseStatusData('not json')).toEqual({ temperature: null, humidity: null });
    expect(parseStatusData(null)).toEqual({ temperature: null, humidity: null });
    expect(parseStatusData(42)).toEqual({ temperature: null, humidity: null });
  });

  test('数値でない温度・湿度は null に落とす', () => {
    expect(parseStatusData({ temperature: 'hot', humidity: true }))
      .toEqual({ temperature: null, humidity: null });
  });
});
