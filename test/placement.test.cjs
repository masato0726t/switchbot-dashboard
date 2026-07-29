'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PLACEMENTS, defaultPlacement, isValidPlacement } = require('../lib/placement.cjs');

test('defaultPlacement は IO を含む種別を屋外と推測する', () => {
  assert.equal(defaultPlacement('WoIOSensor'), 'outdoor');
});

test('defaultPlacement は IO を含まない種別を室内と推測する', () => {
  assert.equal(defaultPlacement('Meter'), 'indoor');
  assert.equal(defaultPlacement('MeterPro(CO2)'), 'indoor');
});

test('defaultPlacement は未定義・非文字列でも室内にフォールバックする', () => {
  assert.equal(defaultPlacement(undefined), 'indoor');
  assert.equal(defaultPlacement(null), 'indoor');
});

test('isValidPlacement は indoor / outdoor のみ受け付ける', () => {
  assert.ok(isValidPlacement('indoor'));
  assert.ok(isValidPlacement('outdoor'));
  assert.equal(isValidPlacement('garden'), false);
  assert.equal(isValidPlacement(''), false);
  assert.equal(isValidPlacement(undefined), false);
});

test('PLACEMENTS は indoor / outdoor を列挙する', () => {
  assert.deepEqual([...PLACEMENTS].sort(), ['indoor', 'outdoor']);
});
