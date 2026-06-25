// 体感温度から服装を提案する純粋ロジック（DOM もネットワークも触らない）。
// 室内と屋外で効く要素が違うため、計算式と服装の対応表を分けている。
//   - 室内（在宅・安静時前提）: 無風なので不快指数 THI（気温＋湿度）で判定
//   - 屋外（外出時前提）: 暑い側は Heat Index（気温＋湿度）、寒い側は気温ベース
//     （屋外センサーは風速を返さないため Wind Chill は出せない）

// 不快指数 THI。気温(°C)・湿度(%) から算出する。
export function discomfortIndex(temp, humidity) {
  return 0.81 * temp + 0.01 * humidity * (0.99 * temp - 14.3) + 46.3;
}

// Heat Index（暑さ指数）。Rothfusz 回帰式は °F 前提なので °C で扱えるように包む。
// 概ね気温 27°C 以上で意味を持つため、屋外の暑い側でのみ使用する。
export function heatIndex(temp, humidity) {
  const t = temp * 9 / 5 + 32;            // °C -> °F
  const r = humidity;
  const hiF = -42.379 + 2.04901523 * t + 10.14333127 * r
    - 0.22475541 * t * r - 0.00683783 * t * t - 0.05481717 * r * r
    + 0.00122874 * t * t * r + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r;
  return (hiF - 32) * 5 / 9;              // °F -> °C
}

// 室内の服装対応表（不快指数のしきい値で区切る。安静時は寒さを感じやすいので暖かめ）。
const INDOOR_BANDS = [
  { max: 55,       feeling: '寒い',     advice: '厚手の部屋着＋防寒。暖房を入れましょう' },
  { max: 60,       feeling: '肌寒い',   advice: '長袖に羽織りを一枚' },
  { max: 70,       feeling: '快適',     advice: '長袖の普段着でOK' },
  { max: 75,       feeling: 'やや暑い', advice: '半袖が快適' },
  { max: Infinity, feeling: '暑い',     advice: '薄着で。冷房や除湿を' },
];

// 屋外の服装対応表（体感気温のしきい値で区切る＝外出時の上着の目安）。
const OUTDOOR_BANDS = [
  { min: 25,        feeling: '暑い',     advice: '半袖でOK' },
  { min: 20,        feeling: '暖かい',   advice: '長袖シャツ一枚' },
  { min: 15,        feeling: '快適',     advice: '薄手の羽織り・カーディガン' },
  { min: 10,        feeling: '肌寒い',   advice: 'ジャケットやトレンチ' },
  { min: 5,         feeling: '寒い',     advice: 'コート・厚手の上着' },
  { min: -Infinity, feeling: '厳寒',     advice: 'ダウンなど真冬の装備' },
];

// 室内向けの服装提案。kind:'thi' は表示側に「不快指数」であることを伝える。
export function indoorAdvice(temp, humidity) {
  const thi = discomfortIndex(temp, humidity);
  const band = INDOOR_BANDS.find(b => thi < b.max);
  return { kind: 'thi', value: Math.round(thi * 10) / 10, ...band };
}

// 屋外向けの服装提案。kind:'feels' は表示側に「体感気温(°C)」であることを伝える。
export function outdoorAdvice(temp, humidity) {
  const feels = temp >= 27 ? heatIndex(temp, humidity) : temp;
  const band = OUTDOOR_BANDS.find(b => feels >= b.min);
  return { kind: 'feels', value: Math.round(feels * 10) / 10, ...band };
}

// 設置場所に応じて室内 / 屋外の提案を振り分ける。
// 気温・湿度のどちらかが欠けていれば算出できないため null を返す。
export function clothingFor(placement, temp, humidity) {
  if (temp == null || humidity == null) return null;
  const advice = placement === 'outdoor'
    ? outdoorAdvice(temp, humidity)
    : indoorAdvice(temp, humidity);
  return { placement: placement === 'outdoor' ? 'outdoor' : 'indoor', ...advice };
}
