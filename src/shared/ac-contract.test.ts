import { describe, expect, it } from 'vitest';
import { AcRuleInputSchema, AcSnoozeRequestSchema } from './ac-contract.js';

// validRule は検証を通る最小のルール入力を返す。
function validRule(overrides: Record<string, unknown> = {}) {
  return {
    name: 'リビング',
    ac_device_id: 1,
    sensor_device_id: 2,
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
    allowed_modes: 7,
    schedules: [],
    ...overrides,
  };
}

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    start_minute: 22 * 60,
    end_minute: 7 * 60,
    target_temp: 27,
    humidity_max: null,
    humidity_min: null,
    ...overrides,
  };
}

// 検証に失敗したときのメッセージをまとめて返す（どの規則で落ちたかの確認用）。
function errorsOf(input: unknown): string[] {
  const result = AcRuleInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('AcRuleInputSchema', () => {
  it('正しい入力は通る', () => {
    expect(AcRuleInputSchema.safeParse(validRule()).success).toBe(true);
  });

  it('ルール名は必須で前後の空白を落とす', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ name: '   ' })).success).toBe(false);

    const parsed = AcRuleInputSchema.parse(validRule({ name: '  リビング  ' }));
    expect(parsed.name).toBe('リビング');
  });

  it('デバイスは整数の id で指定する', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ ac_device_id: 'x' })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ sensor_device_id: 1.5 })).success).toBe(false);
  });

  it('目標温度は 16〜30 の整数', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ default_target_temp: 16 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ default_target_temp: 30 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ default_target_temp: 15 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ default_target_temp: 31 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ default_target_temp: 25.5 })).success).toBe(false);
  });

  it('湿度は 0〜100 で、下限は上限より小さいこと', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ default_humidity_max: 101 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ default_humidity_min: -1 })).success).toBe(false);
    expect(
      errorsOf(validRule({ default_humidity_min: 70, default_humidity_max: 60 })),
    ).toContain('湿度下限は上限より小さい値にしてください');
  });

  it('湿度は両方 null でもよい', () => {
    const input = validRule({ default_humidity_max: null, default_humidity_min: null });
    expect(AcRuleInputSchema.safeParse(input).success).toBe(true);
  });

  it('温度の許容幅は 0.5 刻みで 0.5〜5.0', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ temp_hysteresis: 0.5 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ temp_hysteresis: 1.5 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ temp_hysteresis: 0.4 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ temp_hysteresis: 5.5 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ temp_hysteresis: 1.2 })).success).toBe(false);
  });

  it('再送間隔は 0（再送しない）か 10〜720 分', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ resend_interval_min: 0 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ resend_interval_min: 10 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ resend_interval_min: 720 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ resend_interval_min: 5 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ resend_interval_min: 721 })).success).toBe(false);
  });

  it('その他の間隔の値域', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ min_interval_min: 0 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ min_interval_min: 121 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ sensor_max_age_min: 4 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ sensor_max_age_min: 241 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ humidity_hysteresis: 0 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ humidity_hysteresis: 21 })).success).toBe(false);
  });

  it('風量は 1〜4', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ fan_speed: 1 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ fan_speed: 4 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ fan_speed: 0 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ fan_speed: 5 })).success).toBe(false);
  });
});

describe('AcRuleInputSchema の時間帯', () => {
  it('日跨ぎは許す', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ schedules: [schedule()] })).success).toBe(true);
  });

  it('開始と終了が同じ時刻は許さない', () => {
    const input = validRule({ schedules: [schedule({ start_minute: 600, end_minute: 600 })] });
    expect(errorsOf(input)).toContain('開始時刻と終了時刻を同じにはできません');
  });

  it('分は 0〜1439', () => {
    const input = validRule({ schedules: [schedule({ start_minute: 0, end_minute: 1440 })] });
    expect(AcRuleInputSchema.safeParse(input).success).toBe(false);
  });

  it('時間帯ごとの目標温度も 16〜30 の整数', () => {
    const input = validRule({ schedules: [schedule({ target_temp: 31 })] });
    expect(AcRuleInputSchema.safeParse(input).success).toBe(false);
  });

  it('時間帯ごとの湿度も下限 < 上限', () => {
    const input = validRule({
      schedules: [schedule({ humidity_min: 70, humidity_max: 60 })],
    });
    expect(errorsOf(input)).toContain('湿度下限は上限より小さい値にしてください');
  });

  it('重複する時間帯は許さない', () => {
    const input = validRule({
      schedules: [
        schedule({ start_minute: 9 * 60, end_minute: 18 * 60 }),
        schedule({ start_minute: 17 * 60, end_minute: 22 * 60 }),
      ],
    });
    expect(errorsOf(input)).toContain('1 番目の時間帯と重複しています');
  });

  it('接しているだけの時間帯は許す', () => {
    const input = validRule({
      schedules: [
        schedule({ start_minute: 9 * 60, end_minute: 18 * 60 }),
        schedule({ start_minute: 18 * 60, end_minute: 22 * 60 }),
      ],
    });
    expect(AcRuleInputSchema.safeParse(input).success).toBe(true);
  });
});

describe('AcSnoozeRequestSchema', () => {
  it('0〜24 時間を受け付ける', () => {
    expect(AcSnoozeRequestSchema.safeParse({ hours: 0 }).success).toBe(true);
    expect(AcSnoozeRequestSchema.safeParse({ hours: 24 }).success).toBe(true);
    expect(AcSnoozeRequestSchema.safeParse({ hours: 1.5 }).success).toBe(true);
  });

  it('範囲外は拒否する', () => {
    expect(AcSnoozeRequestSchema.safeParse({ hours: -1 }).success).toBe(false);
    expect(AcSnoozeRequestSchema.safeParse({ hours: 25 }).success).toBe(false);
  });
});

describe('AcRuleInputSchema の体感ベース制御の設定', () => {
  // ゼロ値は制御ツールが「全許可」として扱う。全部止めるつもりで 0 を
  // 保存すると全部動く。ここで弾く。弾くだけでは利用者が行き先を失うので、
  // メッセージが「自動制御を無効に」へ誘導していることまで検証する。
  it('許可する運転が 0 なら弾き、自動制御の無効化へ誘導する', () => {
    const result = AcRuleInputSchema.safeParse(validRule({ allowed_modes: 0 }));
    expect(result.success).toBe(false);
    expect(errorsOf(validRule({ allowed_modes: 0 }))).toContain(
      '運転を少なくとも 1 つ許可してください。すべて止めるなら自動制御を無効にしてください',
    );
  });

  it('許可する運転は 1 から 7 まで通る', () => {
    for (const value of [1, 3, 6, 7]) {
      expect(AcRuleInputSchema.safeParse(validRule({ allowed_modes: value })).success).toBe(true);
    }
  });

  it('許可する運転が 8 以上なら弾く', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ allowed_modes: 8 })).success).toBe(false);
  });

  // NULL は「偏差から自動判別」を意味する。
  it('風量が null なら通る', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ fan_speed: null })).success).toBe(true);
  });

  it('基準湿度は 1 から 99 まで', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 1 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 99 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 0 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 100 })).success).toBe(false);
  });

  it('小数の設定は 0.5 刻みでなければ弾く', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ comfort_adjust_max: 1.2 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ setpoint_offset: 2.3 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ fan_boost_threshold: 1.7 })).success).toBe(false);
  });

  it('補正上限とオフセットは 0 を許す', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ comfort_adjust_max: 0 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ setpoint_offset: 0 })).success).toBe(true);
  });

  // 制御ツールは 0（常に強）も受け付けるが、UI から縮退設定を勧める理由がない。
  it('強風閾値の 0 は弾く', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ fan_boost_threshold: 0 })).success).toBe(false);
  });
});
