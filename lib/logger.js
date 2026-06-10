'use strict';

// JST タイムスタンプ付きの簡易ロガー。レベルごとに console の対応メソッドへ出力する。
// 例: [2026-06-11 12:34:56] [INFO] メッセージ { key: 'value' }
//
// PM2 配下（pm_id がセットされる）では PM2 側の --time / time:true が
// タイムスタンプを付与するため、二重表示を避けて自前のものは省く。
const UNDER_PM2 = process.env.pm_id !== undefined;

function timestamp() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function write(level, method, msg, meta) {
  const prefix = UNDER_PM2 ? `[${level}]` : `[${timestamp()}] [${level}]`;
  const line = `${prefix} ${msg}`;
  if (meta !== undefined) method(line, meta);
  else method(line);
}

const logger = {
  info:  (msg, meta) => write('INFO',  console.log,   msg, meta),
  warn:  (msg, meta) => write('WARN',  console.warn,  msg, meta),
  error: (msg, meta) => write('ERROR', console.error, msg, meta),
  debug: (msg, meta) => write('DEBUG', console.debug, msg, meta),
};

module.exports = logger;
