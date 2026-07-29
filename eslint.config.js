// ESLint v9 フラット設定。
// 移行期のため、旧実装（CommonJS の server.cjs / lib、ブラウザ ESM の public/js）と
// 新しい TypeScript（src/）の設定が併存する。旧実装は Task 12 で削除される。
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', 'dist/**'] },

  js.configs.recommended,

  // 旧 backend：CommonJS・Node グローバル
  {
    files: ['server.cjs', 'lib/**/*.cjs', 'ecosystem.config.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // 旧 frontend：ESM・ブラウザグローバル（＋ CDN の UMD グローバル Chart）
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, Chart: 'readonly' },
    },
  },

  // 旧 test（CommonJS）
  {
    files: ['test/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // 旧 test（ESM。public/js の純粋ヘルパーを検証する）
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // 設定ファイル（ESM）
  {
    files: ['*.config.js', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // 新 backend / shared：TypeScript
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ['src/**/*.ts'],
  })),
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
];
