// エアコン制御ルールの作成・更新・削除。
//
// 値の妥当性は presentation が shared/ac-contract.ts の zod スキーマで検査済みで、
// ここには AcRuleInput 型の値だけが渡ってくる。

import type { AcRuleInput } from '../../shared/ac-contract.js';
import type { AcRuleRepository } from './ports.js';

export interface AcRuleWriteDeps {
  readonly acRules: AcRuleRepository;
}

export function makeCreateAcRule(deps: AcRuleWriteDeps) {
  return async function createAcRule(input: AcRuleInput): Promise<number> {
    return deps.acRules.createRule(input);
  };
}

export function makeUpdateAcRule(deps: AcRuleWriteDeps) {
  /** 対象のルールが無ければ false を返す（呼び出し側が 404 にする）。 */
  return async function updateAcRule(id: number, input: AcRuleInput): Promise<boolean> {
    return deps.acRules.updateRule(id, input);
  };
}

export function makeDeleteAcRule(deps: AcRuleWriteDeps) {
  /** 時間帯と送信履歴は外部キーの ON DELETE CASCADE で一緒に消える。 */
  return async function deleteAcRule(id: number): Promise<boolean> {
    return deps.acRules.deleteRule(id);
  };
}
