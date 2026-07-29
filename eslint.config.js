// ESLint v9 フラット設定。
// TypeScript のバックエンドと、まだ素の ESM が残るフロントエンドが併存する。
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default [
  // public/ac/ は vite build の成果物なので対象外。
  { ignores: ['node_modules/**', 'dist/**', 'public/ac/**'] },

  js.configs.recommended,

  // frontend：ESM・ブラウザグローバル（＋ CDN の UMD グローバル Chart）
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, Chart: 'readonly' },
    },
  },

  // frontend のテスト：ESM・Node グローバル
  {
    files: ['test/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },

  // 設定ファイル
  {
    files: ['*.config.js', '*.config.ts', '*.config.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },

  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['src/**/*.ts'] })),
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    settings: {
      // NodeNext + 相対 import の `.js` 拡張子（実体は .ts）を解決するために
      // TypeScript 対応のリゾルバーを指定する。既定の eslint-import-resolver-node
      // は `.js` 指定から `.ts` ファイルを見つけられず、src/ 内の import が
      // すべて解決不能（＝unknown 扱い）になり、境界チェックが素通りしてしまう。
      'import/resolver': { typescript: {} },
      // mode: 'file' が必須。既定（'folder'）だと pattern の末尾にさらに
      // `/**/*` が暗黙で足され、末尾がワイルドカードの pattern（下記はすべて
      // そう）が二重になって一切マッチしなくなる（eslint-plugin-boundaries
      // 5.x の @boundaries/elements で実測して確認した挙動）。file モードなら
      // pattern をそのまま使って各ファイルパスに直接マッチする。
      'boundaries/elements': [
        { type: 'shared',         pattern: 'src/shared/*', mode: 'file' },
        { type: 'domain',         pattern: 'src/server/domain/*', mode: 'file' },
        { type: 'application',    pattern: 'src/server/application/*', mode: 'file' },
        { type: 'infrastructure', pattern: 'src/server/infrastructure/**/*', mode: 'file' },
        { type: 'presentation',   pattern: 'src/server/presentation/**/*', mode: 'file' },
        { type: 'config',         pattern: 'src/server/config.ts', mode: 'file' },
        { type: 'main',           pattern: 'src/server/main.ts', mode: 'file' },
        // エアコン設定画面（Vue）。API 契約を通してのみサーバーとつながる。
        { type: 'client',         pattern: 'src/client/**/*', mode: 'file' },
      ],
      'boundaries/include': ['src/**/*.ts'],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // 依存の向きを機械的に強制する。レビューで人間が見張らなくてよくする。
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'shared',         allow: ['shared'] },
          { from: 'domain',         allow: ['domain', 'shared'] },
          { from: 'application',    allow: ['application', 'domain', 'shared'] },
          { from: 'infrastructure', allow: ['infrastructure', 'application', 'domain', 'shared', 'config'] },
          { from: 'presentation',   allow: ['presentation', 'application', 'domain', 'shared'] },
          { from: 'config',         allow: ['config'] },
          // クライアントはサーバーの内部実装に触れず、共有の API 契約だけを見る。
          { from: 'client',         allow: ['client', 'shared'] },
          { from: 'main',           allow: ['main', 'presentation', 'application', 'infrastructure', 'domain', 'shared', 'config'] },
        ],
      }],
    },
  },
];
