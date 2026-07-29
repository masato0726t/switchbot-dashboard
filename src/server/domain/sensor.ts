// センサーデータの語彙。DB の列名でも API のフィールド名でもなく、
// ダッシュボードが扱う概念としての型をここで定義する。

import type { Placement } from './placement.js';

/** デバイス 1 台の属性。placement は未設定なら null（type から推測する）。 */
export interface DeviceInfo {
  readonly id: number;
  readonly name: string | null;
  readonly type: string | null;
  readonly placement: Placement | null;
}

/** 1 回の測定。co2 / battery はそのデバイスが持つときだけ現れる。 */
export interface Reading {
  readonly deviceId: number;
  /** 測定時刻（エポックミリ秒） */
  readonly ts: number;
  readonly temperature: number | null;
  readonly humidity: number | null;
  readonly co2?: number;
  readonly battery?: number;
}

/** 時系列の 1 点。Reading から deviceId を除いたもの。 */
export type SeriesPoint = Omit<Reading, 'deviceId'>;

/** デバイス 1 台ぶんの時系列。 */
export interface DeviceSeries {
  readonly deviceId: number;
  readonly name: string | null;
  readonly type: string | null;
  readonly placement: Placement;
  /** 表示範囲に依存しない全期間の総件数 */
  readonly total: number;
  /** LTTB で間引いたか */
  readonly downsampled: boolean;
  readonly points: readonly SeriesPoint[];
}
