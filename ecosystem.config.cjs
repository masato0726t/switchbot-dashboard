// PM2 プロセス定義。`pm2 start ecosystem.config.cjs` で起動する。
// 環境変数は .env（dotenv）から読むため、ここでは PORT/NODE_ENV のみ最小限で指定する。
module.exports = {
  apps: [
    {
      name: 'switchbot-dashboard',
      script: 'dist/server/main.js',
      instances: 1,
      exec_mode: 'fork',

      // クラッシュ時の自動再起動と、暴走再起動の抑制。
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,

      // メモリリークの保険。「異常」を捕まえる値であって、通常動作の上限ではない。
      //
      // 本番（117,000 行・15GB RAM）での実測:
      //   平常時 194MB / range=all を 1 回で 227MB / 4 回で 301MB
      //
      // アプリは LTTB で間引く前に対象行をすべて JS オブジェクト化するため、
      // 長期範囲のリクエストごとに数十 MB を確保する。画面は 30 秒ごとに自動更新
      // するので、「全部」を開いたままのタブが 1 つあるだけで数分ごとに上限へ届く。
      // 以前この値は 300M だったが、それでは正常な利用で再起動が起きてしまう
      // （実測で確認）。マシンには 14GB 以上空きがあるため 1G まで引き上げる。
      //
      // なお根本原因は「間引く前に全行をメモリへ載せる」設計にある。長期範囲を
      // DB 側で集約すればこの確保自体が不要になる。docs/db-performance.md を参照。
      max_memory_restart: '1G',

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
