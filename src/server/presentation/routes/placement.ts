import { Router } from 'express';
import createHttpError from 'http-errors';
import { z } from 'zod';
import type { makeSetDevicePlacement } from '../../application/set-device-placement.js';
import { PlacementUpdateRequestSchema, type PlacementUpdateResponse } from '../../../shared/api-contract.js';

const ParamsSchema = z.object({ id: z.coerce.number().int() });

export function placementRouter(
  setDevicePlacement: ReturnType<typeof makeSetDevicePlacement>,
): Router {
  const router = Router();

  router.put('/devices/:id/placement', async (req, res) => {
    const params = ParamsSchema.safeParse(req.params);
    const body = PlacementUpdateRequestSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      throw createHttpError(400, 'placement は indoor / outdoor のいずれか、id は整数が必要です');
    }

    await setDevicePlacement(params.data.id, body.data.placement);
    // レスポンスの型を契約（PlacementUpdateResponseSchema から z.infer した型）に
    // つなぎ、このエンドポイントの応答が契約の形から外れたらコンパイル時に
    // 気付けるようにする。
    const response: PlacementUpdateResponse = { device_id: params.data.id, placement: body.data.placement };
    res.json(response);
  });

  return router;
}
