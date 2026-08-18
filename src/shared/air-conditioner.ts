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

/**
 * 許可する運転モードのビット。制御ツールの ModeSet と同じ並び。
 *
 * ゼロ値は制御ツール側で「未設定＝全許可」として扱われる。写し忘れた経路が
 * あってもルールが黙って沈黙しないようにする防御だが、そのぶん 0 を保存すると
 * 全部止めたつもりで全部動く。保存前に弾くこと。
 */
export const MODE_BITS = { cool: 1, dry: 2, heat: 4 } as const;
export const ALL_MODES = MODE_BITS.cool | MODE_BITS.dry | MODE_BITS.heat;

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
  /** 温度系の小数入力の刻み。setAll に渡る前に制御ツールが丸めるので細かすぎる値を許さない。 */
  decimalStep: 0.5,
  baseHumidityMin: 1,
  baseHumidityMax: 99,
  comfortAdjustMaxMin: 0,
  comfortAdjustMaxMax: 5,
  setpointOffsetMin: 0,
  setpointOffsetMax: 5,
  fanBoostThresholdMin: 0.5,
  fanBoostThresholdMax: 5,
  allowedModesMin: 1,
  allowedModesMax: ALL_MODES,
  /** ドライを優先する外気温の範囲。宅内で現実的に取り得る値に収める。 */
  outdoorTempMin: -20,
  outdoorTempMax: 50,
  /** ドライ優先中に湿度上限を下げる幅(%)。0 は「下げない＝従来どおり」。 */
  dryHumidityMarginMin: 0,
  dryHumidityMarginMax: 20,
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
 * 新規ルールの既定値。
 *
 * 画面の初期値とテストの前提を 1 か所に集める。別々に書くと、片方だけ変えても
 * テストが通り続け「既定では警告が出ない」という主張が空洞化する。
 *
 * 制御ツール側の DDL の既定値と揃えてある。fan_speed は 1（エアコンにまかせる）で、
 * 風量の自動判別はオプトインという方針を崩さない。
 */
export const AC_RULE_DEFAULTS = {
  default_target_temp: 25,
  default_humidity_max: 60,
  default_humidity_min: 40,
  temp_hysteresis: 1,
  humidity_hysteresis: 5,
  min_interval_min: 10,
  resend_interval_min: 60,
  sensor_max_age_min: 20,
  fan_speed: 1,
  base_humidity: 50,
  comfort_adjust_max: 1.5,
  setpoint_offset: 2,
  fan_boost_threshold: 2,
  allowed_modes: ALL_MODES,
  /** 外気温センサーは任意。紐づけるまで外気温は見ない。 */
  outdoor_sensor_device_id: null,
  dry_outdoor_temp_min: 20,
  dry_outdoor_temp_max: 30,
  dry_humidity_margin: 5,
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

/**
 * 風量「弱」が到達不能な組み合わせかを返す。
 *
 * 冷暖の運転開始には偏差が温度の許容幅を超える必要があり、中へ上がる閾値は
 * 強風閾値の半分。したがって強風閾値が許容幅の 2 倍以下だと、弱の段には
 * 決して落ちない。風量が固定のときは強風閾値そのものが参照されないので
 * 警告しない。
 */
export function isFanLowUnreachable(
  fanSpeed: number | null,
  fanBoostThreshold: number,
  tempHysteresis: number,
): boolean {
  if (fanSpeed !== null) return false;
  return fanBoostThreshold <= tempHysteresis * 2;
}

/**
 * 外気温がドライを優先する範囲にあるかを返す。
 *
 * 制御ツール側の dryPreferred と同じ判定（下限は以上、上限は未満）。画面で
 * 「いま効いているのか」を示すために使う。外気温を読めないときは false。
 */
export function isDryPreferredByOutdoor(
  outdoorTemp: number | null,
  min: number,
  max: number,
): boolean {
  if (outdoorTemp === null) return false;
  return outdoorTemp >= min && outdoorTemp < max;
}

/**
 * 外気温の範囲が空になっていないかを返す。
 *
 * 下限が上限以上だと、どんな外気温でも条件を満たさずドライ優先が永久に
 * 効かない。保存前に気付けるようにする。
 */
export function isOutdoorRangeEmpty(min: number, max: number): boolean {
  return min >= max;
}

/**
 * 外気温の設定が効かない組み合わせかを返す。
 *
 * ドライを許可していないルールでは、制御ツールが外気温の判定そのものを
 * 落とす（暑いときにドライを選んでゲートに塞がれ「暑いのに停止」になるのを
 * 防ぐため）。センサーを紐づけていても設定は無視されるので、画面で示す。
 */
export function isOutdoorSettingIgnored(
  outdoorSensorDeviceId: number | null,
  allowedModes: number,
): boolean {
  return outdoorSensorDeviceId !== null && (allowedModes & MODE_BITS.dry) === 0;
}

/**
 * 基準湿度が高すぎて、基準の状態が常にドライ運転の条件を満たすかを返す。
 *
 * 基準湿度は「その部屋のふだんの湿度」に合わせる設定だが、湿度上限に近づけると
 * 補正が効いている状態が常にドライの継続条件（湿度 > 上限 − 許容幅）に入る。
 * 補正しない設定、湿度上限が未設定、ドライが許可されていない、のいずれかで
 * ドライは動かないので警告しない。
 */
export function isBaseHumidityTooHigh(
  comfortAdjustMax: number,
  baseHumidity: number,
  humidityMax: number | null,
  humidityHysteresis: number,
  allowedModes: number,
): boolean {
  if (comfortAdjustMax <= 0 || humidityMax === null) return false;
  if ((allowedModes & MODE_BITS.dry) === 0) return false;
  return baseHumidity >= humidityMax - humidityHysteresis;
}
