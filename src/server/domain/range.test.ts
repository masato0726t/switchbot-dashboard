import { describe, expect, test } from 'vitest';
import { DEFAULT_RANGE, RANGE_KEYS } from '../../shared/ranges.js';
import { resolveOffset, resolveRange } from './range.js';

describe('resolveRange', () => {
  test('有効なキーはそのまま返す', () => {
    for (const key of RANGE_KEYS) expect(resolveRange(key)).toBe(key);
  });

  test('未知・未指定のキーは既定に丸める', () => {
    expect(resolveRange('bogus')).toBe(DEFAULT_RANGE);
    expect(resolveRange(undefined)).toBe(DEFAULT_RANGE);
    expect(resolveRange('')).toBe(DEFAULT_RANGE);
  });

  test('プロトタイプ由来のキーを誤って受け付けない', () => {
    expect(resolveRange('toString')).toBe(DEFAULT_RANGE);
    expect(resolveRange('constructor')).toBe(DEFAULT_RANGE);
    expect(resolveRange('__proto__')).toBe(DEFAULT_RANGE);
  });

  test('SQL 断片を渡されても既定に丸める', () => {
    expect(resolveRange('; DROP TABLE devices;--')).toBe(DEFAULT_RANGE);
  });
});

describe('resolveOffset', () => {
  test('0 以上の整数だけ通す', () => {
    expect(resolveOffset(0)).toBe(0);
    expect(resolveOffset(3)).toBe(3);
    expect(resolveOffset('5')).toBe(5);
  });

  test('負数・非整数・数値化できない値は 0 に丸める', () => {
    expect(resolveOffset(-1)).toBe(0);
    expect(resolveOffset(1.5)).toBe(0);
    expect(resolveOffset('abc')).toBe(0);
    expect(resolveOffset(undefined)).toBe(0);
  });
});
