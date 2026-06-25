'use strict';

// MySQL 接続まわりのインフラ。接続設定の一元管理と、接続の生成〜クローズを
// 必ず対で行うためのヘルパーを提供する。ルート層は SQL に専念できる。
const mysql = require('mysql2/promise');

const dbConfig = {
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 接続を1本張って fn に渡し、成否によらず最後に必ずクローズする。
// fn の戻り値をそのまま返し、例外は握りつぶさず呼び出し側へ伝える。
async function withConnection(fn) {
  const conn = await mysql.createConnection(dbConfig);
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

module.exports = { dbConfig, withConnection };
