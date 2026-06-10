// 表示用の純粋ヘルパー（DOM もネットワークも触らない）。

// デバイス種別からアイコン絵文字を選ぶ。
export function deviceIcon(type) {
  if (type.includes('CO2'))   return '🌡️';
  if (type.includes('Meter')) return '🌡️';
  if (type.includes('IO'))    return '🌿';
  if (type.includes('Hub'))   return '📡';
  return '📟';
}

// 配列を末尾からたどり、key が null/undefined でない最新の値を返す。
export function latest(arr, key) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i][key] != null) return arr[i][key];
  }
  return null;
}

// 横軸ラベルを表示範囲に応じて短く整形する（時刻のみ / 月日 / 年月）。
// タイムゾーンは JST 固定でサーバーの time 表示と揃える。
const SHORT_RANGES = ['1h', '6h', '12h', '24h'];
const DAY_RANGES   = ['1w', '1mo'];
export function formatTimeLabel(ts, range) {
  const d = new Date(ts);
  const tz = { timeZone: 'Asia/Tokyo' };
  if (SHORT_RANGES.includes(range))
    return d.toLocaleTimeString('ja-JP', { ...tz, hour: '2-digit', minute: '2-digit' });
  if (DAY_RANGES.includes(range))
    return d.toLocaleDateString('ja-JP', { ...tz, month: 'numeric', day: 'numeric' });
  return d.toLocaleDateString('ja-JP', { ...tz, year: 'numeric', month: 'numeric' }); // 1y/3y/all
}

// API の data 配列を、チャート描画に必要な系列へ一括変換する。
// labels は短縮ラベル、times はツールチップ用のフル日時。
// 温度・湿度が両方 0 のレコードはセンサー異常値とみなしグラフから除外する。
export function extractSeries(data, range) {
  const rows = data.filter(d => !(d.temperature === 0 && d.humidity === 0));
  const hasCO2 = rows.some(d => d.co2 != null);
  return {
    labels: rows.map(d => formatTimeLabel(d.ts, range)),
    times:  rows.map(d => d.time),
    temps:  rows.map(d => d.temperature),
    humids: rows.map(d => d.humidity),
    co2s:   hasCO2 ? rows.map(d => d.co2 ?? null) : [],
    hasCO2,
  };
}
