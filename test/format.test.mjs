// public/js/format.js（純粋ヘルパー）のテスト。
// ブラウザ用 ES Modules だが DOM に依存しないため Node でそのまま検証できる。

import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceIcon, latest, formatTimeLabel, extractSeries } from '../public/js/format.js';
import { METRICS } from '../public/js/config.js';

test('deviceIcon は種別文字列からアイコンを選ぶ', () => {
  assert.equal(deviceIcon('MeterPro(CO2)'), '🌡️');
  assert.equal(deviceIcon('Meter'), '🌡️');
  assert.equal(deviceIcon('WoIOSensor'), '🌿');
  assert.equal(deviceIcon('Hub 2'), '📡');
  assert.equal(deviceIcon('Unknown'), '📟');
});

test('latest は末尾から最初の非 null 値を返す', () => {
  const arr = [{ v: 1 }, { v: 2 }, { v: null }, {}];
  assert.equal(latest(arr, 'v'), 2);        // null/undefined を飛ばす
  assert.equal(latest([{ v: null }], 'v'), null);
  assert.equal(latest([], 'v'), null);
});

test('formatTimeLabel は範囲に応じて JST で短縮整形する', () => {
  const ts = Date.UTC(2026, 5, 12, 3, 4);   // JST 2026/6/12 12:04
  assert.equal(formatTimeLabel(ts, '24h'), '12:04');   // 短期間 → 時刻のみ
  assert.equal(formatTimeLabel(ts, '1h'),  '12:04');
  assert.equal(formatTimeLabel(ts, '1w'),  '6/12');    // 日単位 → 月日
  assert.equal(formatTimeLabel(ts, '1mo'), '6/12');
  assert.equal(formatTimeLabel(ts, '1y'),  '2026/6');  // 長期間 → 年月
  assert.equal(formatTimeLabel(ts, 'all'), '2026/6');
});

// API の data 点を模す（ts はエポックミリ秒、time はフル日時文字列）
function point(temperature, humidity, co2) {
  const p = { ts: Date.UTC(2026, 5, 12, 3, 0), time: '2026/6/12 12:00:00', temperature, humidity };
  if (co2 !== undefined) p.co2 = co2;
  return p;
}

test('extractSeries は METRICS の field をキーに系列を作る', () => {
  const { labels, times, series } = extractSeries([point(25, 50, 700)], '24h');
  assert.deepEqual(Object.keys(series).sort(), METRICS.map(m => m.field).sort());
  assert.equal(labels.length, 1);
  assert.equal(times.length, 1);
  assert.deepEqual(series.temperature, [25]);
  assert.deepEqual(series.humidity, [50]);
  assert.deepEqual(series.co2, [700]);
});

test('extractSeries は co2 の無い点を null に正規化する', () => {
  const { series } = extractSeries([point(25, 50)], '24h');
  assert.deepEqual(series.co2, [null]);
});

test('extractSeries は温度・湿度が両方 0 の異常値を除外する', () => {
  const data = [point(25, 50), point(0, 0), point(26, 51)];
  const { labels, times, series } = extractSeries(data, '24h');
  assert.equal(labels.length, 2);
  assert.equal(times.length, 2);
  assert.deepEqual(series.temperature, [25, 26]);
  // 片方だけ 0 の点は正常値として残す
  const { series: s2 } = extractSeries([point(0, 50)], '24h');
  assert.deepEqual(s2.temperature, [0]);
});

test('extractSeries の labels/times/series は同じ長さで揃う', () => {
  const data = [point(25, 50, 700), point(0, 0), point(26, 51, 710)];
  const { labels, times, series } = extractSeries(data, '24h');
  for (const m of METRICS) assert.equal(series[m.field].length, labels.length);
  assert.equal(times.length, labels.length);
});
