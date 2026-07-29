'use strict';

// MySQL 接続まわりのインフラ。接続設定の一元管理と、接続の取得〜解放を
// 必ず対で行うためのヘルパーを提供する。ルート層は SQL に専念できる。
const mysql = require('mysql2/promise');

const dbConfig = {
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// プールの上限接続数。.env の DB_POOL_LIMIT で上書き可（未指定なら 10）。
const POOL_LIMIT = Number(process.env.DB_POOL_LIMIT) || 10;

// 接続はリクエスト毎に張り直さずプールで使い回す。createConnection の
// TCP/認証ハンドシェイクを毎回払うのを避け、表示のレイテンシを下げる。
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: POOL_LIMIT,
  maxIdle: POOL_LIMIT,
});

// プールから接続を1本借りて fn に渡し、成否によらず最後に必ずプールへ返す
// （end ではなく release）。fn の戻り値をそのまま返し、例外は呼び出し側へ伝える。
async function withConnection(fn) {
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

// graceful shutdown でプール全体を閉じる。閉じ忘れるとプロセスが終了しない。
async function closePool() {
  await pool.end();
}

module.exports = { dbConfig, pool, withConnection, closePool };
