// エアコン制御ルールの一覧取得。表示に必要な導出値をここで付ける。

import type { AcRule } from '../domain/ac-rule.js';
import { isHumidityLow, isSnoozing } from '../domain/ac-rule.js';
import type { AcRuleRepository } from './ports.js';

/** ルールに、画面が使う導出フラグを添えたもの。 */
export interface AcRuleView {
  rule: AcRule;
  /** 現在湿度が下限を下回っているか（加湿は制御対象外なので表示専用） */
  humidityLowWarning: boolean;
  /** 現在時刻の時点で一時停止中か */
  snoozing: boolean;
}

export interface GetAcRulesDeps {
  readonly acRules: AcRuleRepository;
  /** 現在時刻の取得。テストで固定するために差し替えられるようにする */
  readonly now?: () => Date;
}

export function makeGetAcRules(deps: GetAcRulesDeps) {
  const now = deps.now ?? (() => new Date());

  return async function getAcRules(): Promise<AcRuleView[]> {
    const rules = await deps.acRules.listRules();
    const at = now();

    return rules.map((rule) => ({
      rule,
      humidityLowWarning: isHumidityLow(rule.reading, rule.defaultHumidityMin),
      snoozing: isSnoozing(rule.snoozeUntil, at),
    }));
  };
}
