import type { DeviceRepository } from '../../application/ports.js';
import type { Placement } from '../../domain/placement.js';
import type { Db } from './create-db.js';

export function createDeviceRepository(db: Db): DeviceRepository {
  return {
    async listSensorDevices() {
      const rows = await db
        .selectFrom('devices as d')
        .leftJoin('device_settings as s', 's.device_id', 'd.id')
        .select(['d.id', 'd.device_name', 'd.device_type', 's.placement'])
        .where('d.is_virtual_infrared', '=', 0)
        .orderBy('d.id')
        .execute();

      return rows.map((row) => ({
        id: row.id,
        name: row.device_name,
        type: row.device_type,
        placement: row.placement ?? null,
      }));
    },

    async savePlacement(deviceId: number, placement: Placement) {
      await db
        .insertInto('device_settings')
        .values({ device_id: deviceId, placement })
        .onDuplicateKeyUpdate({ placement })
        .execute();
    },
  };
}
