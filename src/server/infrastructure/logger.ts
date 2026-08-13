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
    // --- ログ規約v1（2026-08-13）: 自作アプリ横断で level 表記を揃える ---
    // pino の既定は数値（30/40/50）。Go の slog / zap が出す "INFO"/"ERROR" に
    // 合わせないと、集約基盤で level 横断の絞り込みからこのアプリだけ漏れる。
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    // host / pid は journald が付けるのでアプリ側では出さない。
    base: { service: 'switchbot-dashboard' },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
      : {}),
  });
}
