// 送信履歴の取得と、ルールで選べるデバイス候補の取得。
//
// どちらも「エアコン設定画面が表示のために読むだけ」の参照系なのでまとめてある。

import { AC_LIMITS } from '../../shared/air-conditioner.js';
import type { AcCommandLog, AcDeviceOption } from '../domain/ac-rule.js';
import type { AcRuleRepository } from './ports.js';

export interface AcReadDeps {
  readonly acRules: AcRuleRepository;
}

export function makeGetAcCommandLogs(deps: AcReadDeps) {
  /** limit は presentation 側で丸め済みだが、念のためここでも上限を効かせる。 */
  return async function getAcCommandLogs(id: number, limit: number): Promise<AcCommandLog[]> {
    const capped = Math.min(Math.max(limit, 1), AC_LIMITS.logLimitMax);
    return deps.acRules.listCommandLogs(id, capped);
  };
}

export interface AcDeviceOptions {
  airConditioners: AcDeviceOption[];
  sensors: AcDeviceOption[];
}

export function makeListAcDevices(deps: AcReadDeps) {
  return async function listAcDevices(): Promise<AcDeviceOptions> {
    return deps.acRules.listDeviceOptions();
  };
}
