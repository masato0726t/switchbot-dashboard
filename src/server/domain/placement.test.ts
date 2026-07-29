import { describe, expect, test } from 'vitest';
import { defaultPlacement } from './placement.js';

describe('defaultPlacement', () => {
  test('IO を含む種別を屋外と推測する', () => {
    expect(defaultPlacement('WoIOSensor')).toBe('outdoor');
  });

  test('IO を含まない種別を室内と推測する', () => {
    expect(defaultPlacement('Meter')).toBe('indoor');
    expect(defaultPlacement('MeterPro(CO2)')).toBe('indoor');
  });

  test('未定義・null でも室内にフォールバックする', () => {
    expect(defaultPlacement(undefined)).toBe('indoor');
    expect(defaultPlacement(null)).toBe('indoor');
  });
});
