'use strict';

// 範囲キー -> { count, unit }。unit は MySQL の INTERVAL 単位（固定文字列）。
// 'all' は窓幅を持たない（全期間表示・ページング不可）ため null。
const RANGE_SPECS = {
  '1h':  { count: 1,  unit: 'HOUR' },
  '6h':  { count: 6,  unit: 'HOUR' },
  '12h': { count: 12, unit: 'HOUR' },
  '24h': { count: 24, unit: 'HOUR' },
  '1w':  { count: 7,  unit: 'DAY' },
  '1mo': { count: 1,  unit: 'MONTH' },
  '1y':  { count: 1,  unit: 'YEAR' },
  '3y':  { count: 3,  unit: 'YEAR' },
  'all': null,
};

const DEFAULT_RANGE = '24h';
const VALID_UNITS = new Set(['HOUR', 'DAY', 'MONTH', 'YEAR']);

/**
 * 受け取った範囲キーを検証し、未知の値ならデフォルトに丸める。
 * @param {string} range
 * @returns {string} RANGE_SPECS に存在する有効なキー
 */
function resolveRange(range) {
  return Object.prototype.hasOwnProperty.call(RANGE_SPECS, range)
    ? range
    : DEFAULT_RANGE;
}

/**
 * ページオフセット（過去へ何区間さかのぼるか）を 0 以上の整数に正規化する。
 * @param {*} offset
 * @returns {number} 0 以上の整数。不正値は 0
 */
function resolveOffset(offset) {
  const n = Number(offset);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * 表示範囲とページオフセットから recorded_at の WHERE 句とバインド値を組み立てる。
 * offset=0 は最新ウィンドウ（end = NOW()）で従来挙動と同じ。
 * offset=k は 1 区間幅ずつ k 個ぶん過去の窓 [NOW-(k+1)*span, NOW-k*span)。
 * unit はホワイトリスト由来の固定文字列、count は ? でバインドするため注入の余地はない。
 *
 * @param {string} range
 * @param {*} offset
 * @returns {{ clause: string, params: number[] }}
 */
function windowClause(range, offset) {
  const spec = RANGE_SPECS[resolveRange(range)];
  if (!spec) return { clause: '', params: [] };   // 'all' は絞り込みなし
  const { count, unit } = spec;
  const off = resolveOffset(offset);

  if (off === 0) {
    return {
      clause: `AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL ? ${unit})`,
      params: [count],
    };
  }
  return {
    clause:
      `AND l.recorded_at >= DATE_SUB(NOW(), INTERVAL ? ${unit}) ` +
      `AND l.recorded_at <  DATE_SUB(NOW(), INTERVAL ? ${unit})`,
    params: [count * (off + 1), count * off],
  };
}

module.exports = {
  RANGE_SPECS, DEFAULT_RANGE, VALID_UNITS,
  resolveRange, resolveOffset, windowClause,
};
