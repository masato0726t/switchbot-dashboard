'use strict';

// 範囲キー -> recorded_at の絞り込みに使う MySQL INTERVAL 句（all は絞り込みなし）
const RANGE_INTERVALS = {
  '1h':  'INTERVAL 1 HOUR',
  '6h':  'INTERVAL 6 HOUR',
  '12h': 'INTERVAL 12 HOUR',
  '24h': 'INTERVAL 24 HOUR',
  '1w':  'INTERVAL 7 DAY',
  '1mo': 'INTERVAL 1 MONTH',
  '1y':  'INTERVAL 1 YEAR',
  '3y':  'INTERVAL 3 YEAR',
  'all': null,
};

const DEFAULT_RANGE = '24h';

/**
 * 受け取った範囲キーを検証し、未知の値ならデフォルトに丸める。
 * @param {string} range
 * @returns {string} RANGE_INTERVALS に存在する有効なキー
 */
function resolveRange(range) {
  return Object.prototype.hasOwnProperty.call(RANGE_INTERVALS, range)
    ? range
    : DEFAULT_RANGE;
}

/**
 * 範囲キーから WHERE に追加する SQL 句を組み立てる。
 * INTERVAL 値はホワイトリスト由来の固定文字列のみなので注入の余地はない。
 * @param {string} range
 * @returns {string} 例: "AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)" / 'all' は ''
 */
function rangeClause(range) {
  const interval = RANGE_INTERVALS[resolveRange(range)];
  return interval ? `AND l.recorded_at >= DATE_SUB(NOW(), ${interval})` : '';
}

module.exports = { RANGE_INTERVALS, DEFAULT_RANGE, resolveRange, rangeClause };
