import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    // MySQL コンテナの起動に時間がかかるため、既定の 5 秒では足りない。
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // 同一コンテナを使い回すのでファイル間の並行実行はしない。
    fileParallelism: false,
  },
});
