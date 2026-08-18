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

// ac_* の 3 テーブルは制御ツール auto-air-conditioner が所有し、goose の
// マイグレーションで作られる。ダッシュボードは読み書きするだけで、テーブルは
// 作らない（ddl/ac_*.sql は参照用に置いてあるだけで起動時には実行しない）。

export interface AcControlRulesTable {
  id: Generated<number>;
  name: string;
  ac_device_id: number;
  sensor_device_id: number;
  /** NULL は「外気温を見ない」を意味する */
  outdoor_sensor_device_id: number | null;
  /** DECIMAL 列。mysql2 は文字列で返すことがあるため両方を受ける */
  dry_outdoor_temp_min: number | string;
  dry_outdoor_temp_max: number | string;
  dry_humidity_margin: number;
  /** DDL に DEFAULT 1 があるので INSERT では省略できる */
  enabled: Generated<number>;
  /** 既定は NULL（一時停止していない）。INSERT では省略できる */
  snooze_until: Generated<Date | null>;
  default_target_temp: number;
  default_humidity_max: number | null;
  default_humidity_min: number | null;
  /** DECIMAL 列。mysql2 は文字列で返すことがあるため両方を受ける */
  temp_hysteresis: number | string;
  humidity_hysteresis: number;
  min_interval_min: number;
  resend_interval_min: number;
  sensor_max_age_min: number;
  /** NULL は「偏差から自動判別」を意味する */
  fan_speed: number | null;
  base_humidity: number;
  /** DECIMAL 列。mysql2 は文字列で返すことがあるため両方を受ける */
  comfort_adjust_max: number | string;
  setpoint_offset: number | string;
  fan_boost_threshold: number | string;
  allowed_modes: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AcControlSchedulesTable {
  id: Generated<number>;
  rule_id: number;
  start_minute: number;
  end_minute: number;
  target_temp: number;
  humidity_max: number | null;
  humidity_min: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AcCommandLogsTable {
  id: Generated<number>;
  rule_id: number;
  executed_at: Date;
  power: 'on' | 'off';
  mode: number;
  target_temp: number;
  fan_speed: number;
  sensor_temp: number | string | null;
  sensor_humidity: number | string | null;
  outdoor_temp: number | string | null;
  reason: string;
  result: 'success' | 'failure';
  error_message: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  devices: DevicesTable;
  device_status_logs: DeviceStatusLogsTable;
  device_settings: DeviceSettingsTable;
  ac_control_rules: AcControlRulesTable;
  ac_control_schedules: AcControlSchedulesTable;
  ac_command_logs: AcCommandLogsTable;
}

// Kysely の TB 型引数は「DB のキー」しか受け付けないため、`selectFrom('device_status_logs as l')`
// が実際に作る「エイリアス l を device_status_logs 行型として持つ DB」を型でも再現する。
// filters.ts / window.ts の 2 箇所から使うのでここに置く。
export type LogsDb = Database & Record<'l', DeviceStatusLogsTable>;
