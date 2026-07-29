// ドメインの時系列を API の JSON へ変換する。表示のための都合（JST の日時文字列、
// スネークケースのキー名、キーの並び順）はこの層だけが知る。

import type {
  DeviceSeriesDto, SensorDataResponse, SensorPointDto,
} from '../../shared/api-contract.js';
import type { DeviceSeries, SeriesPoint } from '../domain/sensor.js';

// サーバーの time とクライアントの横軸ラベルで同じ暦を見せるため JST 固定。
const JST_FORMAT: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Tokyo' };

function toPointDto(point: SeriesPoint): SensorPointDto {
  // キーの並び順は現行実装と一致させる（移行前後で JSON をバイト単位で
  // 突き合わせて検証するため）。battery が co2 より前に来るのも現行どおり。
  return {
    ts: point.ts,
    time: new Date(point.ts).toLocaleString('ja-JP', JST_FORMAT),
    temperature: point.temperature,
    humidity: point.humidity,
    ...(point.battery !== undefined ? { battery: point.battery } : {}),
    ...(point.co2 !== undefined ? { co2: point.co2 } : {}),
  };
}

export function toDeviceSeriesDto(series: DeviceSeries): DeviceSeriesDto {
  return {
    device_id: series.deviceId,
    name: series.name,
    type: series.type,
    placement: series.placement,
    total: series.total,
    downsampled: series.downsampled,
    data: series.points.map(toPointDto),
  };
}

export function toSensorDataResponse(series: readonly DeviceSeries[]): SensorDataResponse {
  return series.map(toDeviceSeriesDto);
}
