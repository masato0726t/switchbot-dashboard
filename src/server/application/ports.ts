// ユースケースが外界に求めることの一覧。実装は infrastructure が持ち、
// application はこのインターフェースだけを見る。

import type { RangeKey } from '../../shared/ranges.js';
import type { Placement } from '../domain/placement.js';
import type { DeviceInfo, Reading } from '../domain/sensor.js';

export interface DeviceRepository {
  /** 仮想赤外線デバイスを除いた、センサーとして扱うデバイスの一覧 */
  listSensorDevices(): Promise<DeviceInfo[]>;
  /** 設置場所を保存する（未登録なら挿入、登録済みなら更新） */
  savePlacement(deviceId: number, placement: Placement): Promise<void>;
}

export interface SensorLogRepository {
  /** 表示窓に入る測定値を device_id・recorded_at の昇順で返す */
  listReadings(range: RangeKey, offset: number): Promise<Reading[]>;
  /** 表示範囲に依存しない全期間の総件数をデバイス別に返す */
  countByDevice(): Promise<Map<number, number>>;
}

export interface TotalsCache {
  get(): Map<number, number> | undefined;
  set(totals: Map<number, number>): void;
}

// ロガーの型。presentation も infrastructure もここから取ることで、
// presentation → infrastructure という逆向きの import を作らずに済む。
export type { Logger } from 'pino';
