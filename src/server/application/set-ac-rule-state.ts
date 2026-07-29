// 自動制御の一時的な状態（有効／無効・一時停止）の切り替え。
//
// どちらも「今この部屋の自動制御を止めたい／再開したい」という同じ関心事の
// 操作なので 1 ファイルにまとめてある。ルールの設定値そのものは変えない。

import type { AcRuleRepository } from './ports.js';

export interface AcRuleStateDeps {
  readonly acRules: AcRuleRepository;
  /** 現在時刻の取得。テストで固定するために差し替えられるようにする */
  readonly now?: () => Date;
}

export function makeSetAcRuleEnabled(deps: AcRuleStateDeps) {
  /**
   * 無効にしてもエアコンは停止しない（制御ツールがコマンドを送らなくなるだけ）。
   * 「手動でリモコンを使いたいから無効にする」使い方を想定しているため。
   */
  return async function setAcRuleEnabled(id: number, enabled: boolean): Promise<boolean> {
    return deps.acRules.setEnabled(id, enabled);
  };
}

export interface SnoozeResult {
  found: boolean;
  /** 設定後の期限。解除した場合は null */
  snoozeUntil: Date | null;
}

export function makeSnoozeAcRule(deps: AcRuleStateDeps) {
  const now = deps.now ?? (() => new Date());

  /** hours が 0 なら解除する。 */
  return async function snoozeAcRule(id: number, hours: number): Promise<SnoozeResult> {
    const until = hours === 0 ? null : new Date(now().getTime() + hours * 60 * 60 * 1000);
    const found = await deps.acRules.setSnoozeUntil(id, until);
    return { found, snoozeUntil: found ? until : null };
  };
}
