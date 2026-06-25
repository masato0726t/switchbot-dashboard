'use strict';

const { lttb } = require('./downsample');
const { defaultPlacement } = require('./placement');

// 1デバイスあたりの最大データ点数。これを超えたら LTTB で間引く。
const MAX_POINTS = 800;

/**
 * DB から取得した生の行データを、API レスポンス用のデバイス別時系列に整形する。
 * 点数が maxPoints を超えるデバイスは温度を基準に LTTB で間引く。
 *
 * @param {Array<{id: number, device_name: string, device_type: string, placement?: string}>} devices
 *        placement（'indoor' | 'outdoor'）は省略・null 可。未設定なら device_type から推測する。
 * @param {Array<{device_id: number, status_data: object, recorded_at: (Date|string|number)}>} logs
 *        recorded_at の昇順に並んでいる前提（SQL 側で ORDER BY 済み）
 * @param {Object<string|number, number>} [totals={}]
 *        device_id → 全期間の総件数。指定が無いデバイスは表示範囲の生データ点数で代替する。
 * @param {number} [maxPoints=MAX_POINTS]
 * @returns {Array<object>} device_id / name / type / total / downsampled / data を持つ配列
 *          data の各点は ts(ミリ秒) / time(JST 表示文字列) / temperature / humidity / co2(任意)
 */
function buildSensorData(devices, logs, totals = {}, maxPoints = MAX_POINTS) {
  const deviceMap = {};
  for (const d of devices) {
    deviceMap[d.id] = {
      name: d.device_name,
      type: d.device_type,
      // 未設定（DB に設定行が無い）デバイスは device_type から初期推測する。
      placement: d.placement ?? defaultPlacement(d.device_type),
      data: [],
    };
  }

  for (const log of logs) {
    const dev = deviceMap[log.device_id];
    if (!dev) continue;
    const s = log.status_data;
    const recordedAt = new Date(log.recorded_at);
    const entry = {
      _ts: recordedAt.getTime(),
      time: recordedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      temperature: s.temperature ?? null,
      humidity:    s.humidity    ?? null,
    };
    if (s.battery !== undefined) entry.battery = s.battery;
    if (s.CO2 !== undefined) entry.co2 = s.CO2;
    dev.data.push(entry);
  }

  return Object.entries(deviceMap)
    .filter(([, v]) => v.data.length > 0)
    .map(([id, v]) => ({
      device_id: Number(id),
      name: v.name,
      type: v.type,
      placement: v.placement,
      // 全期間の総件数（DB 行数）。totals 未指定なら表示範囲の生データ点数で代替。
      total: totals[id] ?? v.data.length,
      downsampled: v.data.length > maxPoints,
      // 温度を基準に実データ点を選ぶ。内部用の _ts は数値 ts として公開する
      // （クライアントが表示範囲に応じて横軸ラベルを整形するのに使う）。
      data: lttb(v.data, maxPoints, d => d._ts, d => d.temperature ?? 0)
        .map(({ _ts, ...rest }) => ({ ts: _ts, ...rest })),
    }));
}

module.exports = { buildSensorData, MAX_POINTS };
