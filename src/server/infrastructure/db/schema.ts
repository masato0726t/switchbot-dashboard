// Kysely が参照するテーブル定義。ddl/ の CREATE TABLE と 1 対 1 で対応する。
// devices / device_status_logs はデータ収集側が管理するテーブルで、
// ダッシュボードは参照のみ。device_settings だけが自己管理。

import type { Generated } from 'kysely';
import type { Placement } from '../../domain/placement.js';

export interface DevicesTable {
  id: number;
  device_name: string | null;
  device_type: string | null;
  is_virtual_infrared: number | null;
}

export interface DeviceStatusLogsTable {
  id: Generated<number>;
  device_id: number | null;
  /** JSON 列。中身の形は収集側が決めるので unknown で受けて repository で絞り込む */
  status_data: unknown;
  recorded_at: Date | null;
}

export interface DeviceSettingsTable {
  device_id: number;
  placement: Placement;
}

export interface Database {
  devices: DevicesTable;
  device_status_logs: DeviceStatusLogsTable;
  device_settings: DeviceSettingsTable;
}

// Kysely の TB 型引数は「DB のキー」しか受け付けないため、`selectFrom('device_status_logs as l')`
// が実際に作る「エイリアス l を device_status_logs 行型として持つ DB」を型でも再現する。
// filters.ts / window.ts の 2 箇所から使うのでここに置く。
export type LogsDb = Database & Record<'l', DeviceStatusLogsTable>;
