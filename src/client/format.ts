// 画面の表示用ヘルパー。

import type { AcRuleDto } from '../shared/ac-contract.js';
import { fanSpeedLabel, modeLabel } from '../shared/air-conditioner.js';

/** ISO 文字列を JST の読みやすい形にする。 */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

/** 制御ツールが推定している現在の運転状態を 1 行で表す。 */
export function stateLabel(last: AcRuleDto['last_command']): string {
  if (last === null) return '不明（まだ操作していません）';
  if (last.power === 'off') return '停止中';
  return `${modeLabel(last.mode)} ${last.target_temp}℃ 風量${fanSpeedLabel(last.fan_speed)}`;
}

/** 送信履歴 1 件の「送った内容」を表す。 */
export function commandLabel(log: {
  power: 'on' | 'off';
  mode: number;
  target_temp: number;
  fan_speed: number;
}): string {
  if (log.power === 'off') return `停止（${modeLabel(log.mode)}）`;
  return `${modeLabel(log.mode)} ${log.target_temp}℃ 風量${fanSpeedLabel(log.fan_speed)}`;
}

/** 温度・湿度の対を表示用にする。 */
export function readingLabel(temperature: number | null, humidity: number | null): string {
  const temp = temperature === null ? '-' : `${temperature.toFixed(1)}℃`;
  const hum = humidity === null ? '-' : `${humidity.toFixed(0)}%`;
  return `${temp} / ${hum}`;
}
