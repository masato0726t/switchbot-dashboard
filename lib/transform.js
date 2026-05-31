'use strict';

const { lttb } = require('./downsample');

// 1デバイスあたりの最大データ点数。これを超えたら LTTB で間引く。
const MAX_POINTS = 800;

/**
 * DB から取得した生の行データを、API レスポンス用のデバイス別時系列に整形する。
 * 点数が maxPoints を超えるデバイスは温度を基準に LTTB で間引く。
 *
 * @param {Array<{id: number, device_name: string, device_type: string}>} devices
 * @param {Array<{device_id: number, status_data: object, recorded_at: (Date|string|number)}>} logs
 *        recorded_at の昇順に並んでいる前提（SQL 側で ORDER BY 済み）
 * @param {number} [maxPoints=MAX_POINTS]
 * @returns {Array<object>} device_id / name / type / downsampled / data を持つ配列
 */
function buildSensorData(devices, logs, maxPoints = MAX_POINTS) {
  const deviceMap = {};
  for (const d of devices) {
    deviceMap[d.id] = { name: d.device_name, type: d.device_type, data: [] };
  }

  for (const log of logs) {
    const dev = deviceMap[log.device_id];
    if (!dev) continue;
    const s = log.status_data;
    const entry = {
      _ts: new Date(log.recorded_at).getTime(),
      time: new Date(log.recorded_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      temperature: s.temperature ?? null,
      humidity:    s.humidity    ?? null,
    };
    if (s.CO2 !== undefined) entry.co2 = s.CO2;
    dev.data.push(entry);
  }

  return Object.entries(deviceMap)
    .filter(([, v]) => v.data.length > 0)
    .map(([id, v]) => ({
      device_id: Number(id),
      name: v.name,
      type: v.type,
      downsampled: v.data.length > maxPoints,
      // 温度を基準に実データ点を選ぶ。送信前に内部用の _ts を落とす。
      data: lttb(v.data, maxPoints, d => d._ts, d => d.temperature ?? 0)
        .map(({ _ts, ...rest }) => rest),
    }));
}

module.exports = { buildSensorData, MAX_POINTS };
