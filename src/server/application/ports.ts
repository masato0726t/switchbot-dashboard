// ユースケースが外界に求めることの一覧。実装は infrastructure が持ち、
// application はこのインターフェースだけを見る。

import type { AcRuleInput } from '../../shared/ac-contract.js';
import type { RangeKey } from '../../shared/ranges.js';
import type { AcCommandLog, AcDeviceOption, AcRule } from '../domain/ac-rule.js';
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

// エアコン自動制御の設定。テーブルの所有者は制御ツール auto-air-conditioner で、
// ダッシュボードは読み書きするだけ（テーブルは作らない）。
export interface AcRuleRepository {
  /** 全ルールを、時間帯・最新コマンド・基準センサーの最新値付きで返す */
  listRules(): Promise<AcRule[]>;
  /** ルールを作成し、採番された id を返す。時間帯も一緒に保存する */
  createRule(input: AcRuleInput): Promise<number>;
  /** ルールを更新する。時間帯は全置換。対象が無ければ false を返す */
  updateRule(id: number, input: AcRuleInput): Promise<boolean>;
  /** ルールを削除する。対象が無ければ false を返す */
  deleteRule(id: number): Promise<boolean>;
  /** 自動制御の有効／無効を切り替える。対象が無ければ false を返す */
  setEnabled(id: number, enabled: boolean): Promise<boolean>;
  /**
   * 一時停止の期限を設定する。until が null なら解除。
   * 対象が無ければ false を返す
   */
  setSnoozeUntil(id: number, until: Date | null): Promise<boolean>;
  /** 送信履歴を新しい順に返す */
  listCommandLogs(id: number, limit: number): Promise<AcCommandLog[]>;
  /** ルールで選べるエアコンとセンサーの候補を返す */
  listDeviceOptions(): Promise<{ airConditioners: AcDeviceOption[]; sensors: AcDeviceOption[] }>;
}

// ロガーの型。application 層のポートなので、pino など具体的なロギング
// ライブラリの型をそのまま名指しで再輸出しない（技術選定をポートの外へ
// 漏らさない）。実際に呼んでいる形（メッセージのみの info、オブジェクトを
// 先頭に取る warn/error の pino スタイル）だけを構造的に定義し、pino の
// Logger はこれを構造的に満たすのでそのまま渡せる（ダックタイピング）。
// presentation・infrastructure はここから取ることで、presentation →
// infrastructure という逆向きの import を作らずに済む。
export interface Logger {
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}
