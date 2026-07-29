import { describe, expect, it } from 'vitest';
import { isHumidityLow, isSnoozing, type AcReading } from './ac-rule.js';

const reading = (humidity: number | null): AcReading => ({
  recordedAt: new Date('2026-07-29T14:00:00+09:00'),
  temperature: 25,
  humidity,
});

describe('isHumidityLow', () => {
  it('下限を下回っていれば警告する', () => {
    expect(isHumidityLow(reading(39), 40)).toBe(true);
  });

  it('下限ちょうどでは警告しない', () => {
    expect(isHumidityLow(reading(40), 40)).toBe(false);
  });

  it('下限が未設定なら警告しない', () => {
    expect(isHumidityLow(reading(10), null)).toBe(false);
  });

  it('湿度を読めないセンサーでは警告しない', () => {
    expect(isHumidityLow(reading(null), 40)).toBe(false);
  });

  it('測定値が無ければ警告しない', () => {
    expect(isHumidityLow(null, 40)).toBe(false);
  });
});

describe('isSnoozing', () => {
  const now = new Date('2026-07-29T14:00:00+09:00');

  it('未設定なら停止していない', () => {
    expect(isSnoozing(null, now)).toBe(false);
  });

  it('未来の時刻なら停止中', () => {
    expect(isSnoozing(new Date('2026-07-29T15:00:00+09:00'), now)).toBe(true);
  });

  it('過去の時刻なら停止していない', () => {
    expect(isSnoozing(new Date('2026-07-29T13:00:00+09:00'), now)).toBe(false);
  });

  it('同時刻は停止していない扱い', () => {
    expect(isSnoozing(now, now)).toBe(false);
  });
});
