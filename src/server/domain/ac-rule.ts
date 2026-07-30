// エアコン自動制御ルールに関する規則。DB にも HTTP にも依存しない。
//
// 制御の判断そのものは制御ツール auto-air-conditioner が持つ。ダッシュボードは
// 設定を預かって表示するだけなので、ここにあるのは「表示のための規則」だけ。

export interface AcSchedule {
  id: number;
  startMinute: number;
  endMinute: number;
  targetTemp: number;
  humidityMax: number | null;
  humidityMin: number | null;
}

/** 最後に送信に成功したコマンド。制御ツールが推定している現在の運転状態。 */
export interface AcLastCommand {
  executedAt: Date;
  power: 'on' | 'off';
  mode: number;
  targetTemp: number;
  fanSpeed: number;
  reason: string;
}

/** 基準センサーの最新値。 */
export interface AcReading {
  recordedAt: Date;
  temperature: number;
  humidity: number | null;
}

export interface AcRule {
  id: number;
  name: string;
  acDeviceId: number;
  acDeviceName: string | null;
  sensorDeviceId: number;
  sensorDeviceName: string | null;
  enabled: boolean;
  snoozeUntil: Date | null;
  defaultTargetTemp: number;
  defaultHumidityMax: number | null;
  defaultHumidityMin: number | null;
  tempHysteresis: number;
  humidityHysteresis: number;
  minIntervalMin: number;
  resendIntervalMin: number;
  sensorMaxAgeMin: number;
  fanSpeed: number | null;
  baseHumidity: number;
  comfortAdjustMax: number;
  setpointOffset: number;
  fanBoostThreshold: number;
  allowedModes: number;
  schedules: AcSchedule[];
  lastCommand: AcLastCommand | null;
  reading: AcReading | null;
}

export interface AcCommandLog {
  id: number;
  executedAt: Date;
  power: 'on' | 'off';
  mode: number;
  targetTemp: number;
  fanSpeed: number;
  sensorTemp: number | null;
  sensorHumidity: number | null;
  reason: string;
  result: 'success' | 'failure';
  errorMessage: string | null;
}

export interface AcDeviceOption {
  id: number;
  deviceName: string | null;
  deviceType: string | null;
}

/**
 * 湿度が下限を下回っているかを返す。
 *
 * エアコンでは加湿できないため、制御ツールは湿度下限を運転の判断に使わない。
 * 加湿器を出すかどうかは利用者の判断なので、画面で気付けるようにここで導く。
 * 下限が未設定、または湿度を読めないセンサーでは警告しない。
 */
export function isHumidityLow(reading: AcReading | null, humidityMin: number | null): boolean {
  if (reading === null || reading.humidity === null || humidityMin === null) return false;
  return reading.humidity < humidityMin;
}

/**
 * 現在時刻の時点で一時停止中かを返す。
 * 期限切れのスヌーズを「停止中」と表示しないために使う。
 */
export function isSnoozing(snoozeUntil: Date | null, now: Date): boolean {
  return snoozeUntil !== null && snoozeUntil.getTime() > now.getTime();
}
