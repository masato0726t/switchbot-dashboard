// Express アプリの組み立て。依存は引数で受け取り、この層は生成しない。

import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger as PinoLogger } from 'pino';
import type { makeGetSensorData } from '../application/get-sensor-data.js';
import type { makeSetDevicePlacement } from '../application/set-device-placement.js';
import { errorHandler } from './error-handler.js';
import { placementRouter } from './routes/placement.js';
import { sensorDataRouter } from './routes/sensor-data.js';

export interface AppDeps {
  readonly getSensorData: ReturnType<typeof makeGetSensorData>;
  readonly setDevicePlacement: ReturnType<typeof makeSetDevicePlacement>;
  // pino-http（HTTP アクセスログ用ミドルウェア）にそのまま渡すため、ここだけは
  // application/ports.ts の抽象な Logger ではなく pino の具体的な型を使う。
  // pino-http は 'pino' パッケージにしか依存しない（infrastructure 配下の
  // 自作モジュールには依存しない）ので、presentation → infrastructure という
  // 逆向きの import にはならない。errorHandler へはそのまま渡せる
  // （pino.Logger は application/ports.ts の Logger を構造的に満たす）。
  readonly logger: PinoLogger;
  /** 静的ファイルの配信元ディレクトリ */
  readonly staticDir: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(pinoHttp({ logger: deps.logger }));
  app.use(express.json());
  app.use(express.static(deps.staticDir));

  app.use('/api', sensorDataRouter(deps.getSensorData));
  app.use('/api', placementRouter(deps.setDevicePlacement));

  app.use(errorHandler(deps.logger));

  return app;
}
