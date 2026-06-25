// ESLint v9 フラット設定。
// このプロジェクトは backend が CommonJS（Node）、frontend が ブラウザ ESM の混在なので、
// ファイル群ごとに sourceType とグローバルを切り替える。
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**'] },

  js.configs.recommended,

  // backend：CommonJS・Node グローバル（server.js / lib / test の .js / 設定ファイル）
  {
    files: ['**/*.js'],
    ignores: ['public/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // frontend：ESM・ブラウザグローバル（＋ CDN の UMD グローバル Chart）
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, Chart: 'readonly' },
    },
  },

  // test の ESM：ESM・Node グローバル（.mjs）
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
