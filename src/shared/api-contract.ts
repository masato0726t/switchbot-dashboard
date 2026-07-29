// API の契約。サーバーは応答を組み立てたあとに、クライアントは受信時に
// 同じスキーマを使う。型は z.infer で導出するので二重定義にならない。

import { z } from 'zod';

export const PlacementSchema = z.enum(['indoor', 'outdoor']);

export const SensorPointSchema = z.object({
  /** 測定時刻（エポックミリ秒）。クライアントが横軸ラベルを整形するのに使う */
  ts: z.number(),
  /** JST の表示文字列。ツールチップのフル日時に使う */
  time: z.string(),
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  battery: z.number().optional(),
  co2: z.number().optional(),
});

export const DeviceSeriesSchema = z.object({
  device_id: z.number(),
  name: z.string().nullable(),
  type: z.string().nullable(),
  placement: PlacementSchema,
  /** 表示範囲に依存しない全期間の総件数 */
  total: z.number(),
  downsampled: z.boolean(),
  data: z.array(SensorPointSchema),
});

export const SensorDataResponseSchema = z.array(DeviceSeriesSchema);

export const PlacementUpdateRequestSchema = z.object({
  placement: PlacementSchema,
});

export const PlacementUpdateResponseSchema = z.object({
  device_id: z.number(),
  placement: PlacementSchema,
});

export type SensorPointDto = z.infer<typeof SensorPointSchema>;
export type DeviceSeriesDto = z.infer<typeof DeviceSeriesSchema>;
export type SensorDataResponse = z.infer<typeof SensorDataResponseSchema>;
export type PlacementUpdateRequest = z.infer<typeof PlacementUpdateRequestSchema>;
export type PlacementUpdateResponse = z.infer<typeof PlacementUpdateResponseSchema>;
