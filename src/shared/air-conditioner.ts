// エアコン制御まわりの定数。サーバーの検証にもクライアントの表示にも使う。
//
// 値の出どころは SwitchBot API の setAll コマンド仕様
// （parameter = "{温度},{モード},{風量},{電源}"）と、制御ツール
// auto-air-conditioner の README にある制御の仕組み。

/** 運転モード。API は自動(0/1)と送風(4)も受け付けるが、制御ツールは使わない。 */
export const AC_MODES = { cool: 2, dry: 3, heat: 5 } as const;
export type AcMode = (typeof AC_MODES)[keyof typeof AC_MODES];

/** 風量。 */
export const FAN_SPEEDS = { auto: 1, low: 2, medium: 3, high: 4 } as const;
export type FanSpeed = (typeof FAN_SPEEDS)[keyof typeof FAN_SPEEDS];

/** 電源状態。 */
export const POWER_STATES = ['on', 'off'] as const;
export type PowerState = (typeof POWER_STATES)[number];

/** 送信結果。 */
export const COMMAND_RESULTS = ['success', 'failure'] as const;
export type CommandResult = (typeof COMMAND_RESULTS)[number];

const MODE_LABELS: Record<number, string> = {
  [AC_MODES.cool]: '冷房',
  [AC_MODES.dry]: 'ドライ',
  [AC_MODES.heat]: '暖房',
};

const FAN_SPEED_LABELS: Record<number, string> = {
  [FAN_SPEEDS.auto]: '自動',
  [FAN_SPEEDS.low]: '弱',
  [FAN_SPEEDS.medium]: '中',
  [FAN_SPEEDS.high]: '強',
};

export function modeLabel(mode: number): string {
  return MODE_LABELS[mode] ?? '不明';
}

export function fanSpeedLabel(speed: number): string {
  return FAN_SPEED_LABELS[speed] ?? '不明';
}

/**
 * 入力値の許容範囲。制御ツール側の DDL と揃えてある。
 *
 * 目標温度が整数なのは、setAll の parameter にそのまま埋め込まれるため。
 * 再送間隔の 0 は「再送しない」を意味する特別な値で、範囲の下限とは別枠で許す。
 */
export const AC_LIMITS = {
  targetTempMin: 16,
  targetTempMax: 30,
  humidityMin: 0,
  humidityMax: 100,
  tempHysteresisMin: 0.5,
  tempHysteresisMax: 5,
  tempHysteresisStep: 0.5,
  humidityHysteresisMin: 1,
  humidityHysteresisMax: 20,
  minIntervalMin: 1,
  minIntervalMax: 120,
  resendIntervalMin: 10,
  resendIntervalMax: 720,
  sensorMaxAgeMin: 5,
  sensorMaxAgeMax: 240,
  snoozeHoursMax: 24,
  logLimitDefault: 50,
  logLimitMax: 200,
} as const;

/**
 * エアコンとして認識できる赤外線リモコンの種別。
 *
 * 学習リモコンとして自分で登録したものは "DIY Air Conditioner" になるため
 * 両方を見る。
 */
const AIR_CONDITIONER_DEVICE_TYPES = ['Air Conditioner', 'DIY Air Conditioner'];

/**
 * 種別からエアコンだと判断できるかを返す。
 *
 * 種別が空のこともある（収集ツールが古いと赤外線リモコンの種別を保存できない）。
 * そのため候補の絞り込みには使わず、並び順と画面の注意書きにだけ使う。
 * 制御対象として選べるかどうかは `is_virtual_infrared` で判断する。
 */
export function isAirConditionerType(type: string | null): boolean {
  return type !== null && AIR_CONDITIONER_DEVICE_TYPES.includes(type);
}
