// 総件数の TTL キャッシュ。総件数クエリは range/offset に依存せず全行を走査する
// 重い集計で、JSON 関数のため索引も効かない。値は新規ログでしか増えず変化が
// 緩やかなので、TTL の間は結果を使い回して実行頻度を下げる
// （UI は 30 秒ごとに更新するため毎回の再集計は不要）。

import { LRUCache } from 'lru-cache';
import type { TotalsCache } from '../application/ports.js';

const KEY = 'totals';

export function createTotalsCache(ttlMs: number): TotalsCache {
  // lru-cache は既定で `performance` オブジェクトを import 時点の参照として
  // 捕まえる。vitest の vi.useFakeTimers() はグローバルの performance を
  // 「差し替え」るため（既存オブジェクトの書き換えではない）、既定設定だと
  // インポート時に捕まえた実時計を見続けてしまい、advanceTimersByTime が
  // 効かず TTL が検証できない。呼び出しのたびに現在の Date.now を引く関数を
  // 渡すことで、テストでも本番と同じ TTL ロジックを検証できるようにする。
  const cache = new LRUCache<string, Map<number, number>>({
    max: 1,
    ttl: ttlMs,
    perf: { now: () => Date.now() },
  });
  return {
    get: () => cache.get(KEY),
    set: (totals) => { cache.set(KEY, totals); },
  };
}
