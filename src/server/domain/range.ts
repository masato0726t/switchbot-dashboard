// クエリ文字列として渡ってくる範囲・オフセットを、扱える値へ丸める。
// 不正値はエラーにせず既定へ倒す（画面の URL 直打ちで 400 にしない現行仕様）。

import { DEFAULT_RANGE, RANGE_BY_KEY, type RangeKey } from '../../shared/ranges.js';

export function resolveRange(range: unknown): RangeKey {
  // Object.hasOwn で自前のキーだけを見る。'toString' や '__proto__' を
  // 有効なキーと誤認しないため、in 演算子は使わない。
  return typeof range === 'string' && Object.hasOwn(RANGE_BY_KEY, range)
    ? (range as RangeKey)
    : DEFAULT_RANGE;
}

export function resolveOffset(offset: unknown): number {
  const n = Number(offset);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
