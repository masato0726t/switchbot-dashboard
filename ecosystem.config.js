// PM2 プロセス定義。`pm2 start ecosystem.config.js` で起動する。
// 環境変数は .env（dotenv）から読むため、ここでは PORT/NODE_ENV のみ最小限で指定する。
module.exports = {
  apps: [
    {
      name: 'switchbot-dashboard',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',

      // クラッシュ時の自動再起動と、暴走再起動の抑制。
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,

      // メモリリーク時の保険として一定サイズで再起動。
      max_memory_restart: '300M',

      // PM2 がログ各行にタイムスタンプを付与（logger 側は二重を避けて自前分を省く）。
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',

      // graceful shutdown 用。SIGINT を送り、listen 完了を待ってから ready 判定。
      kill_timeout: 10000,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
