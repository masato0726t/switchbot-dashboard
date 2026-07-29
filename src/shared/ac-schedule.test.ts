import { describe, expect, it } from 'vitest';
import { findScheduleOverlaps, labelToMinutes, minutesToLabel } from './ac-schedule.js';

describe('minutesToLabel', () => {
  it('分を HH:MM に変換する', () => {
    expect(minutesToLabel(0)).toBe('00:00');
    expect(minutesToLabel(9 * 60 + 5)).toBe('09:05');
    expect(minutesToLabel(23 * 60 + 59)).toBe('23:59');
  });
});

describe('labelToMinutes', () => {
  it('HH:MM を分に変換する', () => {
    expect(labelToMinutes('00:00')).toBe(0);
    expect(labelToMinutes('09:05')).toBe(545);
    expect(labelToMinutes('23:59')).toBe(1439);
  });

  it('1 桁の時も受け付ける', () => {
    expect(labelToMinutes('9:05')).toBe(545);
  });

  it('解釈できない文字列は null を返す', () => {
    expect(labelToMinutes('')).toBeNull();
    expect(labelToMinutes('24:00')).toBeNull();
    expect(labelToMinutes('12:60')).toBeNull();
    expect(labelToMinutes('1230')).toBeNull();
    expect(labelToMinutes('あ')).toBeNull();
  });

  it('minutesToLabel と往復できる', () => {
    for (const minute of [0, 1, 545, 720, 1439]) {
      expect(labelToMinutes(minutesToLabel(minute))).toBe(minute);
    }
  });
});

describe('findScheduleOverlaps', () => {
  it('重なりが無ければ空配列を返す', () => {
    expect(
      findScheduleOverlaps([
        { start_minute: 9 * 60, end_minute: 18 * 60 },
        { start_minute: 19 * 60, end_minute: 22 * 60 },
      ]),
    ).toEqual([]);
  });

  it('境界が接するだけなら重複としない', () => {
    // 終了は排他なので 18:00 は前の時間帯に含まれない。
    expect(
      findScheduleOverlaps([
        { start_minute: 9 * 60, end_minute: 18 * 60 },
        { start_minute: 18 * 60, end_minute: 22 * 60 },
      ]),
    ).toEqual([]);
  });

  it('重なっている組を返す', () => {
    expect(
      findScheduleOverlaps([
        { start_minute: 9 * 60, end_minute: 18 * 60 },
        { start_minute: 17 * 60, end_minute: 22 * 60 },
      ]),
    ).toEqual([[0, 1]]);
  });

  it('日跨ぎと朝の時間帯の重なりを検出する', () => {
    expect(
      findScheduleOverlaps([
        { start_minute: 22 * 60, end_minute: 7 * 60 },
        { start_minute: 6 * 60, end_minute: 8 * 60 },
      ]),
    ).toEqual([[0, 1]]);
  });

  it('日跨ぎと夜の時間帯の重なりを検出する', () => {
    expect(
      findScheduleOverlaps([
        { start_minute: 22 * 60, end_minute: 7 * 60 },
        { start_minute: 21 * 60, end_minute: 23 * 60 },
      ]),
    ).toEqual([[0, 1]]);
  });

  it('日跨ぎでも離れていれば重複しない', () => {
    expect(
      findScheduleOverlaps([
        { start_minute: 22 * 60, end_minute: 7 * 60 },
        { start_minute: 8 * 60, end_minute: 18 * 60 },
      ]),
    ).toEqual([]);
  });

  it('3 件以上でもすべての組を返す', () => {
    expect(
      findScheduleOverlaps([
        { start_minute: 0, end_minute: 12 * 60 },
        { start_minute: 6 * 60, end_minute: 18 * 60 },
        { start_minute: 10 * 60, end_minute: 11 * 60 },
      ]),
    ).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it('0 件・1 件では重複しない', () => {
    expect(findScheduleOverlaps([])).toEqual([]);
    expect(findScheduleOverlaps([{ start_minute: 0, end_minute: 60 }])).toEqual([]);
  });
});
