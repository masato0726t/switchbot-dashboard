// ドメインモデルを API 契約（shared/ac-contract.ts）の形へ写す。
//
// 日時は ISO 文字列で返し、表示の整形はクライアントに任せる。既存の
// センサーデータ API は表示文字列まで組み立てているが、あちらはグラフの
// ツールチップ用に JST 固定の文字列が要るためで、こちらは事情が違う。

import type { AcCommandLogDto, AcRuleDto } from '../../shared/ac-contract.js';
import type { AcRuleView } from '../application/get-ac-rules.js';
import type { AcDeviceOptions } from '../application/get-ac-command-logs.js';
import type { AcCommandLog, AcDeviceOption } from '../domain/ac-rule.js';

export function toAcRuleDto(view: AcRuleView): AcRuleDto {
  const { rule } = view;
  return {
    id: rule.id,
    name: rule.name,
    ac_device_id: rule.acDeviceId,
    ac_device_name: rule.acDeviceName,
    sensor_device_id: rule.sensorDeviceId,
    sensor_device_name: rule.sensorDeviceName,
    enabled: rule.enabled,
    // 期限切れのスヌーズを「停止中」と表示しないよう、切れていれば null にする。
    snooze_until: view.snoozing && rule.snoozeUntil ? rule.snoozeUntil.toISOString() : null,
    default_target_temp: rule.defaultTargetTemp,
    default_humidity_max: rule.defaultHumidityMax,
    default_humidity_min: rule.defaultHumidityMin,
    temp_hysteresis: rule.tempHysteresis,
    humidity_hysteresis: rule.humidityHysteresis,
    min_interval_min: rule.minIntervalMin,
    resend_interval_min: rule.resendIntervalMin,
    sensor_max_age_min: rule.sensorMaxAgeMin,
    fan_speed: rule.fanSpeed,
    base_humidity: rule.baseHumidity,
    comfort_adjust_max: rule.comfortAdjustMax,
    setpoint_offset: rule.setpointOffset,
    fan_boost_threshold: rule.fanBoostThreshold,
    allowed_modes: rule.allowedModes,
    schedules: rule.schedules.map((s) => ({
      id: s.id,
      start_minute: s.startMinute,
      end_minute: s.endMinute,
      target_temp: s.targetTemp,
      humidity_max: s.humidityMax,
      humidity_min: s.humidityMin,
    })),
    last_command: rule.lastCommand
      ? {
          executed_at: rule.lastCommand.executedAt.toISOString(),
          power: rule.lastCommand.power,
          mode: rule.lastCommand.mode,
          target_temp: rule.lastCommand.targetTemp,
          fan_speed: rule.lastCommand.fanSpeed,
          reason: rule.lastCommand.reason,
        }
      : null,
    reading: rule.reading
      ? {
          recorded_at: rule.reading.recordedAt.toISOString(),
          temperature: rule.reading.temperature,
          humidity: rule.reading.humidity,
        }
      : null,
    humidity_low_warning: view.humidityLowWarning,
  };
}

export function toAcCommandLogDto(log: AcCommandLog): AcCommandLogDto {
  return {
    id: log.id,
    executed_at: log.executedAt.toISOString(),
    power: log.power,
    mode: log.mode,
    target_temp: log.targetTemp,
    fan_speed: log.fanSpeed,
    sensor_temp: log.sensorTemp,
    sensor_humidity: log.sensorHumidity,
    reason: log.reason,
    result: log.result,
    error_message: log.errorMessage,
  };
}

function toDeviceOptionDto(option: AcDeviceOption) {
  return {
    id: option.id,
    device_name: option.deviceName,
    device_type: option.deviceType,
  };
}

export function toAcDevicesDto(options: AcDeviceOptions) {
  return {
    air_conditioners: options.airConditioners.map(toDeviceOptionDto),
    sensors: options.sensors.map(toDeviceOptionDto),
  };
}
