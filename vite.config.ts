// エアコン設定画面のビルド設定。
//
// 既存のグラフ画面（public/js/*.js）は素の ESM のままバンドラを通さない。
// エアコン設定画面だけを Vue + Vite でビルドし、成果物を public/ac/ に出して
// 既存の express.static(public) でそのまま配信する（URL は /ac/）。
//
// src/shared/*.ts の import は TypeScript の NodeNext に合わせて拡張子が .js に
// なっているが、Vite は TS ファイルからの .js import を .ts へ解決するため
// そのまま使える。

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  base: '/ac/',
  build: {
    outDir: fileURLToPath(new URL('./public/ac', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // 開発時（vite dev）は API を既存のサーバーへ中継する。
    proxy: { '/api': `http://localhost:${process.env.PORT ?? 3000}` },
  },
});
