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

// エアコン制御の依存は既定でどれも成功する空実装にしておき、
// 個別のテストで必要なものだけ差し替える。
function acDeps(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    getAcRules: overrides.getAcRules ?? vi.fn().mockResolvedValue([]),
    createAcRule: overrides.createAcRule ?? vi.fn().mockResolvedValue(1),
    updateAcRule: overrides.updateAcRule ?? vi.fn().mockResolvedValue(true),
    deleteAcRule: overrides.deleteAcRule ?? vi.fn().mockResolvedValue(true),
    setAcRuleEnabled: overrides.setAcRuleEnabled ?? vi.fn().mockResolvedValue(true),
    snoozeAcRule: overrides.snoozeAcRule ?? vi.fn().mockResolvedValue({ found: true, snoozeUntil: null }),
    getAcCommandLogs: overrides.getAcCommandLogs ?? vi.fn().mockResolvedValue([]),
    listAcDevices: overrides.listAcDevices ?? vi.fn().mockResolvedValue({ airConditioners: [], sensors: [] }),
  };
}

function app(overrides: {
  getSensorData?: ReturnType<typeof vi.fn>;
  setDevicePlacement?: ReturnType<typeof vi.fn>;
  ac?: Partial<Record<string, ReturnType<typeof vi.fn>>>;
} = {}) {
  const getSensorData = overrides.getSensorData ?? vi.fn().mockResolvedValue(SERIES);
  const setDevicePlacement = overrides.setDevicePlacement ?? vi.fn().mockResolvedValue(undefined);
  const ac = acDeps(overrides.ac);
  const instance = createApp({
    getSensorData, setDevicePlacement,
    // vi.fn() のモックは application 層の関数型と一致しないため、ここだけ型を緩める。
    ac: ac as never,
    logger: silentLogger,
    staticDir: fileURLToPath(new URL('.', import.meta.url)),
  });
  return { instance, getSensorData, setDevicePlacement, ac };
}

// validRuleBody は POST / PUT が通る最小のルール本体を返す。
function validRuleBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'リビング',
    ac_device_id: 1,
    sensor_device_id: 2,
    default_target_temp: 25,
    default_humidity_max: 60,
    default_humidity_min: 40,
    temp_hysteresis: 1,
    humidity_hysteresis: 5,
    min_interval_min: 10,
    resend_interval_min: 60,
    sensor_max_age_min: 20,
    fan_speed: 1,
    base_humidity: 50,
    comfort_adjust_max: 1.5,
    setpoint_offset: 2,
    fan_boost_threshold: 2,
    allowed_modes: 7,
    schedules: [],
    ...overrides,
  };
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

describe('POST /api/ac/rules', () => {
  test('検証を通ればユースケースへ渡して 201 と id を返す', async () => {
    const { instance, ac } = app();
    const res = await request(instance).post('/api/ac/rules').send(validRuleBody());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1 });
    expect(ac.createAcRule).toHaveBeenCalledWith(expect.objectContaining({ name: 'リビング' }));
  });

  test('目標温度が範囲外なら 400 を返し、保存しない', async () => {
    const { instance, ac } = app();
    const res = await request(instance).post('/api/ac/rules').send(validRuleBody({ default_target_temp: 35 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/入力内容が不正です/);
    expect(ac.createAcRule).not.toHaveBeenCalled();
  });

  test('目標温度が小数なら 400 を返す', async () => {
    const { instance } = app();
    const res = await request(instance).post('/api/ac/rules').send(validRuleBody({ default_target_temp: 25.5 }));

    expect(res.status).toBe(400);
  });

  test('時間帯が重複していたら 400 を返し、保存しない', async () => {
    const { instance, ac } = app();
    const schedules = [
      { start_minute: 540, end_minute: 1080, target_temp: 26, humidity_max: null, humidity_min: null },
      { start_minute: 1020, end_minute: 1320, target_temp: 27, humidity_max: null, humidity_min: null },
    ];
    const res = await request(instance).post('/api/ac/rules').send(validRuleBody({ schedules }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/重複/);
    expect(ac.createAcRule).not.toHaveBeenCalled();
  });
});

describe('PUT /api/ac/rules/:id', () => {
  test('更新できれば id を返す', async () => {
    const { instance, ac } = app();
    const res = await request(instance).put('/api/ac/rules/3').send(validRuleBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 3 });
    expect(ac.updateAcRule).toHaveBeenCalledWith(3, expect.objectContaining({ name: 'リビング' }));
  });

  test('対象が無ければ 404 を返す', async () => {
    const { instance } = app({ ac: { updateAcRule: vi.fn().mockResolvedValue(false) } });
    const res = await request(instance).put('/api/ac/rules/99').send(validRuleBody());

    expect(res.status).toBe(404);
  });

  test('id が整数でなければ 400 を返し、更新しない', async () => {
    const { instance, ac } = app();
    const res = await request(instance).put('/api/ac/rules/abc').send(validRuleBody());

    expect(res.status).toBe(400);
    expect(ac.updateAcRule).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/ac/rules/:id', () => {
  test('削除できれば id を返す', async () => {
    const { instance, ac } = app();
    const res = await request(instance).delete('/api/ac/rules/5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5 });
    expect(ac.deleteAcRule).toHaveBeenCalledWith(5);
  });

  test('対象が無ければ 404 を返す', async () => {
    const { instance } = app({ ac: { deleteAcRule: vi.fn().mockResolvedValue(false) } });
    const res = await request(instance).delete('/api/ac/rules/99');

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ac/rules/:id/enabled', () => {
  test('真偽値を渡せば切り替える', async () => {
    const { instance, ac } = app();
    const res = await request(instance).put('/api/ac/rules/2/enabled').send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 2, enabled: false });
    expect(ac.setAcRuleEnabled).toHaveBeenCalledWith(2, false);
  });

  test('真偽値でなければ 400 を返す', async () => {
    const { instance, ac } = app();
    for (const body of [{ enabled: 'yes' }, {}, { enabled: null }]) {
      const res = await request(instance).put('/api/ac/rules/2/enabled').send(body);
      expect(res.status).toBe(400);
    }
    expect(ac.setAcRuleEnabled).not.toHaveBeenCalled();
  });
});

describe('PUT /api/ac/rules/:id/snooze', () => {
  test('時間を渡せば期限を返す', async () => {
    const until = new Date('2026-07-29T17:00:00.000Z');
    const { instance, ac } = app({
      ac: { snoozeAcRule: vi.fn().mockResolvedValue({ found: true, snoozeUntil: until }) },
    });
    const res = await request(instance).put('/api/ac/rules/2/snooze').send({ hours: 3 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 2, snooze_until: until.toISOString() });
    expect(ac.snoozeAcRule).toHaveBeenCalledWith(2, 3);
  });

  test('0 は解除として扱い snooze_until は null になる', async () => {
    const { instance } = app();
    const res = await request(instance).put('/api/ac/rules/2/snooze').send({ hours: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 2, snooze_until: null });
  });

  test('範囲外の時間は 400 を返し、変更しない', async () => {
    const { instance, ac } = app();
    for (const hours of [-1, 25]) {
      const res = await request(instance).put('/api/ac/rules/2/snooze').send({ hours });
      expect(res.status).toBe(400);
    }
    expect(ac.snoozeAcRule).not.toHaveBeenCalled();
  });
});

describe('GET /api/ac/rules/:id/logs', () => {
  test('limit を指定しなければ既定の 50 件で問い合わせる', async () => {
    const { instance, ac } = app();
    const res = await request(instance).get('/api/ac/rules/1/logs');

    expect(res.status).toBe(200);
    expect(ac.getAcCommandLogs).toHaveBeenCalledWith(1, 50);
  });

  test('範囲外の limit は既定値に丸める', async () => {
    const { instance, ac } = app();
    await request(instance).get('/api/ac/rules/1/logs?limit=9999');

    expect(ac.getAcCommandLogs).toHaveBeenCalledWith(1, 50);
  });

  test('正しい limit はそのまま渡す', async () => {
    const { instance, ac } = app();
    await request(instance).get('/api/ac/rules/1/logs?limit=10');

    expect(ac.getAcCommandLogs).toHaveBeenCalledWith(1, 10);
  });
});

describe('GET /api/ac/devices', () => {
  test('候補をスネークケースの契約の形で返す', async () => {
    const { instance } = app({
      ac: {
        listAcDevices: vi.fn().mockResolvedValue({
          airConditioners: [{ id: 9, deviceName: 'リビングのエアコン', deviceType: 'Air Conditioner' }],
          sensors: [{ id: 1, deviceName: 'リビング', deviceType: 'WoIOSensor' }],
        }),
      },
    });
    const res = await request(instance).get('/api/ac/devices');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      air_conditioners: [{ id: 9, device_name: 'リビングのエアコン', device_type: 'Air Conditioner' }],
      sensors: [{ id: 1, device_name: 'リビング', device_type: 'WoIOSensor' }],
    });
  });
});

describe('GET /api/ac/rules', () => {
  test('ユースケースが失敗したら 500 と error を返す', async () => {
    const { instance } = app({ ac: { getAcRules: vi.fn().mockRejectedValue(new Error('DB 落ちた')) } });
    const res = await request(instance).get('/api/ac/rules');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'DB 落ちた' });
  });
});
