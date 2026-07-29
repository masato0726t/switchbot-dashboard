import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 統合テスト（Testcontainers）は別設定で実行する。単体テストは常に高速に保つ。
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    environment: 'node',
  },
});
