import { Router } from 'express';
import type { makeGetSensorData } from '../../application/get-sensor-data.js';
import { toSensorDataResponse } from '../dto.js';

export function sensorDataRouter(getSensorData: ReturnType<typeof makeGetSensorData>): Router {
  const router = Router();

  // range / offset の不正値は 400 にせず既定へ丸める（URL 直打ちで画面が
  // 壊れないようにする現行仕様）。丸め込みはユースケース側の責務。
  router.get('/sensor-data', async (req, res) => {
    const series = await getSensorData({
      range: req.query['range'],
      offset: req.query['offset'],
    });
    res.json(toSensorDataResponse(series));
  });

  return router;
}
