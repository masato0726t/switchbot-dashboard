// public/js/share.js のうち純粋関数（投稿文の組み立て・ドメイン正規化）のテスト。
// DOM や localStorage を使う部分はブラウザ専用のため対象外。

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareText, normalizeDomain } from '../public/js/share.js';

test('buildShareText は全項目あれば 5 行の投稿文を作る', () => {
  const text = buildShareText({
    name: 'リビング', time: '2026/6/12 12:00:00',
    temperature: 25.4, humidity: 52, co2: 712,
  });
  assert.deepEqual(text.split('\n'), [
    '【リビング】 2026/6/12 12:00:00',
    '🌡️ 温度: 25.4°C',
    '💧 湿度: 52%',
    '🟢 CO2: 712ppm',
    '#SwitchBot',
  ]);
});

test('buildShareText は null の項目を行ごと省く', () => {
  const text = buildShareText({
    name: '書斎', time: '2026/6/12 12:00:00',
    temperature: 25.4, humidity: null, co2: null,
  });
  assert.ok(!text.includes('湿度'));
  assert.ok(!text.includes('CO2'));
  assert.ok(text.includes('温度: 25.4°C'));
});

test('buildShareText は time が無ければヘッダーの時刻を省く', () => {
  const text = buildShareText({ name: '書斎', time: null, temperature: 25, humidity: 50, co2: null });
  assert.equal(text.split('\n')[0], '【書斎】');
});

test('温度 0°C・湿度 0% は有効値として投稿文に残る', () => {
  const text = buildShareText({ name: '冷凍庫', time: null, temperature: 0, humidity: 0, co2: null });
  assert.ok(text.includes('温度: 0°C'));
  assert.ok(text.includes('湿度: 0%'));
});

test('normalizeDomain はスキーム・パス・空白を取り除く', () => {
  assert.equal(normalizeDomain('https://mstdn.jp/about'), 'mstdn.jp');
  assert.equal(normalizeDomain('http://misskey.io/'), 'misskey.io');
  assert.equal(normalizeDomain('  example.com  '), 'example.com');
  assert.equal(normalizeDomain('example.com'), 'example.com');
});
