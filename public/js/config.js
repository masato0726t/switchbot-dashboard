// 画面全体で共有する定数。値だけを持ち、副作用は持たない。

// 自動更新の間隔（秒）。ライブ表示（offset=0）のときだけ働く。
export const REFRESH_SEC = 30;

// SNS 共有のインスタンス初期候補。一度投稿すると使ったドメインが
// localStorage に保存され、以後はそちらが優先して表示される。
export const DEFAULT_INSTANCES = {
  mastodon: ['mstdn.jp'],
  misskey:  ['misskey.io'],
};

// 表示するメトリクスの定義。key は DOM id の接尾辞、field は API のフィールド名。
// デバイスにそのメトリクスの値がある場合だけ統計カードとグラフを表示する。
export const METRICS = [
  { key: 'temp', field: 'temperature', label: '温度', unit: '°C',  colorClass: 'temp-color', palette: { line: '#f97316', fill: 'rgba(249,115,22,0.12)' } },
  { key: 'humi', field: 'humidity',    label: '湿度', unit: '%',   colorClass: 'humi-color', palette: { line: '#38bdf8', fill: 'rgba(56,189,248,0.12)' } },
  { key: 'co2',  field: 'co2',         label: 'CO2',  unit: 'ppm', colorClass: 'co2-color',  palette: { line: '#a78bfa', fill: 'rgba(167,139,250,0.12)' } },
];

// 表示範囲の選択肢（key・count・unit は src/shared/ranges.ts の RANGES と対応）。
// count/unitJa はページング時の窓ラベル生成に使う。nav:false は遡れない（全期間）。
export const RANGES = [
  { key: '1h',  label: '1時間',  count: 1,  unitJa: '時間', nav: true },
  { key: '6h',  label: '6時間',  count: 6,  unitJa: '時間', nav: true },
  { key: '12h', label: '12時間', count: 12, unitJa: '時間', nav: true },
  { key: '24h', label: '24時間', count: 24, unitJa: '時間', nav: true },
  { key: '1w',  label: '1週間',  count: 7,  unitJa: '日',   nav: true },
  { key: '1mo', label: '1ヶ月',  count: 1,  unitJa: 'ヶ月', nav: true },
  { key: '1y',  label: '1年',    count: 1,  unitJa: '年',   nav: true },
  { key: '3y',  label: '3年',    count: 3,  unitJa: '年',   nav: true },
  { key: 'all', label: '全部',   count: 0,  unitJa: '',     nav: false },
];
