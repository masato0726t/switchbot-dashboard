// 表示範囲の定義。サーバー（SQL の時間窓）とクライアント（範囲バー・窓ラベル）が
// 同じ表を見るため、範囲を増減するときに触る場所はこの 1 ファイルだけになる。

/** MySQL の INTERVAL 単位。SQL に文字列として埋めるため、値はここで閉じる。 */
export type IntervalUnit = 'HOUR' | 'DAY' | 'MONTH' | 'YEAR';

export const INTERVAL_UNITS: ReadonlySet<string> = new Set<IntervalUnit>([
  'HOUR', 'DAY', 'MONTH', 'YEAR',
]);

export interface RangeSpec {
  /** API のクエリ値・DOM の data 属性に使うキー */
  readonly key: RangeKey;
  /** 範囲バーのボタン表示 */
  readonly label: string;
  /** 窓の幅（unit 単位）。'all' は窓を持たないので 0 */
  readonly count: number;
  /** MySQL の INTERVAL 単位。'all' は窓を持たないので null */
  readonly unit: IntervalUnit | null;
  /** 窓ラベル（「48〜72時間前」）に使う日本語の単位 */
  readonly unitJa: string;
  /** 過去へページングできるか。'all' は窓幅を持たないため不可 */
  readonly pageable: boolean;
}

export const RANGES = [
  { key: '1h',  label: '1時間',  count: 1,  unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '6h',  label: '6時間',  count: 6,  unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '12h', label: '12時間', count: 12, unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '24h', label: '24時間', count: 24, unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '1w',  label: '1週間',  count: 7,  unit: 'DAY',   unitJa: '日',   pageable: true },
  { key: '1mo', label: '1ヶ月',  count: 1,  unit: 'MONTH', unitJa: 'ヶ月', pageable: true },
  { key: '1y',  label: '1年',    count: 1,  unit: 'YEAR',  unitJa: '年',   pageable: true },
  { key: '3y',  label: '3年',    count: 3,  unit: 'YEAR',  unitJa: '年',   pageable: true },
  { key: 'all', label: '全部',   count: 0,  unit: null,    unitJa: '',     pageable: false },
] as const satisfies readonly RangeSpec[];

export type RangeKey =
  '1h' | '6h' | '12h' | '24h' | '1w' | '1mo' | '1y' | '3y' | 'all';

export const RANGE_KEYS: readonly RangeKey[] = RANGES.map((r) => r.key);

export const RANGE_BY_KEY: Readonly<Record<RangeKey, RangeSpec>> =
  Object.fromEntries(RANGES.map((r) => [r.key, r])) as Record<RangeKey, RangeSpec>;

export const DEFAULT_RANGE: RangeKey = '24h';
