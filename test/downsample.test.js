'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lttb } = require('../lib/downsample');

const id = d => d.x;
const val = d => d.y;

function series(n) {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 10 + 20 }));
}

test('点数が threshold 以下なら何も間引かない', () => {
  const data = series(100);
  assert.equal(lttb(data, 800, id, val).length, 100);
  assert.equal(lttb(data, 100, id, val).length, 100);
});

test('threshold が 3 未満なら元データをそのまま返す', () => {
  const data = series(50);
  assert.equal(lttb(data, 2, id, val), data);
  assert.equal(lttb(data, 0, id, val), data);
});

test('threshold ちょうどまで間引かれる', () => {
  const out = lttb(series(5000), 800, id, val);
  assert.equal(out.length, 800);
});

test('最初と最後の点は必ず保持される', () => {
  const data = series(5000);
  const out = lttb(data, 800, id, val);
  assert.equal(out[0], data[0]);
  assert.equal(out[out.length - 1], data[data.length - 1]);
});

test('出力はすべて元データの実点（合成値ではない）', () => {
  const data = series(5000);
  const set = new Set(data);
  const out = lttb(data, 800, id, val);
  assert.ok(out.every(p => set.has(p)));
});

test('出力は時系列順を保つ', () => {
  const out = lttb(series(5000), 500, id, val);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].x > out[i - 1].x);
  }
});

test('鋭いピークは間引いても残りやすい', () => {
  const data = series(2000);
  data[1234].y = 9999;           // 突出したスパイク
  const out = lttb(data, 200, id, val);
  assert.ok(out.some(p => p.y === 9999), 'スパイクが保持されるべき');
});
