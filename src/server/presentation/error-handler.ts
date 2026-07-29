// 例外を HTTP レスポンスへ写像する唯一の場所。Express 5 は Promise を返す
// ハンドラの reject をここへ自動で流すため、各ルートに try/catch を書かない。

import type { ErrorRequestHandler } from 'express';
import { isHttpError } from 'http-errors';
import type { Logger } from '../application/ports.js';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    // レスポンス送出済み（例: 静的ファイル配信中のストリームエラーなど）の場合、
    // ここで res.status().json() を呼ぶと "Cannot set headers after they are
    // sent" を投げて二重に失敗する。Express の既定エラーハンドラに委譲する。
    if (res.headersSent) { next(err); return; }

    const status = isHttpError(err) ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);

    // 4xx は呼び出し側の入力ミスなので warn、5xx は要調査なので error。
    const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log({ err, method: req.method, url: req.originalUrl, status }, 'リクエスト処理に失敗');

    res.status(status).json({ error: message });
  };
}
