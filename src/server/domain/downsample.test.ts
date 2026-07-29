import { describe, expect, test } from 'vitest';
import { lttb } from './downsample.js';

interface Point { x: number; y: number }

const getX = (d: Point) => d.x;
const getY = (d: Point) => d.y;

function series(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 10 + 20 }));
}

describe('lttb', () => {
  test('点数が threshold 以下なら何も間引かない', () => {
    const data = series(100);
    expect(lttb(data, 800, getX, getY)).toHaveLength(100);
    expect(lttb(data, 100, getX, getY)).toHaveLength(100);
  });

  test('threshold が 3 未満なら元データをそのまま返す', () => {
    const data = series(50);
    expect(lttb(data, 2, getX, getY)).toBe(data);
    expect(lttb(data, 0, getX, getY)).toBe(data);
  });

  test('threshold ちょうどまで間引かれる', () => {
    expect(lttb(series(5000), 800, getX, getY)).toHaveLength(800);
  });

  test('最初と最後の点は必ず保持される', () => {
    const data = series(5000);
    const out = lttb(data, 800, getX, getY);
    expect(out[0]).toBe(data[0]);
    expect(out[out.length - 1]).toBe(data[data.length - 1]);
  });

  test('出力はすべて元データの実点（合成値ではない）', () => {
    const data = series(5000);
    const set = new Set(data);
    expect(lttb(data, 800, getX, getY).every((p) => set.has(p))).toBe(true);
  });

  test('出力は時系列順を保つ', () => {
    const out = lttb(series(5000), 500, getX, getY);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.x).toBeGreaterThan(out[i - 1]!.x);
    }
  });

  test('鋭いピークは間引いても残りやすい', () => {
    const data = series(2000);
    data[1234]!.y = 9999;
    expect(lttb(data, 200, getX, getY).some((p) => p.y === 9999)).toBe(true);
  });
});
