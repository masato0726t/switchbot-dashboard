// pino による構造化ログ。PM2 配下（pm_id がセットされる）では PM2 が
// タイムスタンプを付けるため、二重表示を避けて自前のものは省く。
// 本番以外は pino-pretty で人が読める形に整える。

import { pino, type Logger } from 'pino';

export type { Logger };

const UNDER_PM2 = process.env['pm_id'] !== undefined;

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    timestamp: UNDER_PM2 ? false : pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
      : {}),
  });
}
