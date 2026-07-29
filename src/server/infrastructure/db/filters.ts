// ダッシュボードが扱う有効なセンサー行だけに絞る条件。総件数の集計と表示窓の
// 抽出で必ず同じ式を使うため、1 箇所に置いて両方から呼ぶ（件数の整合を保つ）。

import { sql, type Expression, type SqlBool } from 'kysely';

// Kysely の .where() は Expression<SqlBool> を直接受け付けるため、
// ExpressionBuilder を受け取るだけで式内では使わないコールバックにする
// 必要はない（以前はコールバック形状に合わせるためだけの未使用引数だった）。
// AND チェーンは丸括弧で囲む。現状は .where() に単独で渡すだけなので
// 意味を持たないが、括弧が無いと将来ここに eb.not(...) を被せたり
// .orWhere 相当の条件を足したりしたときに、Kysely が後ろに付け足す
// `and <window>` と演算子の優先順位で意図しない結合（例: (NOT A) AND B）を
// 起こしかねない。今のうちに括弧で閉じて、そのリスクを断つ。
export const hasSensorReading: Expression<SqlBool> = sql<SqlBool>`(JSON_LENGTH(l.status_data) > 0
          AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL)`;
