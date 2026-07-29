// ダッシュボードが扱う有効なセンサー行だけに絞る条件。総件数の集計と表示窓の
// 抽出で必ず同じ式を使うため、1 箇所に置いて両方から呼ぶ（件数の整合を保つ）。

import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { Database, DeviceStatusLogsTable } from './schema.js';

// window.ts と同じ理由で、エイリアス l を合成した DB 型を TB の制約に使う。
type LogsDb = Database & Record<'l', DeviceStatusLogsTable>;

export function hasSensorReading(
  _eb: ExpressionBuilder<LogsDb, 'l'>,
): Expression<SqlBool> {
  return sql<SqlBool>`JSON_LENGTH(l.status_data) > 0
          AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL`;
}
