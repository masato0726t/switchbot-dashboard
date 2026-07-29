// 時間帯（0 時からの経過分）の扱い。DB にも HTTP にも依存しない純粋関数で、
// サーバーの検証にもクライアントの入力補助にも使う。
//
// 制御ツール側（internal/domain/rule.go の Schedule.Covers）と同じ規則:
// 開始は含み終了は含まない。start > end は日跨ぎ（例: 22:00〜07:00）。

export const MINUTES_PER_DAY = 24 * 60;

/** 重複判定に使う時間帯の最小限の形。目標値などは見ない。 */
export interface MinuteRange {
  start_minute: number;
  end_minute: number;
}

/** 0〜1439 の分を "HH:MM" に変換する。 */
export function minutesToLabel(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** "HH:MM" を 0〜1439 の分に変換する。解釈できなければ null。 */
export function labelToMinutes(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * 日跨ぎを 2 区間に展開して [開始, 終了) の配列にする。
 * これで日跨ぎもそうでないものも、同じ区間比較で扱える。
 */
function toIntervals(range: MinuteRange): [number, number][] {
  return range.start_minute < range.end_minute
    ? [[range.start_minute, range.end_minute]]
    : [
        [range.start_minute, MINUTES_PER_DAY],
        [0, range.end_minute],
      ];
}

function intervalsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * 重なっている時間帯の添字の組を返す。重なりが無ければ空配列。
 *
 * 終了は排他なので、前の終了と次の開始が同じ値（例: 09:00〜18:00 と
 * 18:00〜22:00）は重複としない。制御ツールは最初に一致した時間帯を採用する
 * ため、重複を許すと「どちらが効くか」がルールの登録順に依存してしまう。
 */
export function findScheduleOverlaps(ranges: readonly MinuteRange[]): [number, number][] {
  const pairs: [number, number][] = [];

  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const a = toIntervals(ranges[i]!);
      const b = toIntervals(ranges[j]!);
      if (a.some((x) => b.some((y) => intervalsOverlap(x, y)))) {
        pairs.push([i, j]);
      }
    }
  }
  return pairs;
}
