import { describe, expect, test } from 'vitest';
import { loadConfig } from './config.js';

const REQUIRED = {
  DB_HOST: 'db.local',
  DB_USER: 'dash',
  DB_PASSWORD: 'secret',
  DB_NAME: 'switchbot_db',
};

describe('loadConfig', () => {
  test('必須の DB 接続情報を読み取る', () => {
    const config = loadConfig({ ...REQUIRED });
    expect(config.db).toMatchObject({
      host: 'db.local', user: 'dash', password: 'secret', database: 'switchbot_db',
    });
  });

  test('省略可能な値は既定値になる', () => {
    const config = loadConfig({ ...REQUIRED });
    expect(config.port).toBe(3000);
    expect(config.db.port).toBe(3306);
    expect(config.db.poolLimit).toBe(10);
    expect(config.totalsTtlMs).toBe(60_000);
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('development');
  });

  test('数値は文字列から変換する', () => {
    const config = loadConfig({ ...REQUIRED, PORT: '8080', DB_PORT: '3307', DB_POOL_LIMIT: '25', TOTALS_TTL_MS: '5000' });
    expect(config.port).toBe(8080);
    expect(config.db.port).toBe(3307);
    expect(config.db.poolLimit).toBe(25);
    expect(config.totalsTtlMs).toBe(5000);
  });

  test('DB_HOST が無ければ起動を止める', () => {
    expect(() => loadConfig({ DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' }))
      .toThrow(/DB_HOST/);
  });

  test('DB_PASSWORD は空文字を許容する（パスワード無しの MySQL 構成）', () => {
    expect(() => loadConfig({ ...REQUIRED, DB_PASSWORD: '' })).not.toThrow();
  });

  test('数値でない PORT はエラーメッセージに変数名を含める', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: 'abc' })).toThrow(/PORT/);
  });

  test('未知のログレベルは弾く', () => {
    expect(() => loadConfig({ ...REQUIRED, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
