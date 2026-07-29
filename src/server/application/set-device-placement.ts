// 設置場所更新のユースケース。値の妥当性は presentation が zod で検査済みで、
// ここには Placement 型の値だけが渡ってくる。

import type { Placement } from '../domain/placement.js';
import type { DeviceRepository } from './ports.js';

export interface SetDevicePlacementDeps {
  readonly devices: DeviceRepository;
}

export function makeSetDevicePlacement(deps: SetDevicePlacementDeps) {
  return async function setDevicePlacement(deviceId: number, placement: Placement): Promise<void> {
    await deps.devices.savePlacement(deviceId, placement);
  };
}
