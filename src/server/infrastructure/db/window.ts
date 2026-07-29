// 表示範囲とページオフセットから recorded_at の絞り込みを組み立てる。
//
// 時刻の基準は DB の NOW() のまま残す。アプリ側で Date を計算すると、
// DB が別ホストにある構成で時計ずれという新しい障害要因が増えるうえ、
// INTERVAL 1 MONTH の月末クランプ挙動を JS 側で再現する必要も出るため。
//
// unit は RANGE_BY_KEY 由来の固定文字列、count は必ずバインドするので
// 注入の余地はない。条件を「付ける / 付けない」の分岐は Kysely の $if で
// 表現し、SQL 断片の文字列連結は行わない。

import { sql, type SelectQueryBuilder } from 'kysely';
import { RANGE_BY_KEY, type IntervalUnit } from '../../../shared/ranges.js';
import { resolveOffset, resolveRange } from '../../domain/range.js';
import type { Database, DeviceStatusLogsTable } from './schema.js';

// Kysely の TB 型引数は「DB のキー」しか受け付けないため、`selectFrom('device_status_logs as l')`
// が実際に作る「エイリアス l を device_status_logs 行型として持つ DB」を型でも再現する。
type LogsDb = Database & Record<'l', DeviceStatusLogsTable>;
type LogsQuery<O> = SelectQueryBuilder<LogsDb, 'l', O>;

const ago = (count: number, unit: IntervalUnit) =>
  sql<Date>`DATE_SUB(NOW(), INTERVAL ${count} ${sql.raw(unit)})`;

// range / offset はクエリ文字列由来の未検証の値を受け取り、内部で丸める。
export function applyWindow<O>(qb: LogsQuery<O>, range: unknown, offset: unknown): LogsQuery<O> {
  const spec = RANGE_BY_KEY[resolveRange(range)];
  if (spec.unit === null) return qb;          // 'all' は窓幅を持たないので絞り込まない

  const unit = spec.unit;
  const off = resolveOffset(offset);

  // offset=0 は最新ウィンドウ（下限のみ）。offset=k は 1 区間幅ずつ k 個ぶん
  // 過去の窓 [NOW-(k+1)*span, NOW-k*span)。
  return qb
    .where('l.recorded_at', '>=', ago(spec.count * (off + 1), unit))
    .$if(off > 0, (q) => q.where('l.recorded_at', '<', ago(spec.count * off, unit)));
}
