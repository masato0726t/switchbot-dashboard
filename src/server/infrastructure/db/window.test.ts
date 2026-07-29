import { describe, expect, test } from 'vitest';
import { INTERVAL_UNITS, RANGE_KEYS } from '../../../shared/ranges.js';
import { resolveOffset, resolveRange } from '../../domain/range.js';
import { createTestDb } from './create-test-db.js';
import { applyWindow } from './window.js';

const db = createTestDb();

// applyWindow は resolveRange/resolveOffset 済みの検証済みの値だけを受け取る
// （M6 対応）。ここでは本番の呼び出し経路（application 層が resolveRange/
// resolveOffset で丸めてから repository に渡す）を再現し、不正値の丸め込みが
// 依然として正しく効くこと（injection safety）を検証する。
function compile(range: unknown, offset: unknown) {
  const { sql, parameters } = applyWindow(
    db.selectFrom('device_status_logs as l').select('l.device_id'),
    resolveRange(range),
    resolveOffset(offset),
  ).compile();
  return { sql, parameters };
}

describe('applyWindow', () => {
  test('offset=0 は下限のみ・count をバインドする', () => {
    const { sql, parameters } = compile('24h', 0);
    expect(sql).toMatch(/`l`\.`recorded_at` >= DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
    expect(sql).not.toMatch(/</);
    expect(parameters).toEqual([24]);
  });

  test('offset>0 は上下限あり・count の倍数をバインドする', () => {
    const { sql, parameters } = compile('24h', 2);
    expect(sql).toMatch(/>= DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
    expect(sql).toMatch(/< DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
    expect(parameters).toEqual([24 * 3, 24 * 2]);   // [遠い境界, 近い境界]
  });

  test('週・月・年の単位が正しく使われる', () => {
    expect(compile('1w', 0).sql).toMatch(/INTERVAL \? DAY/);
    expect(compile('1w', 0).parameters).toEqual([7]);
    expect(compile('1mo', 1).sql).toMatch(/INTERVAL \? MONTH/);
    expect(compile('3y', 1).sql).toMatch(/INTERVAL \? YEAR/);
    expect(compile('3y', 1).parameters).toEqual([6, 3]);
  });

  test("'all' は絞り込みを付けない（オフセットも無視）", () => {
    for (const offset of [0, 5]) {
      const { sql, parameters } = compile('all', offset);
      expect(sql).not.toMatch(/recorded_at/);
      expect(parameters).toEqual([]);
    }
  });

  test('未知のキーは既定(24h)として扱う', () => {
    expect(compile('; DROP TABLE devices;--', 0)).toEqual(compile('24h', 0));
  });

  test('不正な offset は最新ウィンドウに丸められる', () => {
    expect(compile('24h', -3)).toEqual(compile('24h', 0));
    expect(compile('24h', 'xyz')).toEqual(compile('24h', 0));
    expect(compile('24h', undefined)).toEqual(compile('24h', 0));
  });

  test('生成される SQL の単位はホワイトリスト由来で、数量は必ずバインドされる', () => {
    for (const key of RANGE_KEYS) {
      for (const offset of [0, 1, 4]) {
        const { sql } = compile(key, offset);
        const units = [...sql.matchAll(/INTERVAL \? (\w+)/g)].map((m) => m[1]!);
        for (const unit of units) expect(INTERVAL_UNITS.has(unit)).toBe(true);
        // 数値リテラルが直接埋め込まれていないこと
        expect(sql).not.toMatch(/INTERVAL \d/);
      }
    }
  });
});
