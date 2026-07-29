import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { pino } from 'pino';
import type { DeviceSeries } from '../domain/sensor.js';
import { createApp } from './create-app.js';

const SERIES: DeviceSeries[] = [{
  deviceId: 1, name: 'リビング', type: 'WoIOSensor', placement: 'outdoor',
  total: 12345, downsampled: false,
  points: [{ ts: Date.UTC(2026, 4, 31, 10, 0), temperature: 24.9, humidity: 55 }],
}];

const silentLogger = pino({ level: 'silent' });

function app(overrides: {
  getSensorData?: ReturnType<typeof vi.fn>;
  setDevicePlacement?: ReturnType<typeof vi.fn>;
} = {}) {
  const getSensorData = overrides.getSensorData ?? vi.fn().mockResolvedValue(SERIES);
  const setDevicePlacement = overrides.setDevicePlacement ?? vi.fn().mockResolvedValue(undefined);
  const instance = createApp({
    getSensorData, setDevicePlacement,
    logger: silentLogger,
    staticDir: fileURLToPath(new URL('.', import.meta.url)),
  });
  return { instance, getSensorData, setDevicePlacement };
}

describe('GET /api/sensor-data', () => {
  test('ユースケースの結果を API の JSON 形式で返す', async () => {
    const { instance } = app();
    const res = await request(instance).get('/api/sensor-data?range=24h&offset=0');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      device_id: 1, name: 'リビング', type: 'WoIOSensor', placement: 'outdoor',
      total: 12345, downsampled: false,
      data: [{
        ts: Date.UTC(2026, 4, 31, 10, 0),
        time: new Date(Date.UTC(2026, 4, 31, 10, 0)).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        temperature: 24.9, humidity: 55,
      }],
    }]);
  });

  test('range / offset をそのままユースケースへ渡す', async () => {
    const { instance, getSensorData } = app();
    await request(instance).get('/api/sensor-data?range=1w&offset=3');

    expect(getSensorData).toHaveBeenCalledWith({ range: '1w', offset: '3' });
  });

  test('クエリが無くても 200 を返す（丸め込みはユースケースの責務）', async () => {
    const { instance, getSensorData } = app();
    const res = await request(instance).get('/api/sensor-data');

    expect(res.status).toBe(200);
    expect(getSensorData).toHaveBeenCalledWith({ range: undefined, offset: undefined });
  });

  test('ユースケースが失敗したら 500 と error を返す', async () => {
    const { instance } = app({ getSensorData: vi.fn().mockRejectedValue(new Error('DB 落ちた')) });
    const res = await request(instance).get('/api/sensor-data');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'DB 落ちた' });
  });
});

describe('PUT /api/devices/:id/placement', () => {
  test('設置場所を保存して device_id と placement を返す', async () => {
    const { instance, setDevicePlacement } = app();
    const res = await request(instance).put('/api/devices/7/placement').send({ placement: 'outdoor' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ device_id: 7, placement: 'outdoor' });
    expect(setDevicePlacement).toHaveBeenCalledWith(7, 'outdoor');
  });

  test('placement が不正なら 400 を返し、保存しない', async () => {
    const { instance, setDevicePlacement } = app();
    for (const body of [{ placement: 'garden' }, {}, { placement: null }]) {
      const res = await request(instance).put('/api/devices/1/placement').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/indoor/);
    }
    expect(setDevicePlacement).not.toHaveBeenCalled();
  });

  test('id が整数でなければ 400 を返し、保存しない', async () => {
    const { instance, setDevicePlacement } = app();
    for (const id of ['abc', '1.5']) {
      const res = await request(instance).put(`/api/devices/${id}/placement`).send({ placement: 'indoor' });
      expect(res.status).toBe(400);
    }
    expect(setDevicePlacement).not.toHaveBeenCalled();
  });

  // '' は Number に丸めると 0 になり z.coerce.number().int() を通ってしまうが、
  // /api/devices//placement という URL 自体がこのルートにマッチしないため、
  // Express のルーティングで 404 になる（server.cjs も同じ Express 5 のため同挙動）。
  test('id が空文字なら経路自体がマッチせず 404 になる', async () => {
    const { instance, setDevicePlacement } = app();
    const res = await request(instance).put('/api/devices//placement').send({ placement: 'indoor' });

    expect(res.status).toBe(404);
    expect(setDevicePlacement).not.toHaveBeenCalled();
  });

  test('保存に失敗したら 500 を返す', async () => {
    const { instance } = app({ setDevicePlacement: vi.fn().mockRejectedValue(new Error('書けない')) });
    const res = await request(instance).put('/api/devices/1/placement').send({ placement: 'indoor' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: '書けない' });
  });
});
