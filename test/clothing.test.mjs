// public/js/clothing.js（純粋ロジック）のテスト。
// ブラウザ用 ES Modules だが DOM に依存しないため Node でそのまま検証できる。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discomfortIndex, heatIndex, indoorAdvice, outdoorAdvice, clothingFor,
} from '../public/js/clothing.js';

test('discomfortIndex は不快指数の定義式どおりに計算する', () => {
  // 25°C / 50% の THI = 0.81*25 + 0.01*50*(0.99*25-14.3) + 46.3
  const expected = 0.81 * 25 + 0.01 * 50 * (0.99 * 25 - 14.3) + 46.3;
  assert.equal(discomfortIndex(25, 50), expected);
});

test('heatIndex は気温・湿度が高いほど実気温より高い体感を返す', () => {
  // 33°C / 70% は蒸し暑く、体感は実気温を上回る
  assert.ok(heatIndex(33, 70) > 33);
});

test('indoorAdvice は不快指数の帯ごとに服装を返す', () => {
  // 18°C / 50% → THI ≈ 61.6 → 「快適」帯
  const cool = indoorAdvice(18, 50);
  assert.equal(cool.kind, 'thi');
  assert.equal(cool.feeling, '快適');

  // 30°C / 70% → THI ≈ 82 → 「暑い」帯
  assert.equal(indoorAdvice(30, 70).feeling, '暑い');

  // 10°C / 40% → THI ≈ 50 → 「寒い」帯
  assert.equal(indoorAdvice(10, 40).feeling, '寒い');
});

test('outdoorAdvice は体感気温の帯ごとに服装を返す', () => {
  const t = outdoorAdvice(22, 50);             // 27°C 未満 → 気温そのまま
  assert.equal(t.kind, 'feels');
  assert.equal(t.value, 22);
  assert.equal(t.advice, '長袖シャツ一枚');

  assert.equal(outdoorAdvice(8, 50).advice, 'コート・厚手の上着');
  assert.equal(outdoorAdvice(2, 50).advice, 'ダウンなど真冬の装備');
  assert.equal(outdoorAdvice(28, 30).advice, '半袖でOK');
});

test('outdoorAdvice は 27°C 以上で Heat Index による体感を使う', () => {
  // 蒸し暑い日は体感が実気温を上回るので value > temp
  assert.ok(outdoorAdvice(33, 70).value > 33);
});

test('clothingFor は placement で室内 / 屋外を振り分ける', () => {
  assert.equal(clothingFor('indoor', 20, 50).kind, 'thi');
  assert.equal(clothingFor('outdoor', 20, 50).kind, 'feels');
  // 未知の placement は室内扱いにフォールバック
  assert.equal(clothingFor('garden', 20, 50).placement, 'indoor');
});

test('clothingFor は気温・湿度が欠けていれば null を返す', () => {
  assert.equal(clothingFor('indoor', null, 50), null);
  assert.equal(clothingFor('outdoor', 20, null), null);
});
