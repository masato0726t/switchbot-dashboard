// エアコン自動制御 API の契約。サーバーは入力の検査と応答の組み立てに、
// クライアントは送信前の検査と受信時の型付けに、同じスキーマを使う。
// 型は z.infer で導出するので二重定義にならない。

import { z } from 'zod';
import { AC_LIMITS, COMMAND_RESULTS, POWER_STATES } from './air-conditioner.js';
import { findScheduleOverlaps, MINUTES_PER_DAY } from './ac-schedule.js';

const {
  targetTempMin, targetTempMax,
  humidityMin, humidityMax,
  tempHysteresisMin, tempHysteresisMax, decimalStep,
  humidityHysteresisMin, humidityHysteresisMax,
  minIntervalMin, minIntervalMax,
  resendIntervalMin, resendIntervalMax,
  sensorMaxAgeMin, sensorMaxAgeMax,
  baseHumidityMin, baseHumidityMax,
  comfortAdjustMaxMin, comfortAdjustMaxMax,
  setpointOffsetMin, setpointOffsetMax,
  fanBoostThresholdMin, fanBoostThresholdMax,
  allowedModesMin, allowedModesMax,
  snoozeHoursMax,
} = AC_LIMITS;

/** 目標温度。setAll にそのまま埋め込むため整数しか許さない。 */
const TargetTempSchema = z
  .number()
  .int(`目標温度は整数の℃で指定してください`)
  .min(targetTempMin)
  .max(targetTempMax);

const HumiditySchema = z.number().int().min(humidityMin).max(humidityMax);

const MinuteSchema = z.number().int().min(0).max(MINUTES_PER_DAY - 1);

const FanSpeedSchema = z.number().int().min(1).max(4);

/** 0.5 刻みの℃を受ける。制御ツールが送信前に整数へ丸めるので、細かすぎる値を許さない。 */
function halfStep(min: number, max: number, label: string) {
  return z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Number.isInteger(v / decimalStep), {
      message: `${label}は ${decimalStep} 刻みで指定してください`,
    });
}

/**
 * 湿度の下限と上限の整合。下限は制御には使わず、ダッシュボードが警告を出す
 * ためだけの値だが、上限以上に設定すると常時警告になり意味を成さない。
 */
function checkHumidityRange(
  value: { humidity_min: number | null; humidity_max: number | null },
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
): void {
  const { humidity_min: min, humidity_max: max } = value;
  if (min !== null && max !== null && min >= max) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'humidity_min'],
      message: '湿度下限は上限より小さい値にしてください',
    });
  }
}

export const AcScheduleSchema = z
  .object({
    start_minute: MinuteSchema,
    end_minute: MinuteSchema,
    target_temp: TargetTempSchema,
    humidity_max: HumiditySchema.nullable(),
    humidity_min: HumiditySchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.start_minute === value.end_minute) {
      ctx.addIssue({
        code: 'custom',
        path: ['end_minute'],
        message: '開始時刻と終了時刻を同じにはできません',
      });
    }
    checkHumidityRange(value, ctx);
  });

/** ルールの作成・更新で受け取る本体。 */
export const AcRuleInputSchema = z
  .object({
    name: z.string().trim().min(1, 'ルール名は必須です'),
    ac_device_id: z.number().int(),
    sensor_device_id: z.number().int(),
    default_target_temp: TargetTempSchema,
    default_humidity_max: HumiditySchema.nullable(),
    default_humidity_min: HumiditySchema.nullable(),
    temp_hysteresis: halfStep(tempHysteresisMin, tempHysteresisMax, '温度の許容幅'),
    humidity_hysteresis: z.number().int().min(humidityHysteresisMin).max(humidityHysteresisMax),
    min_interval_min: z.number().int().min(minIntervalMin).max(minIntervalMax),
    // 0 は「再送しない」を意味する特別な値なので、範囲の下限とは別枠で許す。
    resend_interval_min: z
      .number()
      .int()
      .refine((v) => v === 0 || (v >= resendIntervalMin && v <= resendIntervalMax), {
        message: `再送間隔は 0（再送しない）または ${resendIntervalMin}〜${resendIntervalMax} 分で指定してください`,
      }),
    sensor_max_age_min: z.number().int().min(sensorMaxAgeMin).max(sensorMaxAgeMax),
    fan_speed: FanSpeedSchema.nullable(),
    base_humidity: z.number().int().min(baseHumidityMin).max(baseHumidityMax),
    comfort_adjust_max: halfStep(comfortAdjustMaxMin, comfortAdjustMaxMax, '補正の上限'),
    setpoint_offset: halfStep(setpointOffsetMin, setpointOffsetMax, '設定温度のオフセット'),
    fan_boost_threshold: halfStep(fanBoostThresholdMin, fanBoostThresholdMax, '強風の閾値'),
    // 0 は制御ツールが「未設定＝全許可」として扱う。全部止めるつもりの 0 が
    // 全許可になるのを避けるため、ここで弾いて enabled へ誘導する。
    allowed_modes: z
      .number()
      .int()
      .min(allowedModesMin, '運転を少なくとも 1 つ許可してください。すべて止めるなら自動制御を無効にしてください')
      .max(allowedModesMax),
    schedules: z.array(AcScheduleSchema),
  })
  .superRefine((value, ctx) => {
    checkHumidityRange(
      { humidity_min: value.default_humidity_min, humidity_max: value.default_humidity_max },
      ctx,
      [],
    );

    // 制御ツールは最初に一致した時間帯を採用するため、重複を許すと
    // どちらが効くかが登録順に依存してしまう。ここで弾く。
    for (const [i, j] of findScheduleOverlaps(value.schedules)) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedules', j],
        message: `${i + 1} 番目の時間帯と重複しています`,
      });
    }
  });

/** 最後に送信に成功したコマンド。制御ツールが推定している現在の運転状態。 */
export const AcLastCommandSchema = z.object({
  executed_at: z.string(),
  power: z.enum(POWER_STATES),
  mode: z.number().int(),
  target_temp: z.number().int(),
  fan_speed: z.number().int(),
  reason: z.string(),
});

/** 基準センサーの最新値。 */
export const AcReadingSchema = z.object({
  recorded_at: z.string(),
  temperature: z.number(),
  humidity: z.number().nullable(),
});

export const AcRuleSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  ac_device_id: z.number().int(),
  ac_device_name: z.string().nullable(),
  sensor_device_id: z.number().int(),
  sensor_device_name: z.string().nullable(),
  enabled: z.boolean(),
  snooze_until: z.string().nullable(),
  default_target_temp: z.number().int(),
  default_humidity_max: z.number().int().nullable(),
  default_humidity_min: z.number().int().nullable(),
  temp_hysteresis: z.number(),
  humidity_hysteresis: z.number().int(),
  min_interval_min: z.number().int(),
  resend_interval_min: z.number().int(),
  sensor_max_age_min: z.number().int(),
  fan_speed: z.number().int().nullable(),
  base_humidity: z.number().int(),
  comfort_adjust_max: z.number(),
  setpoint_offset: z.number(),
  fan_boost_threshold: z.number(),
  allowed_modes: z.number().int(),
  schedules: z.array(
    z.object({
      id: z.number().int(),
      start_minute: z.number().int(),
      end_minute: z.number().int(),
      target_temp: z.number().int(),
      humidity_max: z.number().int().nullable(),
      humidity_min: z.number().int().nullable(),
    }),
  ),
  last_command: AcLastCommandSchema.nullable(),
  reading: AcReadingSchema.nullable(),
  /** 現在湿度が下限を下回っているか。エアコンでは加湿できないので表示専用。 */
  humidity_low_warning: z.boolean(),
});

export const AcRuleListResponseSchema = z.array(AcRuleSchema);

export const AcDeviceOptionSchema = z.object({
  id: z.number().int(),
  device_name: z.string().nullable(),
  device_type: z.string().nullable(),
});

export const AcDevicesResponseSchema = z.object({
  air_conditioners: z.array(AcDeviceOptionSchema),
  sensors: z.array(AcDeviceOptionSchema),
});

export const AcCommandLogSchema = z.object({
  id: z.number().int(),
  executed_at: z.string(),
  power: z.enum(POWER_STATES),
  mode: z.number().int(),
  target_temp: z.number().int(),
  fan_speed: z.number().int(),
  sensor_temp: z.number().nullable(),
  sensor_humidity: z.number().nullable(),
  reason: z.string(),
  result: z.enum(COMMAND_RESULTS),
  error_message: z.string().nullable(),
});

export const AcCommandLogListResponseSchema = z.array(AcCommandLogSchema);

export const AcEnabledUpdateRequestSchema = z.object({ enabled: z.boolean() });

export const AcSnoozeRequestSchema = z.object({
  /** 0 は解除を意味する。 */
  hours: z.number().min(0).max(snoozeHoursMax),
});

export const AcRuleIdResponseSchema = z.object({ id: z.number().int() });

export const AcEnabledUpdateResponseSchema = z.object({
  id: z.number().int(),
  enabled: z.boolean(),
});

export const AcSnoozeResponseSchema = z.object({
  id: z.number().int(),
  snooze_until: z.string().nullable(),
});

export type AcScheduleInput = z.infer<typeof AcScheduleSchema>;
export type AcRuleInput = z.infer<typeof AcRuleInputSchema>;
export type AcRuleDto = z.infer<typeof AcRuleSchema>;
export type AcRuleListResponse = z.infer<typeof AcRuleListResponseSchema>;
export type AcDeviceOptionDto = z.infer<typeof AcDeviceOptionSchema>;
export type AcDevicesResponse = z.infer<typeof AcDevicesResponseSchema>;
export type AcCommandLogDto = z.infer<typeof AcCommandLogSchema>;
export type AcCommandLogListResponse = z.infer<typeof AcCommandLogListResponseSchema>;
export type AcEnabledUpdateRequest = z.infer<typeof AcEnabledUpdateRequestSchema>;
export type AcSnoozeRequest = z.infer<typeof AcSnoozeRequestSchema>;
export type AcRuleIdResponse = z.infer<typeof AcRuleIdResponseSchema>;
export type AcEnabledUpdateResponse = z.infer<typeof AcEnabledUpdateResponseSchema>;
export type AcSnoozeResponse = z.infer<typeof AcSnoozeResponseSchema>;
