// ドメインの時系列を API の JSON へ変換する。表示のための都合（JST の日時文字列、
// スネークケースのキー名、キーの並び順）はこの層だけが知る。

import type {
  DeviceSeriesDto, SensorDataResponse, SensorPointDto,
} from '../../shared/api-contract.js';
import type { DeviceSeries, SeriesPoint } from '../domain/sensor.js';

// サーバーの time とクライアントの横軸ラベルで同じ暦を見せるため JST 固定。
//
// Date.toLocaleString は呼ぶたびに内部で書式オブジェクトを組み立て直すため、点ごとに
// 呼ぶと重い（1,600 点で約 158ms かかっていた）。Intl.DateTimeFormat を 1 つ作って
// 使い回すと約 11.8ms になる（13 倍）。
//
// 明示している 6 つのコンポーネントは、引数なしの toLocaleString('ja-JP', { timeZone })
// が既定で選ぶものと同一の出力になるよう実測で確かめた組み合わせ。dateStyle/timeStyle:
// 'medium' や hour/minute/second を '2-digit' にすると 0 埋めの有無がずれて
// 「2026/07/29」「09:00:00」のようになり、レスポンスが変わってしまう。
const JST_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
});

function toPointDto(point: SeriesPoint): SensorPointDto {
  // キーの並び順は現行実装と一致させる（移行前後で JSON をバイト単位で
  // 突き合わせて検証するため）。battery が co2 より前に来るのも現行どおり。
  return {
    ts: point.ts,
    time: JST_FORMATTER.format(new Date(point.ts)),
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
