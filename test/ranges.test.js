'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RANGE_INTERVALS, DEFAULT_RANGE, resolveRange, rangeClause } = require('../lib/ranges');

test('有効なキーはそのまま返す', () => {
  for (const key of Object.keys(RANGE_INTERVALS)) {
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

test('rangeClause は有効範囲で DATE_SUB 句を返す', () => {
  assert.equal(
    rangeClause('24h'),
    'AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)'
  );
  assert.equal(
    rangeClause('1w'),
    'AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
  );
});

test("'all' は絞り込み句なし（空文字）", () => {
  assert.equal(rangeClause('all'), '');
});

test('未知のキーはデフォルト(24h)の句になる', () => {
  assert.equal(rangeClause('; DROP TABLE devices;--'), rangeClause(DEFAULT_RANGE));
});

test('生成される SQL 句にはホワイトリスト由来の文字列しか含まれない', () => {
  for (const key of Object.keys(RANGE_INTERVALS)) {
    const clause = rangeClause(key);
    if (clause !== '') {
      assert.match(clause, /^AND l\.recorded_at >= DATE_SUB\(NOW\(\), INTERVAL \d+ (HOUR|DAY|MONTH|YEAR)\)$/);
    }
  }
});
