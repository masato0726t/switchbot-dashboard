import { sql } from 'kysely';
import type { AcRuleInput } from '../../../shared/ac-contract.js';
import { isAirConditionerType } from '../../../shared/air-conditioner.js';
import type { AcRuleRepository } from '../../application/ports.js';
import type {
  AcCommandLog,
  AcDeviceOption,
  AcLastCommand,
  AcReading,
  AcRule,
  AcSchedule,
} from '../../domain/ac-rule.js';
import type { Db } from './create-db.js';

/**
 * センサー候補と最新値を探す期間。
 *
 * 全期間を JSON 関数で走査すると索引が効かず重くなる（docs/db-performance.md）。
 * recorded_at で先に絞って idx_device_recorded を効かせる。制御ツールは
 * 20 分より古い値では判断しないので、24 時間あれば表示には十分。
 */
const LOOKBACK_HOURS = 24;

/** DECIMAL 列は mysql2 が文字列で返すことがあるので数値へ寄せる。 */
function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : toNumber(value);
}

export function createAcRuleRepository(db: Db): AcRuleRepository {
  /** ルール本体と、結合したデバイス名をまとめて取る。 */
  async function selectRuleRows() {
    return db
      .selectFrom('ac_control_rules as r')
      // 参照先のデバイス行が消えていても、そのルールを画面から消さずに
      // 直せるよう左外部結合にする。
      .leftJoin('devices as ac', 'ac.id', 'r.ac_device_id')
      .leftJoin('devices as sensor', 'sensor.id', 'r.sensor_device_id')
      // 外気温センサーは任意なので、紐づけていないルールでも行が消えないよう
      // ここも左外部結合にする。
      .leftJoin('devices as outdoor', 'outdoor.id', 'r.outdoor_sensor_device_id')
      .select([
        'r.id', 'r.name', 'r.ac_device_id', 'r.sensor_device_id',
        'r.outdoor_sensor_device_id',
        'r.dry_outdoor_temp_min', 'r.dry_outdoor_temp_max', 'r.dry_humidity_margin',
        'r.enabled', 'r.snooze_until',
        'r.default_target_temp', 'r.default_humidity_max', 'r.default_humidity_min',
        'r.temp_hysteresis', 'r.humidity_hysteresis',
        'r.min_interval_min', 'r.resend_interval_min', 'r.sensor_max_age_min', 'r.fan_speed',
        'r.base_humidity', 'r.comfort_adjust_max', 'r.setpoint_offset',
        'r.fan_boost_threshold', 'r.allowed_modes',
        'ac.device_name as ac_device_name',
        'sensor.device_name as sensor_device_name',
        'outdoor.device_name as outdoor_sensor_device_name',
      ])
      .orderBy('r.id')
      .execute();
  }

  /** ルール ID ごとの時間帯設定を取る。 */
  async function selectSchedules(ruleIds: number[]): Promise<Map<number, AcSchedule[]>> {
    const rows = await db
      .selectFrom('ac_control_schedules')
      .select(['id', 'rule_id', 'start_minute', 'end_minute', 'target_temp', 'humidity_max', 'humidity_min'])
      .where('rule_id', 'in', ruleIds)
      .orderBy('rule_id')
      .orderBy('start_minute')
      .execute();

    const byRule = new Map<number, AcSchedule[]>();
    for (const row of rows) {
      const list = byRule.get(row.rule_id) ?? [];
      list.push({
        id: row.id,
        startMinute: row.start_minute,
        endMinute: row.end_minute,
        targetTemp: row.target_temp,
        humidityMax: row.humidity_max,
        humidityMin: row.humidity_min,
      });
      byRule.set(row.rule_id, list);
    }
    return byRule;
  }

  /**
   * ルールごとの「最後に送信に成功したコマンド」を取る。
   *
   * 同一秒に複数行が入り得るため、executed_at ではなく id の最大値で
   * 最後の 1 行を一意に決める（制御ツール側の並べ替えと同じ考え方）。
   */
  async function selectLastCommands(ruleIds: number[]): Promise<Map<number, AcLastCommand>> {
    const latest = db
      .selectFrom('ac_command_logs')
      .select(({ fn }) => ['rule_id', fn.max<number>('id').as('max_id')])
      .where('rule_id', 'in', ruleIds)
      .where('result', '=', 'success')
      .groupBy('rule_id')
      .as('x');

    const rows = await db
      .selectFrom('ac_command_logs as l')
      .innerJoin(latest, (join) => join.onRef('x.max_id', '=', 'l.id'))
      .select(['l.rule_id', 'l.executed_at', 'l.power', 'l.mode', 'l.target_temp', 'l.fan_speed', 'l.reason'])
      .execute();

    return new Map(
      rows.map((row) => [
        row.rule_id,
        {
          executedAt: row.executed_at,
          power: row.power,
          mode: row.mode,
          targetTemp: row.target_temp,
          fanSpeed: row.fan_speed,
          reason: row.reason,
        },
      ]),
    );
  }

  /** 基準センサーごとの最新の温湿度を取る。 */
  async function selectReadings(deviceIds: number[]): Promise<Map<number, AcReading>> {
    const rows = await db
      .selectFrom('device_status_logs as l')
      .select([
        'l.device_id',
        'l.recorded_at',
        sql<string | null>`l.status_data->>'$.temperature'`.as('temperature'),
        sql<string | null>`l.status_data->>'$.humidity'`.as('humidity'),
      ])
      .innerJoin(
        db
          .selectFrom('device_status_logs')
          .select(({ fn }) => ['device_id', fn.max<Date>('recorded_at').as('max_at')])
          .where('device_id', 'in', deviceIds)
          .where(sql<boolean>`recorded_at >= NOW() - INTERVAL ${sql.lit(LOOKBACK_HOURS)} HOUR`)
          .where(sql<boolean>`status_data->>'$.temperature' IS NOT NULL`)
          .groupBy('device_id')
          .as('x'),
        (join) => join.onRef('x.device_id', '=', 'l.device_id').onRef('x.max_at', '=', 'l.recorded_at'),
      )
      .execute();

    const byDevice = new Map<number, AcReading>();
    for (const row of rows) {
      if (row.device_id === null || row.recorded_at === null || row.temperature === null) continue;
      byDevice.set(row.device_id, {
        recordedAt: row.recorded_at,
        temperature: Number(row.temperature),
        humidity: row.humidity === null ? null : Number(row.humidity),
      });
    }
    return byDevice;
  }

  /** 時間帯設定を入れ替える。呼び出し側でトランザクションを張ること。 */
  async function replaceSchedules(trx: Db, ruleId: number, schedules: AcRuleInput['schedules']) {
    await trx.deleteFrom('ac_control_schedules').where('rule_id', '=', ruleId).execute();
    if (schedules.length === 0) return;

    await trx
      .insertInto('ac_control_schedules')
      .values(
        schedules.map((s) => ({
          rule_id: ruleId,
          start_minute: s.start_minute,
          end_minute: s.end_minute,
          target_temp: s.target_temp,
          humidity_max: s.humidity_max,
          humidity_min: s.humidity_min,
        })),
      )
      .execute();
  }

  /** ルール本体の書き込み用の値。作成でも更新でも同じ形を使う。 */
  function toRuleValues(input: AcRuleInput) {
    return {
      name: input.name,
      ac_device_id: input.ac_device_id,
      sensor_device_id: input.sensor_device_id,
      default_target_temp: input.default_target_temp,
      default_humidity_max: input.default_humidity_max,
      default_humidity_min: input.default_humidity_min,
      temp_hysteresis: input.temp_hysteresis,
      humidity_hysteresis: input.humidity_hysteresis,
      min_interval_min: input.min_interval_min,
      resend_interval_min: input.resend_interval_min,
      sensor_max_age_min: input.sensor_max_age_min,
      fan_speed: input.fan_speed,
      base_humidity: input.base_humidity,
      comfort_adjust_max: input.comfort_adjust_max,
      setpoint_offset: input.setpoint_offset,
      fan_boost_threshold: input.fan_boost_threshold,
      allowed_modes: input.allowed_modes,
      outdoor_sensor_device_id: input.outdoor_sensor_device_id,
      dry_outdoor_temp_min: input.dry_outdoor_temp_min,
      dry_outdoor_temp_max: input.dry_outdoor_temp_max,
      dry_humidity_margin: input.dry_humidity_margin,
    };
  }

  return {
    async listRules(): Promise<AcRule[]> {
      const rows = await selectRuleRows();
      if (rows.length === 0) return [];

      const ruleIds = rows.map((row) => row.id);
      // 室内と外気を 1 回の問い合わせでまとめて取る。外気温は紐づけている
      // ルールだけなので、null を除いてから重複を落とす。
      const sensorIds = [
        ...new Set([
          ...rows.map((row) => row.sensor_device_id),
          ...rows.map((row) => row.outdoor_sensor_device_id).filter((id): id is number => id !== null),
        ]),
      ];

      const [schedules, lastCommands, readings] = await Promise.all([
        selectSchedules(ruleIds),
        selectLastCommands(ruleIds),
        selectReadings(sensorIds),
      ]);

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        acDeviceId: row.ac_device_id,
        acDeviceName: row.ac_device_name,
        sensorDeviceId: row.sensor_device_id,
        sensorDeviceName: row.sensor_device_name,
        outdoorSensorDeviceId: row.outdoor_sensor_device_id,
        outdoorSensorDeviceName: row.outdoor_sensor_device_name,
        dryOutdoorTempMin: toNumber(row.dry_outdoor_temp_min),
        dryOutdoorTempMax: toNumber(row.dry_outdoor_temp_max),
        dryHumidityMargin: row.dry_humidity_margin,
        enabled: row.enabled === 1,
        snoozeUntil: row.snooze_until,
        defaultTargetTemp: row.default_target_temp,
        defaultHumidityMax: row.default_humidity_max,
        defaultHumidityMin: row.default_humidity_min,
        tempHysteresis: toNumber(row.temp_hysteresis),
        humidityHysteresis: row.humidity_hysteresis,
        minIntervalMin: row.min_interval_min,
        resendIntervalMin: row.resend_interval_min,
        sensorMaxAgeMin: row.sensor_max_age_min,
        fanSpeed: row.fan_speed,
        baseHumidity: row.base_humidity,
        comfortAdjustMax: toNumber(row.comfort_adjust_max),
        setpointOffset: toNumber(row.setpoint_offset),
        fanBoostThreshold: toNumber(row.fan_boost_threshold),
        allowedModes: row.allowed_modes,
        schedules: schedules.get(row.id) ?? [],
        lastCommand: lastCommands.get(row.id) ?? null,
        reading: readings.get(row.sensor_device_id) ?? null,
        outdoorReading:
          row.outdoor_sensor_device_id === null
            ? null
            : (readings.get(row.outdoor_sensor_device_id) ?? null),
      }));
    },

    async createRule(input: AcRuleInput): Promise<number> {
      return db.transaction().execute(async (trx) => {
        const result = await trx.insertInto('ac_control_rules').values(toRuleValues(input)).executeTakeFirstOrThrow();
        const ruleId = Number(result.insertId);
        await replaceSchedules(trx, ruleId, input.schedules);
        return ruleId;
      });
    },

    async updateRule(id: number, input: AcRuleInput): Promise<boolean> {
      return db.transaction().execute(async (trx) => {
        const result = await trx
          .updateTable('ac_control_rules')
          .set(toRuleValues(input))
          .where('id', '=', id)
          .executeTakeFirst();

        // 値が変わらない更新では numUpdatedRows が 0 になり得るため、
        // 行の存在は別途確認する（存在するのに 404 を返さないため）。
        const exists = await trx
          .selectFrom('ac_control_rules')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst();
        if (exists === undefined) return false;

        void result;
        await replaceSchedules(trx, id, input.schedules);
        return true;
      });
    },

    async deleteRule(id: number): Promise<boolean> {
      const result = await db.deleteFrom('ac_control_rules').where('id', '=', id).executeTakeFirst();
      return Number(result.numDeletedRows ?? 0) > 0;
    },

    async setEnabled(id: number, enabled: boolean): Promise<boolean> {
      await db
        .updateTable('ac_control_rules')
        .set({ enabled: enabled ? 1 : 0 })
        .where('id', '=', id)
        .execute();

      const exists = await db
        .selectFrom('ac_control_rules')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      return exists !== undefined;
    },

    async setSnoozeUntil(id: number, until: Date | null): Promise<boolean> {
      await db
        .updateTable('ac_control_rules')
        .set({ snooze_until: until })
        .where('id', '=', id)
        .execute();

      const exists = await db
        .selectFrom('ac_control_rules')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      return exists !== undefined;
    },

    async listCommandLogs(id: number, limit: number): Promise<AcCommandLog[]> {
      const rows = await db
        .selectFrom('ac_command_logs')
        .select([
          'id', 'executed_at', 'power', 'mode', 'target_temp', 'fan_speed',
          'sensor_temp', 'sensor_humidity', 'outdoor_temp',
          'reason', 'result', 'error_message',
        ])
        .where('rule_id', '=', id)
        .orderBy('executed_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();

      return rows.map((row) => ({
        id: row.id,
        executedAt: row.executed_at,
        power: row.power,
        mode: row.mode,
        targetTemp: row.target_temp,
        fanSpeed: row.fan_speed,
        sensorTemp: toNullableNumber(row.sensor_temp),
        sensorHumidity: toNullableNumber(row.sensor_humidity),
        outdoorTemp: toNullableNumber(row.outdoor_temp),
        reason: row.reason,
        result: row.result,
        errorMessage: row.error_message,
      }));
    },

    async listDeviceOptions() {
      const toOption = (row: {
        id: number;
        device_name: string | null;
        device_type: string | null;
      }): AcDeviceOption => ({
        id: row.id,
        deviceName: row.device_name,
        deviceType: row.device_type,
      });

      // 赤外線リモコンをすべて候補にする。種別（device_type）では絞らない。
      // SwitchBot API は赤外線リモコンの種別を remoteType で返すため、収集ツールが
      // 古いと device_type が空で保存され、種別で絞ると候補が 0 件になってしまう。
      // エアコンかどうかは、種別が分かるものを先頭に並べて画面で示す。
      const infraredDevices = await db
        .selectFrom('devices')
        .select(['id', 'device_name', 'device_type'])
        .where('is_virtual_infrared', '=', 1)
        .orderBy('id')
        .execute();

      const airConditioners = [...infraredDevices].sort((a, b) => {
        const rank = (type: string | null) => (isAirConditionerType(type) ? 0 : 1);
        return rank(a.device_type) - rank(b.device_type) || a.id - b.id;
      });

      // 直近 24 時間に温度ログがあるデバイスだけを候補にする。過去に一度しか
      // 記録が無いデバイスを並べても選ぶ意味が無く、全期間の走査は重い。
      const sensors = await db
        .selectFrom('devices as d')
        .select(['d.id', 'd.device_name', 'd.device_type'])
        .where('d.is_virtual_infrared', '=', 0)
        .where(({ exists, selectFrom }) =>
          exists(
            selectFrom('device_status_logs as l')
              .select('l.id')
              .whereRef('l.device_id', '=', 'd.id')
              .where(sql<boolean>`l.recorded_at >= NOW() - INTERVAL ${sql.lit(LOOKBACK_HOURS)} HOUR`)
              .where(sql<boolean>`l.status_data->>'$.temperature' IS NOT NULL`),
          ),
        )
        .orderBy('d.id')
        .execute();

      return {
        airConditioners: airConditioners.map(toOption),
        sensors: sensors.map(toOption),
      };
    },
  };
}
