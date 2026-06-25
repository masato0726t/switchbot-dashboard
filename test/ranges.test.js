'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RANGE_SPECS, DEFAULT_RANGE, VALID_UNITS,
  resolveRange, resolveOffset, windowClause,
} = require('../lib/ranges');

test('有効なキーはそのまま返す', () => {
  for (const key of Object.keys(RANGE_SPECS)) {
    assert.equal(resolveRange(key), key);
  }
});

test('未知・未指定のキーはデフォルトに丸める', () => {
  assert.equal(resolveRange('bogus'), DEFAULT_RANGE);
  assert.equal(resolveRange(undefined), DEFAULT_RANGE);
  assert.equal(resolveRange(''), DEFAULT_RANGE);
  // プロトタイプ汚染由来のキーを誤って受け付けない
  assert.equal(resolveRange('toString'), DEFAULT_RANGE);
  assert.equal(resolveRange('constructor'), DEFAULT_RANGE);
});

test('resolveOffset は 0 以上の整数だけ通し、それ以外は 0', () => {
  assert.equal(resolveOffset(0), 0);
  assert.equal(resolveOffset(3), 3);
  assert.equal(resolveOffset('5'), 5);     // 数値化できる文字列は許容
  assert.equal(resolveOffset(-1), 0);      // 負数は 0
  assert.equal(resolveOffset(1.5), 0);     // 非整数は 0
  assert.equal(resolveOffset('abc'), 0);
  assert.equal(resolveOffset(undefined), 0);
});

test('offset=0 は最新ウィンドウ（下限のみ・count をバインド）', () => {
  const { clause, params } = windowClause('24h', 0);
  assert.equal(clause, 'AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)');
  assert.deepEqual(params, [24]);
});

test('offset>0 は過去ウィンドウ（上下限あり・count を倍数でバインド）', () => {
  const { clause, params } = windowClause('24h', 2);
  assert.match(clause, /recorded_at >= DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
  assert.match(clause, /recorded_at < {2}DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
  assert.deepEqual(params, [24 * 3, 24 * 2]);   // [遠い境界, 近い境界]
});

test('週・月・年の単位が正しく使われる', () => {
  assert.match(windowClause('1w', 0).clause, /INTERVAL \? DAY/);
  assert.deepEqual(windowClause('1w', 0).params, [7]);
  assert.match(windowClause('1mo', 1).clause, /INTERVAL \? MONTH/);
  assert.match(windowClause('3y', 1).clause, /INTERVAL \? YEAR/);
  assert.deepEqual(windowClause('3y', 1).params, [6, 3]);
});

test("'all' は絞り込み句なし・パラメータなし（オフセット無視）", () => {
  assert.deepEqual(windowClause('all', 0), { clause: '', params: [] });
  assert.deepEqual(windowClause('all', 5), { clause: '', params: [] });
});

test('未知のキーはデフォルト(24h)として扱う', () => {
  assert.deepEqual(windowClause('; DROP TABLE devices;--', 0), windowClause(DEFAULT_RANGE, 0));
});

test('不正な offset は最新ウィンドウに丸められる', () => {
  assert.deepEqual(windowClause('24h', -3), windowClause('24h', 0));
  assert.deepEqual(windowClause('24h', 'xyz'), windowClause('24h', 0));
});

test('生成される句の単位はすべてホワイトリスト、可変部は ? のみ', () => {
  for (const key of Object.keys(RANGE_SPECS)) {
    for (const off of [0, 1, 4]) {
      const { clause } = windowClause(key, off);
      if (clause === '') continue;
      // 単位はホワイトリスト由来
      const units = [...clause.matchAll(/INTERVAL \? (\w+)/g)].map(m => m[1]);
      assert.ok(units.length > 0);
      for (const u of units) assert.ok(VALID_UNITS.has(u), `想定外の単位: ${u}`);
      // 数値リテラルが直接埋め込まれていない（必ず ? でバインド）
      assert.doesNotMatch(clause, /INTERVAL \d/);
    }
  }
});
