'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSensorData, MAX_POINTS } = require('../lib/transform');

const DEVICES = [
  { id: 1, device_name: 'リビング', device_type: 'WoIOSensor' },
  { id: 2, device_name: '書斎',     device_type: 'MeterPro(CO2)' },
  { id: 3, device_name: '物置',     device_type: 'Meter' },   // ログなし
];

function log(device_id, recorded_at, status_data) {
  return { device_id, recorded_at, status_data };
}

test('デバイスごとに時系列をまとめる', () => {
  const logs = [
    log(1, '2026-05-31T10:00:00Z', { temperature: 24.9, humidity: 55 }),
    log(1, '2026-05-31T10:05:00Z', { temperature: 25.1, humidity: 54 }),
    log(2, '2026-05-31T10:00:00Z', { temperature: 22.0, humidity: 60, CO2: 718 }),
  ];
  const out = buildSensorData(DEVICES, logs);

  assert.equal(out.length, 2);                       // 物置はログ無しで除外
  const living = out.find(d => d.device_id === 1);
  assert.equal(living.name, 'リビング');
  assert.equal(living.data.length, 2);
  assert.equal(living.data[0].temperature, 24.9);
  assert.equal(living.data[0].humidity, 55);
  assert.equal(living.data[0].co2, undefined);       // CO2 が無い行には co2 を付けない
});

test('CO2 がある行だけ co2 フィールドを持つ', () => {
  const logs = [log(2, '2026-05-31T10:00:00Z', { temperature: 22, humidity: 60, CO2: 718 })];
  const out = buildSensorData(DEVICES, logs);
  assert.equal(out[0].data[0].co2, 718);
});

test('内部用の _ts は数値 ts として公開し、time も持つ', () => {
  const logs = [log(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })];
  const out = buildSensorData(DEVICES, logs);
  const point = out[0].data[0];
  assert.ok(!('_ts' in point));                              // 内部名は漏らさない
  assert.equal(typeof point.ts, 'number');                  // エポックミリ秒を公開
  assert.equal(point.ts, Date.parse('2026-05-31T10:00:00Z'));
  assert.ok('time' in point);                               // 表示用文字列も持つ
});

test('欠損値は null になる', () => {
  const logs = [log(1, '2026-05-31T10:00:00Z', { temperature: 24 })]; // humidity 無し
  const out = buildSensorData(DEVICES, logs);
  assert.equal(out[0].data[0].humidity, null);
});

test('未知の device_id のログは無視する', () => {
  const logs = [log(999, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })];
  assert.equal(buildSensorData(DEVICES, logs).length, 0);
});

test('点数が maxPoints 以下なら downsampled=false で全件返す', () => {
  const logs = Array.from({ length: 10 }, (_, i) =>
    log(1, new Date(Date.UTC(2026, 4, 31, 10, i)).toISOString(), { temperature: 20 + i, humidity: 50 }));
  const out = buildSensorData(DEVICES, logs, {}, 800);
  assert.equal(out[0].downsampled, false);
  assert.equal(out[0].data.length, 10);
});

test('点数が maxPoints を超えると downsampled=true で間引かれる', () => {
  const n = 2000;
  const logs = Array.from({ length: n }, (_, i) =>
    log(1, new Date(Date.UTC(2026, 4, 31, 0, 0, i)).toISOString(), { temperature: 20 + (i % 5), humidity: 50 }));
  const out = buildSensorData(DEVICES, logs, {}, 800);
  assert.equal(out[0].downsampled, true);
  assert.equal(out[0].data.length, 800);
});

test('total は totals で渡した全期間の総件数を使う', () => {
  const logs = [
    log(1, '2026-05-31T10:00:00Z', { temperature: 24.9, humidity: 55 }),
    log(1, '2026-05-31T10:05:00Z', { temperature: 25.1, humidity: 54 }),
  ];
  const out = buildSensorData(DEVICES, logs, { 1: 12345 });
  assert.equal(out[0].total, 12345);   // 表示範囲の点数(2)ではなく総件数を表示
  assert.equal(out[0].data.length, 2);
});

test('totals 未指定なら total は表示範囲の点数で代替する', () => {
  const logs = [log(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })];
  const out = buildSensorData(DEVICES, logs);
  assert.equal(out[0].total, 1);
});

test('placement 未設定なら device_type から推測する', () => {
  const logs = [
    log(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 }),  // WoIOSensor → IO 含む
    log(2, '2026-05-31T10:00:00Z', { temperature: 22, humidity: 60 }),  // MeterPro(CO2)
  ];
  const out = buildSensorData(DEVICES, logs);
  assert.equal(out.find(d => d.device_id === 1).placement, 'outdoor');
  assert.equal(out.find(d => d.device_id === 2).placement, 'indoor');
});

test('placement が指定されていれば推測より優先する', () => {
  const devices = [{ id: 1, device_name: 'リビング', device_type: 'WoIOSensor', placement: 'indoor' }];
  const logs = [log(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })];
  const out = buildSensorData(devices, logs);
  assert.equal(out[0].placement, 'indoor');   // 推測(outdoor)ではなく設定値を使う
});

test('MAX_POINTS がエクスポートされている', () => {
  assert.equal(typeof MAX_POINTS, 'number');
  assert.ok(MAX_POINTS > 0);
});
