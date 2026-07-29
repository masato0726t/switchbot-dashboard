import { describe, expect, test, vi } from 'vitest';
import type { DeviceRepository } from './ports.js';
import { makeSetDevicePlacement } from './set-device-placement.js';

describe('makeSetDevicePlacement', () => {
  test('repository に設置場所の保存を委譲する', async () => {
    const savePlacement = vi.fn().mockResolvedValue(undefined);
    const devices = { listSensorDevices: vi.fn(), savePlacement } as unknown as DeviceRepository;

    await makeSetDevicePlacement({ devices })(7, 'outdoor');

    expect(savePlacement).toHaveBeenCalledWith(7, 'outdoor');
  });
});
