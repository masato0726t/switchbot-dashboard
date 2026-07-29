import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTotalsCache } from './totals-cache.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createTotalsCache', () => {
  test('未設定なら undefined を返す', () => {
    expect(createTotalsCache(60_000).get()).toBeUndefined();
  });

  test('TTL 内は保存した値を返す', () => {
    const cache = createTotalsCache(60_000);
    cache.set(new Map([[1, 100]]));
    vi.advanceTimersByTime(59_000);
    expect(cache.get()).toEqual(new Map([[1, 100]]));
  });

  test('TTL を過ぎたら undefined を返す', () => {
    const cache = createTotalsCache(60_000);
    cache.set(new Map([[1, 100]]));
    vi.advanceTimersByTime(61_000);
    expect(cache.get()).toBeUndefined();
  });

  test('後から set した値で上書きされる', () => {
    const cache = createTotalsCache(60_000);
    cache.set(new Map([[1, 100]]));
    cache.set(new Map([[1, 200]]));
    expect(cache.get()).toEqual(new Map([[1, 200]]));
  });
});
