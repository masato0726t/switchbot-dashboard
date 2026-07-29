// 環境変数の読み取りと検証。process.env をここ以外では参照しない。
// 不足・不正があれば起動時点で落とす（実行中に undefined が紛れ込むより、
// 起動が失敗して原因が 1 行で分かる方が運用しやすい）。

import { z } from 'zod';

// LOG_LEVEL の許容値。配列を一度だけ書き、zod のスキーマにも AppConfig の型にも
// 同じものを使う（z.enum が証明した絞り込みを、AppConfig.logLevel: string として
// 手前で捨てないようにするため）。
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const EnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
  DB_POOL_LIMIT: z.coerce.number().int().positive().default(10),
  PORT: z.coerce.number().int().positive().default(3000),
  TOTALS_TTL_MS: z.coerce.number().int().positive().default(60_000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export interface AppConfig {
  readonly port: number;
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
    readonly poolLimit: number;
  };
  readonly totalsTtlMs: number;
  readonly logLevel: LogLevel;
  readonly nodeEnv: 'development' | 'production' | 'test';
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    // zod の既定メッセージは変数名を含まないので、変数名付きで組み立て直す。
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`環境変数の設定に問題があります:\n${details}`);
  }

  const e = result.data;
  return {
    port: e.PORT,
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      database: e.DB_NAME,
      poolLimit: e.DB_POOL_LIMIT,
    },
    totalsTtlMs: e.TOTALS_TTL_MS,
    logLevel: e.LOG_LEVEL,
    nodeEnv: e.NODE_ENV,
  };
}
