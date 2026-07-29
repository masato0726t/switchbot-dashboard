import { describe, expect, test } from 'vitest';
import {
  RANGES, RANGE_BY_KEY, RANGE_KEYS, DEFAULT_RANGE, INTERVAL_UNITS,
} from './ranges.js';
// public/js/config.js は素の ESM（フロントエンドはまだ TypeScript 化していない）。
// 直接 import することで、下の「一致する」テストが手計算のハードコードされた
// 期待値ではなく、実際のフロントエンドのコピーとの一致を検証できるようにする。
import { RANGES as CLIENT_RANGES } from '../../public/js/config.js';

describe('RANGES', () => {
  test('9 種類の範囲を定義順に持つ', () => {
    expect(RANGE_KEYS).toEqual(['1h', '6h', '12h', '24h', '1w', '1mo', '1y', '3y', 'all']);
  });

  test('既定は 24h', () => {
    expect(DEFAULT_RANGE).toBe('24h');
  });

  test('キーで引ける索引が全範囲を網羅する', () => {
    for (const key of RANGE_KEYS) {
      expect(RANGE_BY_KEY[key].key).toBe(key);
    }
    expect(Object.keys(RANGE_BY_KEY)).toHaveLength(RANGES.length);
  });

  test('all だけが窓幅を持たず、ページング不可', () => {
    for (const spec of RANGES) {
      if (spec.key === 'all') {
        expect(spec.unit).toBeNull();
        expect(spec.pageable).toBe(false);
      } else {
        expect(spec.unit).not.toBeNull();
        expect(spec.pageable).toBe(true);
      }
    }
  });

  test('INTERVAL 単位はホワイトリストに含まれる値だけを使う', () => {
    for (const spec of RANGES) {
      if (spec.unit !== null) expect(INTERVAL_UNITS.has(spec.unit)).toBe(true);
    }
  });

  test('旧 lib/ranges.js の RANGE_SPECS と数量・単位が一致する', () => {
    const expected: Record<string, [number, string | null]> = {
      '1h': [1, 'HOUR'], '6h': [6, 'HOUR'], '12h': [12, 'HOUR'], '24h': [24, 'HOUR'],
      '1w': [7, 'DAY'], '1mo': [1, 'MONTH'], '1y': [1, 'YEAR'], '3y': [3, 'YEAR'],
      'all': [0, null],
    };
    for (const spec of RANGES) {
      expect([spec.count, spec.unit]).toEqual(expected[spec.key]);
    }
  });

  test('public/js/config.js の RANGES と表示ラベル・日本語単位が一致する', () => {
    // ハードコードした期待値ではなく実際のフロントエンドのファイルを import して
    // 突き合わせる。フロントエンドのコピーだけが変更され、こちらの表と食い違う
    // （ドリフトする）ことを検知できるようにするため。
    expect(CLIENT_RANGES).toHaveLength(RANGES.length);
    for (const spec of RANGES) {
      const clientSpec = CLIENT_RANGES.find((r) => r.key === spec.key);
      expect(clientSpec, `public/js/config.js に ${spec.key} が見つからない`).toBeDefined();
      expect([clientSpec!.label, clientSpec!.unitJa]).toEqual([spec.label, spec.unitJa]);
    }
  });
});
