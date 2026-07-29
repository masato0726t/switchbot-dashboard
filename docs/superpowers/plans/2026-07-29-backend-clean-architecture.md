# バックエンド クリーンアーキテクチャ移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `server.js` と `lib/` を TypeScript の domain / application / infrastructure / presentation の 4 層へ分離し、API レスポンスを 1 バイトも変えずにライブラリ（Kysely・zod・pino・lru-cache・close-with-grace・http-errors）へ定型処理を委譲する。

**Architecture:** 依存の向きは `presentation → application → domain ← infrastructure`。`application/ports.ts` のインターフェースを `infrastructure` が実装し、配線は `src/server/main.ts`（合成ルート）だけで行う。ESLint（eslint-plugin-boundaries）が層をまたぐ不正な import をエラーにする。

**Tech Stack:** TypeScript 5 / Express 5 / Kysely + mysql2 / zod / pino / lru-cache / close-with-grace / http-errors / Vitest / Testcontainers

対象 spec: `docs/superpowers/specs/2026-07-29-clean-architecture-refactor-design.md`

## Global Constraints

- Node.js `>=20`（`package.json` の `engines` を維持）。CI は Node 20.x / 22.x のマトリクス
- **package.json に `"type": "module"` を追加する。以降このリポジトリの `.js` / `.ts` はすべて ESM**
- **旧 CommonJS 実装（`server.js` / `lib/*.js` / `test/*.test.js`）は Task 1 で `.cjs` へリネームする。** Task 12 の「旧新のレスポンス突き合わせ」まで旧実装を起動可能に保つ必要があるため。これらは Task 12 で削除される
- **ESM + `moduleResolution: NodeNext` のため、TypeScript ソース内の相対 import には拡張子 `.js` を必ず付ける**（例: `import { lttb } from './downsample.js'`）。TS ファイルを指していても `.js` と書くのが NodeNext の規約
- TypeScript は `strict: true`。`any` の明示的な使用は禁止（`unknown` + 絞り込みを使う）
- **`GET /api/sensor-data` と `PUT /api/devices/:id/placement` のレスポンス JSON は現行と完全に同一**。キーの並び順まで維持する（旧新の突き合わせ検証を成立させるため）
- `range` / `offset` の不正値は 400 ではなく既定値（`24h` / `0`）へ丸める現行挙動を維持する
- `placement` の不正値は 400 を返す現行挙動を維持する
- `ddl/` の 3 ファイルは移動も改変もしない
- コメントは日本語。既存コードと同じく「なぜそうしたか」を書き、「何をしているか」の逐語訳は書かない
- 各タスクの最後に必ずコミットする。コミットメッセージは日本語

---

## File Structure

| パス | 責務 |
|---|---|
| `src/shared/ranges.ts` | 表示範囲の定義表（キー・数量・INTERVAL 単位・日本語ラベル・ページング可否）。FE/BE 共通 |
| `src/shared/api-contract.ts` | API レスポンスの zod スキーマと推論型。FE/BE 共通 |
| `src/server/domain/placement.ts` | 設置場所の型・既定推測・妥当性判定 |
| `src/server/domain/range.ts` | 範囲キーとオフセットの丸め込み |
| `src/server/domain/downsample.ts` | LTTB |
| `src/server/domain/sensor.ts` | `DeviceInfo` / `Reading` / `DeviceSeries` の型 |
| `src/server/domain/build-series.ts` | デバイス一覧 + 測定値 + 総件数 → デバイス別時系列 |
| `src/server/application/ports.ts` | `DeviceRepository` / `SensorLogRepository` / `TotalsCache` のインターフェース |
| `src/server/application/get-sensor-data.ts` | センサーデータ取得ユースケース |
| `src/server/application/set-device-placement.ts` | 設置場所更新ユースケース |
| `src/server/infrastructure/db/schema.ts` | Kysely の `Database` インターフェース |
| `src/server/infrastructure/db/create-db.ts` | mysql2 プール + Kysely インスタンス生成 |
| `src/server/infrastructure/db/window.ts` | 範囲 + オフセット → `recorded_at` の SQL 条件式 |
| `src/server/infrastructure/db/filters.ts` | センサー行フィルタの式（総件数と窓クエリで共有） |
| `src/server/infrastructure/db/device.repository.ts` | `DeviceRepository` の MySQL 実装 |
| `src/server/infrastructure/db/sensor-log.repository.ts` | `SensorLogRepository` の MySQL 実装 |
| `src/server/infrastructure/totals-cache.ts` | `TotalsCache` の lru-cache 実装 |
| `src/server/infrastructure/logger.ts` | pino ロガー |
| `src/server/infrastructure/ddl-runner.ts` | `ddl/device_settings.sql` の適用 |
| `src/server/presentation/dto.ts` | `DeviceSeries` → API JSON（JST 整形を含む） |
| `src/server/presentation/routes/sensor-data.ts` | `GET /api/sensor-data` |
| `src/server/presentation/routes/placement.ts` | `PUT /api/devices/:id/placement` |
| `src/server/presentation/error-handler.ts` | エラー → HTTP ステータスの写像 |
| `src/server/presentation/create-app.ts` | Express アプリの組み立て |
| `src/server/config.ts` | 環境変数の zod 検証 |
| `src/server/main.ts` | 合成ルート・起動・graceful shutdown |

**削除するファイル（Task 12）:** `server.cjs`, `lib/db.cjs`, `lib/downsample.cjs`, `lib/logger.cjs`, `lib/placement.cjs`, `lib/ranges.cjs`, `lib/transform.cjs`, `test/` 配下の 4 ファイル（`ranges.test.cjs` / `transform.test.cjs` / `placement.test.cjs` / `downsample.test.cjs`）。いずれも Task 1 で `.cjs` へリネーム済み

---

### Task 1: ツール基盤の整備と範囲定義の一本化

TypeScript・Vitest・ESLint(TS) を導入し、最初の TS モジュールとして `src/shared/ranges.ts` を作る。現在 `lib/ranges.js` の `RANGE_SPECS` と `public/js/config.js` の `RANGES` に二重定義されている範囲リストを 1 つに統合する（この時点では既存コードはまだ旧定義を使い続ける。Task 2 以降で置き換える）。

**Files:**
- Modify: `package.json`
- Modify: `eslint.config.js`（CommonJS → ESM へ変換）
- Rename: `ecosystem.config.js` → `ecosystem.config.cjs`
- Rename: `server.js` → `server.cjs`、`lib/*.js`（6 ファイル）→ `lib/*.cjs`、`test/{ranges,transform,placement,downsample}.test.js` → `*.test.cjs`
- Create: `tsconfig.json`, `tsconfig.server.json`, `vitest.config.ts`
- Create: `src/shared/ranges.ts`
- Test: `src/shared/ranges.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type RangeKey = '1h'|'6h'|'12h'|'24h'|'1w'|'1mo'|'1y'|'3y'|'all'`
  - `type IntervalUnit = 'HOUR'|'DAY'|'MONTH'|'YEAR'`
  - `interface RangeSpec { key: RangeKey; label: string; count: number; unit: IntervalUnit | null; unitJa: string; pageable: boolean }`
  - `const RANGES: readonly RangeSpec[]`
  - `const RANGE_BY_KEY: Readonly<Record<RangeKey, RangeSpec>>`
  - `const DEFAULT_RANGE: RangeKey`（値は `'24h'`）
  - `const RANGE_KEYS: readonly RangeKey[]`
  - `const INTERVAL_UNITS: ReadonlySet<string>`

- [ ] **Step 1: 依存パッケージを追加する**

```bash
npm install --save-dev typescript@^5 vitest@^3 @types/node@^22 typescript-eslint@^8 eslint-plugin-boundaries@^5
```

- [ ] **Step 2: 旧 CommonJS 実装を .cjs へリネームする**

`"type": "module"` を入れると Node は `.js` を ESM として扱う。旧実装は Task 12 の
「旧新のレスポンス突き合わせ」まで起動可能に保つ必要があるので、`.cjs` へ逃がす。
これらのファイルは Task 12 で削除されるため、この改名は一時的なもの。

```bash
git mv server.js server.cjs
for f in db downsample logger placement ranges transform; do git mv "lib/$f.js" "lib/$f.cjs"; done
for f in ranges transform placement downsample; do git mv "test/$f.test.js" "test/$f.test.cjs"; done
```

Node の CommonJS 解決は拡張子なしの `require` で `.cjs` を探さないため、
ローカル `require` に拡張子を明記する。書き換える箇所は次の 11 箇所だけ。

- `server.cjs`: `require('./lib/db')` → `require('./lib/db.cjs')`。同様に
  `./lib/ranges` / `./lib/transform` / `./lib/placement` / `./lib/logger` の 5 箇所
- `lib/transform.cjs`: `require('./downsample')` → `require('./downsample.cjs')`、
  `require('./placement')` → `require('./placement.cjs')` の 2 箇所
- `test/ranges.test.cjs`: `require('../lib/ranges')` → `require('../lib/ranges.cjs')`
- `test/transform.test.cjs`: `require('../lib/transform')` → `require('../lib/transform.cjs')`
- `test/placement.test.cjs`: `require('../lib/placement')` → `require('../lib/placement.cjs')`
- `test/downsample.test.cjs`: `require('../lib/downsample')` → `require('../lib/downsample.cjs')`

`test/*.mjs` と `public/js/*.js` は元から ESM なので変更しない。

この時点で旧実装が動くことを確認する。

Run: `node --test`
Expected: 55 ケース PASS（`.cjs` と `.mjs` の両方が実行される）

- [ ] **Step 3: package.json を ESM 化しスクリプトを整える**

`package.json` の `"description"` の直後に `"type": "module",` を追加し、`scripts` を次で置き換える。

```json
  "type": "module",
  "scripts": {
    "start": "node server.cjs",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.server.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "pm2:start": "pm2 start ecosystem.config.cjs",
    "pm2:reload": "pm2 reload ecosystem.config.cjs",
    "pm2:stop": "pm2 stop ecosystem.config.cjs",
    "pm2:logs": "pm2 logs switchbot-dashboard"
  },
```

`ecosystem.config.js` を `ecosystem.config.cjs` へリネームする（`"type": "module"` 下では `module.exports` が使えないため。PM2 は `.cjs` を読める）。

```bash
git mv ecosystem.config.js ecosystem.config.cjs
```

- [ ] **Step 4: tsconfig を作る**

`tsconfig.json`（共通の厳格設定。エディタが参照する）:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

`tsconfig.server.json`（ビルド用。クライアントは後続フェーズで別 tsconfig を持つ）:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/server",
    "rootDir": "src",
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/server", "src/shared"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 5: vitest.config.ts を作る**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 統合テスト（Testcontainers）は別設定で実行する。単体テストは常に高速に保つ。
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 6: eslint.config.js を ESM へ変換する**

`eslint.config.js` の全体を次で置き換える。この時点では既存 JS の設定を保ったまま、TypeScript 用のブロックを足す（層の境界チェックは Task 12 で有効化する）。

```js
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
```

- [ ] **Step 7: 失敗するテストを書く**

`src/shared/ranges.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  RANGES, RANGE_BY_KEY, RANGE_KEYS, DEFAULT_RANGE, INTERVAL_UNITS,
} from './ranges.js';

describe('RANGES', () => {
  test('9 種類の範囲を定義順に持つ', () => {
    expect(RANGE_KEYS).toEqual(['1h', '6h', '12h', '24h', '1w', '1mo', '1y', '3y', 'all']);
  });

  test('既定は 24h', () => {
    expect(DEFAULT_RANGE).toBe('24h');
  });

  test('キーで引ける索引が全範囲を網羅する', () => {
    for (const key of RANGE_KEYS) {
      expect(RANGE_BY_KEY[key].key).toBe(key);
    }
    expect(Object.keys(RANGE_BY_KEY)).toHaveLength(RANGES.length);
  });

  test('all だけが窓幅を持たず、ページング不可', () => {
    for (const spec of RANGES) {
      if (spec.key === 'all') {
        expect(spec.unit).toBeNull();
        expect(spec.pageable).toBe(false);
      } else {
        expect(spec.unit).not.toBeNull();
        expect(spec.pageable).toBe(true);
      }
    }
  });

  test('INTERVAL 単位はホワイトリストに含まれる値だけを使う', () => {
    for (const spec of RANGES) {
      if (spec.unit !== null) expect(INTERVAL_UNITS.has(spec.unit)).toBe(true);
    }
  });

  test('旧 lib/ranges.js の RANGE_SPECS と数量・単位が一致する', () => {
    const expected: Record<string, [number, string | null]> = {
      '1h': [1, 'HOUR'], '6h': [6, 'HOUR'], '12h': [12, 'HOUR'], '24h': [24, 'HOUR'],
      '1w': [7, 'DAY'], '1mo': [1, 'MONTH'], '1y': [1, 'YEAR'], '3y': [3, 'YEAR'],
      'all': [0, null],
    };
    for (const spec of RANGES) {
      expect([spec.count, spec.unit]).toEqual(expected[spec.key]);
    }
  });

  test('旧 public/js/config.js の RANGES と表示ラベル・日本語単位が一致する', () => {
    const expected: Record<string, [string, string]> = {
      '1h': ['1時間', '時間'], '6h': ['6時間', '時間'], '12h': ['12時間', '時間'],
      '24h': ['24時間', '時間'], '1w': ['1週間', '日'], '1mo': ['1ヶ月', 'ヶ月'],
      '1y': ['1年', '年'], '3y': ['3年', '年'], 'all': ['全部', ''],
    };
    for (const spec of RANGES) {
      expect([spec.label, spec.unitJa]).toEqual(expected[spec.key]);
    }
  });
});
```

- [ ] **Step 8: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./ranges.js"`

- [ ] **Step 9: 実装する**

`src/shared/ranges.ts`:

```ts
// 表示範囲の定義。サーバー（SQL の時間窓）とクライアント（範囲バー・窓ラベル）が
// 同じ表を見るため、範囲を増減するときに触る場所はこの 1 ファイルだけになる。

/** MySQL の INTERVAL 単位。SQL に文字列として埋めるため、値はここで閉じる。 */
export type IntervalUnit = 'HOUR' | 'DAY' | 'MONTH' | 'YEAR';

export const INTERVAL_UNITS: ReadonlySet<string> = new Set<IntervalUnit>([
  'HOUR', 'DAY', 'MONTH', 'YEAR',
]);

export interface RangeSpec {
  /** API のクエリ値・DOM の data 属性に使うキー */
  readonly key: RangeKey;
  /** 範囲バーのボタン表示 */
  readonly label: string;
  /** 窓の幅（unit 単位）。'all' は窓を持たないので 0 */
  readonly count: number;
  /** MySQL の INTERVAL 単位。'all' は窓を持たないので null */
  readonly unit: IntervalUnit | null;
  /** 窓ラベル（「48〜72時間前」）に使う日本語の単位 */
  readonly unitJa: string;
  /** 過去へページングできるか。'all' は窓幅を持たないため不可 */
  readonly pageable: boolean;
}

export const RANGES = [
  { key: '1h',  label: '1時間',  count: 1,  unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '6h',  label: '6時間',  count: 6,  unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '12h', label: '12時間', count: 12, unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '24h', label: '24時間', count: 24, unit: 'HOUR',  unitJa: '時間', pageable: true },
  { key: '1w',  label: '1週間',  count: 7,  unit: 'DAY',   unitJa: '日',   pageable: true },
  { key: '1mo', label: '1ヶ月',  count: 1,  unit: 'MONTH', unitJa: 'ヶ月', pageable: true },
  { key: '1y',  label: '1年',    count: 1,  unit: 'YEAR',  unitJa: '年',   pageable: true },
  { key: '3y',  label: '3年',    count: 3,  unit: 'YEAR',  unitJa: '年',   pageable: true },
  { key: 'all', label: '全部',   count: 0,  unit: null,    unitJa: '',     pageable: false },
] as const satisfies readonly RangeSpec[];

export type RangeKey =
  '1h' | '6h' | '12h' | '24h' | '1w' | '1mo' | '1y' | '3y' | 'all';

export const RANGE_KEYS: readonly RangeKey[] = RANGES.map((r) => r.key);

export const RANGE_BY_KEY: Readonly<Record<RangeKey, RangeSpec>> =
  Object.fromEntries(RANGES.map((r) => [r.key, r])) as Record<RangeKey, RangeSpec>;

export const DEFAULT_RANGE: RangeKey = '24h';
```

- [ ] **Step 10: テストと lint と typecheck を通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS（旧テストはまだ `test/` にあり Vitest の対象外。Task 2 以降で順次移植する）

旧実装と旧テストがまだ動くことも確認する。
Run: `node --test`
Expected: 55 ケース PASS

- [ ] **Step 11: コミット**

```bash
git add -A
git commit -m "TypeScript・Vitest・ESLint(TS) の基盤を整備し表示範囲の定義を一本化

package.json を ESM 化し、tsconfig・vitest 設定・TS 用 lint 設定を追加する。
旧 CommonJS 実装は Task 12 の突き合わせ検証まで起動可能に保つため .cjs へ逃がす。
最初の TS モジュールとして src/shared/ranges.ts を置き、lib/ranges.cjs と
public/js/config.js に二重定義されていた範囲リストを 1 箇所に統合する。"
```

---

### Task 2: domain 層の純粋モジュール（placement / range / downsample）

依存を持たない葉のモジュールから TS へ移す。既存テストのケースは 1 件も落とさない。

**Files:**
- Create: `src/server/domain/placement.ts`, `src/server/domain/range.ts`, `src/server/domain/downsample.ts`
- Test: `src/server/domain/placement.test.ts`, `src/server/domain/range.test.ts`, `src/server/domain/downsample.test.ts`

**Interfaces:**
- Consumes: `RangeKey` / `RANGE_BY_KEY` / `DEFAULT_RANGE` from `src/shared/ranges.ts`
- Produces:
  - `type Placement = 'indoor' | 'outdoor'`
  - `const PLACEMENTS: readonly Placement[]`
  - `function defaultPlacement(type: string | null | undefined): Placement`
  - `function isValidPlacement(value: unknown): value is Placement`
  - `function resolveRange(range: unknown): RangeKey`
  - `function resolveOffset(offset: unknown): number`
  - `function lttb<T>(data: readonly T[], threshold: number, getX: (d: T) => number, getY: (d: T) => number): readonly T[]`

- [ ] **Step 1: 失敗するテストを書く（placement）**

`src/server/domain/placement.test.ts` — `test/placement.test.js` の 5 ケースを全移植する。

```ts
import { describe, expect, test } from 'vitest';
import { PLACEMENTS, defaultPlacement, isValidPlacement } from './placement.js';

describe('defaultPlacement', () => {
  test('IO を含む種別を屋外と推測する', () => {
    expect(defaultPlacement('WoIOSensor')).toBe('outdoor');
  });

  test('IO を含まない種別を室内と推測する', () => {
    expect(defaultPlacement('Meter')).toBe('indoor');
    expect(defaultPlacement('MeterPro(CO2)')).toBe('indoor');
  });

  test('未定義・null でも室内にフォールバックする', () => {
    expect(defaultPlacement(undefined)).toBe('indoor');
    expect(defaultPlacement(null)).toBe('indoor');
  });
});

describe('isValidPlacement', () => {
  test('indoor / outdoor のみ受け付ける', () => {
    expect(isValidPlacement('indoor')).toBe(true);
    expect(isValidPlacement('outdoor')).toBe(true);
    expect(isValidPlacement('garden')).toBe(false);
    expect(isValidPlacement('')).toBe(false);
    expect(isValidPlacement(undefined)).toBe(false);
  });
});

test('PLACEMENTS は indoor / outdoor を列挙する', () => {
  expect([...PLACEMENTS].sort()).toEqual(['indoor', 'outdoor']);
});
```

- [ ] **Step 2: 失敗するテストを書く（range）**

`src/server/domain/range.test.ts` — `test/ranges.test.js` のうち丸め込みに関する 3 ケースを移植する（SQL 生成の 6 ケースは Task 6 の `window.test.ts` へ移す）。

```ts
import { describe, expect, test } from 'vitest';
import { DEFAULT_RANGE, RANGE_KEYS } from '../../shared/ranges.js';
import { resolveOffset, resolveRange } from './range.js';

describe('resolveRange', () => {
  test('有効なキーはそのまま返す', () => {
    for (const key of RANGE_KEYS) expect(resolveRange(key)).toBe(key);
  });

  test('未知・未指定のキーは既定に丸める', () => {
    expect(resolveRange('bogus')).toBe(DEFAULT_RANGE);
    expect(resolveRange(undefined)).toBe(DEFAULT_RANGE);
    expect(resolveRange('')).toBe(DEFAULT_RANGE);
  });

  test('プロトタイプ由来のキーを誤って受け付けない', () => {
    expect(resolveRange('toString')).toBe(DEFAULT_RANGE);
    expect(resolveRange('constructor')).toBe(DEFAULT_RANGE);
    expect(resolveRange('__proto__')).toBe(DEFAULT_RANGE);
  });

  test('SQL 断片を渡されても既定に丸める', () => {
    expect(resolveRange('; DROP TABLE devices;--')).toBe(DEFAULT_RANGE);
  });
});

describe('resolveOffset', () => {
  test('0 以上の整数だけ通す', () => {
    expect(resolveOffset(0)).toBe(0);
    expect(resolveOffset(3)).toBe(3);
    expect(resolveOffset('5')).toBe(5);
  });

  test('負数・非整数・数値化できない値は 0 に丸める', () => {
    expect(resolveOffset(-1)).toBe(0);
    expect(resolveOffset(1.5)).toBe(0);
    expect(resolveOffset('abc')).toBe(0);
    expect(resolveOffset(undefined)).toBe(0);
  });
});
```

- [ ] **Step 3: 失敗するテストを書く（downsample）**

`src/server/domain/downsample.test.ts` — `test/downsample.test.js` の 7 ケースを全移植する。

```ts
import { describe, expect, test } from 'vitest';
import { lttb } from './downsample.js';

interface Point { x: number; y: number }

const getX = (d: Point) => d.x;
const getY = (d: Point) => d.y;

function series(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 10 + 20 }));
}

describe('lttb', () => {
  test('点数が threshold 以下なら何も間引かない', () => {
    const data = series(100);
    expect(lttb(data, 800, getX, getY)).toHaveLength(100);
    expect(lttb(data, 100, getX, getY)).toHaveLength(100);
  });

  test('threshold が 3 未満なら元データをそのまま返す', () => {
    const data = series(50);
    expect(lttb(data, 2, getX, getY)).toBe(data);
    expect(lttb(data, 0, getX, getY)).toBe(data);
  });

  test('threshold ちょうどまで間引かれる', () => {
    expect(lttb(series(5000), 800, getX, getY)).toHaveLength(800);
  });

  test('最初と最後の点は必ず保持される', () => {
    const data = series(5000);
    const out = lttb(data, 800, getX, getY);
    expect(out[0]).toBe(data[0]);
    expect(out[out.length - 1]).toBe(data[data.length - 1]);
  });

  test('出力はすべて元データの実点（合成値ではない）', () => {
    const data = series(5000);
    const set = new Set(data);
    expect(lttb(data, 800, getX, getY).every((p) => set.has(p))).toBe(true);
  });

  test('出力は時系列順を保つ', () => {
    const out = lttb(series(5000), 500, getX, getY);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.x).toBeGreaterThan(out[i - 1]!.x);
    }
  });

  test('鋭いピークは間引いても残りやすい', () => {
    const data = series(2000);
    data[1234]!.y = 9999;
    expect(lttb(data, 200, getX, getY).some((p) => p.y === 9999)).toBe(true);
  });
});
```

- [ ] **Step 4: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./placement.js"` ほか 3 件

- [ ] **Step 5: placement.ts を実装する**

```ts
// デバイスの設置場所（室内 / 屋外）に関する規則。DB にも HTTP にも依存しない。

export type Placement = 'indoor' | 'outdoor';

export const PLACEMENTS: readonly Placement[] = ['indoor', 'outdoor'];

// 設置場所が未設定のときの初期推測。SwitchBot の防水温湿度計（device_type に
// "IO" を含む WoIOSensor 系）は屋外設置の可能性が高いので outdoor、それ以外は
// indoor を初期値にする。あくまで推測で、最終的にはユーザーが画面から上書きする。
export function defaultPlacement(type: string | null | undefined): Placement {
  return typeof type === 'string' && type.includes('IO') ? 'outdoor' : 'indoor';
}

export function isValidPlacement(value: unknown): value is Placement {
  return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value);
}
```

- [ ] **Step 6: range.ts を実装する**

```ts
// クエリ文字列として渡ってくる範囲・オフセットを、扱える値へ丸める。
// 不正値はエラーにせず既定へ倒す（画面の URL 直打ちで 400 にしない現行仕様）。

import { DEFAULT_RANGE, RANGE_BY_KEY, type RangeKey } from '../../shared/ranges.js';

export function resolveRange(range: unknown): RangeKey {
  // Object.hasOwn で自前のキーだけを見る。'toString' や '__proto__' を
  // 有効なキーと誤認しないため、in 演算子は使わない。
  return typeof range === 'string' && Object.hasOwn(RANGE_BY_KEY, range)
    ? (range as RangeKey)
    : DEFAULT_RANGE;
}

export function resolveOffset(offset: unknown): number {
  const n = Number(offset);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
```

- [ ] **Step 7: downsample.ts を実装する**

`lib/downsample.js` のアルゴリズムをそのまま移植し、型注釈だけを付ける。挙動は変えない。

```ts
/**
 * Largest Triangle Three Buckets (LTTB) ダウンサンプリング。
 * 折れ線の見た目を保ったままデータ点数を threshold まで減らす。
 * 平均化せず実データ点を選ぶため、値が偽物にならず最初と最後の点も必ず残る。
 */
export function lttb<T>(
  data: readonly T[],
  threshold: number,
  getX: (d: T) => number,
  getY: (d: T) => number,
): readonly T[] {
  const n = data.length;
  if (threshold >= n || threshold < 3) return data;

  const sampled: T[] = [data[0]!];    // 最初の点は必ず残す
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;                          // 直前に選んだ点のインデックス

  for (let i = 0; i < threshold - 2; i++) {
    // 次バケットの平均座標
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    const rangeLen = rangeEnd - rangeStart || 1;
    let avgX = 0, avgY = 0;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += getX(data[j]!);
      avgY += getY(data[j]!);
    }
    avgX /= rangeLen;
    avgY /= rangeLen;

    // 現バケット内で「直前の点・次バケット平均」と作る三角形の面積が最大の点を選ぶ
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.floor((i + 1) * bucketSize) + 1;
    const ax = getX(data[a]!), ay = getY(data[a]!);
    let maxArea = -1, chosen = bucketStart;
    for (let j = bucketStart; j < bucketEnd && j < n; j++) {
      const area = Math.abs(
        (ax - avgX) * (getY(data[j]!) - ay) - (ax - getX(data[j]!)) * (avgY - ay),
      );
      if (area > maxArea) { maxArea = area; chosen = j; }
    }
    sampled.push(data[chosen]!);
    a = chosen;
  }

  sampled.push(data[n - 1]!);         // 最後の点も必ず残す
  return sampled;
}
```

- [ ] **Step 8: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS（Vitest 側で 18 ケース増）

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "domain 層の純粋モジュール（placement / range / downsample）を TypeScript 化

既存テストのケースはすべて移植し、挙動は変えない。resolveRange は
Object.hasOwn でプロトタイプ由来のキーを弾く点も含めて現行と同じ。"
```

---

### Task 3: domain 層の時系列組み立て（sensor / build-series）

`lib/transform.js` のうち**業務規則の部分**（デバイス別にまとめる・LTTB で間引く・総件数を決める）を domain へ移す。JST 文字列の整形は表示の都合なので含めない（Task 4 の `dto.ts` が担当する）。

**Files:**
- Create: `src/server/domain/sensor.ts`, `src/server/domain/build-series.ts`
- Test: `src/server/domain/build-series.test.ts`

**Interfaces:**
- Consumes: `lttb` from `./downsample.js`, `defaultPlacement` / `Placement` from `./placement.js`
- Produces:
  - `interface DeviceInfo { id: number; name: string | null; type: string | null; placement: Placement | null }`
  - `interface Reading { deviceId: number; ts: number; temperature: number | null; humidity: number | null; co2?: number; battery?: number }`
  - `interface SeriesPoint { ts: number; temperature: number | null; humidity: number | null; co2?: number; battery?: number }`
  - `interface DeviceSeries { deviceId: number; name: string | null; type: string | null; placement: Placement; total: number; downsampled: boolean; points: readonly SeriesPoint[] }`
  - `const MAX_POINTS: 800`
  - `function buildSeries(devices: readonly DeviceInfo[], readings: readonly Reading[], totals?: ReadonlyMap<number, number>, maxPoints?: number): DeviceSeries[]`

- [ ] **Step 1: 失敗するテストを書く**

`src/server/domain/build-series.test.ts` — `test/transform.test.js` の 12 ケースのうち、時系列組み立てに関する 11 ケースを移植する（`time` 文字列に関する検証は Task 4 へ移す）。

```ts
import { describe, expect, test } from 'vitest';
import { MAX_POINTS, buildSeries, type DeviceInfo, type Reading } from './build-series.js';

const DEVICES: DeviceInfo[] = [
  { id: 1, name: 'リビング', type: 'WoIOSensor',   placement: null },
  { id: 2, name: '書斎',     type: 'MeterPro(CO2)', placement: null },
  { id: 3, name: '物置',     type: 'Meter',         placement: null },  // ログなし
];

function reading(deviceId: number, iso: string, extra: Partial<Reading> = {}): Reading {
  return {
    deviceId,
    ts: Date.parse(iso),
    temperature: extra.temperature ?? null,
    humidity: extra.humidity ?? null,
    ...(extra.co2 !== undefined ? { co2: extra.co2 } : {}),
    ...(extra.battery !== undefined ? { battery: extra.battery } : {}),
  };
}

describe('buildSeries', () => {
  test('デバイスごとに時系列をまとめ、ログの無いデバイスは除外する', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24.9, humidity: 55 }),
      reading(1, '2026-05-31T10:05:00Z', { temperature: 25.1, humidity: 54 }),
      reading(2, '2026-05-31T10:00:00Z', { temperature: 22.0, humidity: 60, co2: 718 }),
    ]);

    expect(out).toHaveLength(2);
    const living = out.find((d) => d.deviceId === 1)!;
    expect(living.name).toBe('リビング');
    expect(living.points).toHaveLength(2);
    expect(living.points[0]!.temperature).toBe(24.9);
    expect(living.points[0]!.humidity).toBe(55);
    expect(living.points[0]!.co2).toBeUndefined();
  });

  test('CO2 がある点だけ co2 を持つ', () => {
    const out = buildSeries(DEVICES, [
      reading(2, '2026-05-31T10:00:00Z', { temperature: 22, humidity: 60, co2: 718 }),
    ]);
    expect(out[0]!.points[0]!.co2).toBe(718);
  });

  test('ts はエポックミリ秒をそのまま持つ', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 }),
    ]);
    expect(out[0]!.points[0]!.ts).toBe(Date.parse('2026-05-31T10:00:00Z'));
  });

  test('欠損値は null になる', () => {
    const out = buildSeries(DEVICES, [reading(1, '2026-05-31T10:00:00Z', { temperature: 24 })]);
    expect(out[0]!.points[0]!.humidity).toBeNull();
  });

  test('未知の device_id の測定値は無視する', () => {
    const out = buildSeries(DEVICES, [
      reading(999, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 }),
    ]);
    expect(out).toHaveLength(0);
  });

  test('点数が maxPoints 以下なら downsampled=false で全件返す', () => {
    const readings = Array.from({ length: 10 }, (_, i) =>
      reading(1, new Date(Date.UTC(2026, 4, 31, 10, i)).toISOString(), { temperature: 20 + i, humidity: 50 }));
    const out = buildSeries(DEVICES, readings, undefined, 800);
    expect(out[0]!.downsampled).toBe(false);
    expect(out[0]!.points).toHaveLength(10);
  });

  test('点数が maxPoints を超えると downsampled=true で間引かれる', () => {
    const readings = Array.from({ length: 2000 }, (_, i) =>
      reading(1, new Date(Date.UTC(2026, 4, 31, 0, 0, i)).toISOString(), { temperature: 20 + (i % 5), humidity: 50 }));
    const out = buildSeries(DEVICES, readings, undefined, 800);
    expect(out[0]!.downsampled).toBe(true);
    expect(out[0]!.points).toHaveLength(800);
  });

  test('total は渡された全期間の総件数を使う', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24.9, humidity: 55 }),
      reading(1, '2026-05-31T10:05:00Z', { temperature: 25.1, humidity: 54 }),
    ], new Map([[1, 12345]]));
    expect(out[0]!.total).toBe(12345);
    expect(out[0]!.points).toHaveLength(2);
  });

  test('総件数が渡されなければ表示範囲の生の点数で代替する', () => {
    const out = buildSeries(DEVICES, [reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })]);
    expect(out[0]!.total).toBe(1);
  });

  test('placement 未設定なら type から推測する', () => {
    const out = buildSeries(DEVICES, [
      reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 }),
      reading(2, '2026-05-31T10:00:00Z', { temperature: 22, humidity: 60 }),
    ]);
    expect(out.find((d) => d.deviceId === 1)!.placement).toBe('outdoor');
    expect(out.find((d) => d.deviceId === 2)!.placement).toBe('indoor');
  });

  test('placement が設定されていれば推測より優先する', () => {
    const devices: DeviceInfo[] = [{ id: 1, name: 'リビング', type: 'WoIOSensor', placement: 'indoor' }];
    const out = buildSeries(devices, [reading(1, '2026-05-31T10:00:00Z', { temperature: 24, humidity: 55 })]);
    expect(out[0]!.placement).toBe('indoor');
  });

  test('MAX_POINTS は正の数', () => {
    expect(MAX_POINTS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./build-series.js"`

- [ ] **Step 3: sensor.ts を実装する**

```ts
// センサーデータの語彙。DB の列名でも API のフィールド名でもなく、
// ダッシュボードが扱う概念としての型をここで定義する。

import type { Placement } from './placement.js';

/** デバイス 1 台の属性。placement は未設定なら null（type から推測する）。 */
export interface DeviceInfo {
  readonly id: number;
  readonly name: string | null;
  readonly type: string | null;
  readonly placement: Placement | null;
}

/** 1 回の測定。co2 / battery はそのデバイスが持つときだけ現れる。 */
export interface Reading {
  readonly deviceId: number;
  /** 測定時刻（エポックミリ秒） */
  readonly ts: number;
  readonly temperature: number | null;
  readonly humidity: number | null;
  readonly co2?: number;
  readonly battery?: number;
}

/** 時系列の 1 点。Reading から deviceId を除いたもの。 */
export type SeriesPoint = Omit<Reading, 'deviceId'>;

/** デバイス 1 台ぶんの時系列。 */
export interface DeviceSeries {
  readonly deviceId: number;
  readonly name: string | null;
  readonly type: string | null;
  readonly placement: Placement;
  /** 表示範囲に依存しない全期間の総件数 */
  readonly total: number;
  /** LTTB で間引いたか */
  readonly downsampled: boolean;
  readonly points: readonly SeriesPoint[];
}
```

- [ ] **Step 4: build-series.ts を実装する**

```ts
// 測定値の集合を、デバイス別の時系列へ組み立てる規則。
// DB も HTTP も知らない。表示用の日時文字列も作らない（presentation の担当）。

import { lttb } from './downsample.js';
import { defaultPlacement } from './placement.js';
import type { DeviceInfo, DeviceSeries, Reading, SeriesPoint } from './sensor.js';

export type { DeviceInfo, DeviceSeries, Reading, SeriesPoint };

/** 1 デバイスあたりの最大点数。これを超えたら LTTB で間引く。 */
export const MAX_POINTS = 800;

/**
 * デバイス一覧と測定値から、デバイス別の時系列を組み立てる。
 * 測定値は recorded_at の昇順に並んでいる前提（SQL 側で並べ替え済み）。
 * totals が無いデバイスは、表示範囲の生の点数で total を代替する。
 */
export function buildSeries(
  devices: readonly DeviceInfo[],
  readings: readonly Reading[],
  totals: ReadonlyMap<number, number> = new Map(),
  maxPoints: number = MAX_POINTS,
): DeviceSeries[] {
  const byDevice = new Map<number, SeriesPoint[]>();
  for (const device of devices) byDevice.set(device.id, []);

  for (const { deviceId, ...point } of readings) {
    byDevice.get(deviceId)?.push(point);
  }

  return devices.flatMap((device) => {
    const points = byDevice.get(device.id) ?? [];
    if (points.length === 0) return [];
    return [{
      deviceId: device.id,
      name: device.name,
      type: device.type,
      placement: device.placement ?? defaultPlacement(device.type),
      total: totals.get(device.id) ?? points.length,
      downsampled: points.length > maxPoints,
      // 温度を基準に実データ点を選ぶ。温度が欠けている点は 0 とみなす（元実装と同じ）。
      points: lttb(points, maxPoints, (p) => p.ts, (p) => p.temperature ?? 0),
    }];
  });
}
```

- [ ] **Step 5: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "domain 層に時系列の組み立て（sensor / build-series）を追加

lib/transform.js の業務規則の部分を移植する。JST 表示文字列の生成は
表示の都合なので domain には含めず、presentation の DTO 変換へ回す。"
```

---

### Task 4: API 契約（zod）と DTO 変換

`src/shared/api-contract.ts` に FE/BE 共有の zod スキーマを定義し、`presentation/dto.ts` で `DeviceSeries` を API JSON へ変換する。**キーの並び順を現行と一致させる**（旧新の突き合わせ検証を成立させるため）。

**Files:**
- Create: `src/shared/api-contract.ts`, `src/server/presentation/dto.ts`
- Test: `src/shared/api-contract.test.ts`, `src/server/presentation/dto.test.ts`

**Interfaces:**
- Consumes: `DeviceSeries` from `src/server/domain/sensor.ts`
- Produces:
  - `const SensorPointSchema`, `const DeviceSeriesSchema`, `const SensorDataResponseSchema`（zod）
  - `type SensorPointDto`, `type DeviceSeriesDto`, `type SensorDataResponse`
  - `const PlacementUpdateRequestSchema`, `const PlacementUpdateResponseSchema`
  - `type PlacementUpdateRequest`, `type PlacementUpdateResponse`
  - `function toDeviceSeriesDto(series: DeviceSeries): DeviceSeriesDto`
  - `function toSensorDataResponse(series: readonly DeviceSeries[]): SensorDataResponse`

- [ ] **Step 1: zod を追加する**

```bash
npm install zod
```

- [ ] **Step 2: 失敗するテストを書く（DTO）**

`src/server/presentation/dto.test.ts` — `test/transform.test.js` のうち `time` / `ts` の公開形式に関する検証を引き継ぎ、キー順の検証を足す。

```ts
import { describe, expect, test } from 'vitest';
import { SensorDataResponseSchema } from '../../shared/api-contract.js';
import type { DeviceSeries } from '../domain/sensor.js';
import { toSensorDataResponse } from './dto.js';

const TS = Date.UTC(2026, 4, 31, 10, 0);   // JST 2026/5/31 19:00:00

function series(overrides: Partial<DeviceSeries> = {}): DeviceSeries {
  return {
    deviceId: 1,
    name: 'リビング',
    type: 'WoIOSensor',
    placement: 'outdoor',
    total: 52431,
    downsampled: false,
    points: [{ ts: TS, temperature: 24.9, humidity: 55 }],
    ...overrides,
  };
}

describe('toSensorDataResponse', () => {
  test('device_id / name / type / placement / total / downsampled / data を持つ', () => {
    const [dto] = toSensorDataResponse([series()]);
    expect(dto).toMatchObject({
      device_id: 1, name: 'リビング', type: 'WoIOSensor',
      placement: 'outdoor', total: 52431, downsampled: false,
    });
    expect(dto!.data).toHaveLength(1);
  });

  test('各点は ts（エポックミリ秒）と time（JST 表示文字列）を持つ', () => {
    const [dto] = toSensorDataResponse([series()]);
    const point = dto!.data[0]!;
    expect(point.ts).toBe(TS);
    expect(point.time).toBe(
      new Date(TS).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    );
  });

  test('点のキー順は ts, time, temperature, humidity, battery, co2', () => {
    const [dto] = toSensorDataResponse([series({
      points: [{ ts: TS, temperature: 24.9, humidity: 55, battery: 88, co2: 718 }],
    })]);
    expect(Object.keys(dto!.data[0]!)).toEqual(
      ['ts', 'time', 'temperature', 'humidity', 'battery', 'co2'],
    );
  });

  test('co2 / battery を持たない点にはキー自体を付けない', () => {
    const [dto] = toSensorDataResponse([series()]);
    const point = dto!.data[0]!;
    expect('co2' in point).toBe(false);
    expect('battery' in point).toBe(false);
  });

  test('欠損値は null のまま公開する', () => {
    const [dto] = toSensorDataResponse([series({
      points: [{ ts: TS, temperature: 24, humidity: null }],
    })]);
    expect(dto!.data[0]!.humidity).toBeNull();
  });

  test('生成した JSON は API 契約スキーマを満たす', () => {
    const response = toSensorDataResponse([series()]);
    expect(() => SensorDataResponseSchema.parse(response)).not.toThrow();
  });
});
```

- [ ] **Step 3: 失敗するテストを書く（API 契約）**

`src/shared/api-contract.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  DeviceSeriesSchema, PlacementUpdateRequestSchema, SensorPointSchema,
} from './api-contract.js';

describe('SensorPointSchema', () => {
  test('最小構成（ts / time / temperature / humidity）を受け付ける', () => {
    expect(() => SensorPointSchema.parse({
      ts: 1_748_685_600_000, time: '2026/5/31 19:00:00', temperature: 24.9, humidity: 55,
    })).not.toThrow();
  });

  test('temperature / humidity は null を許容する', () => {
    expect(() => SensorPointSchema.parse({
      ts: 1, time: 'x', temperature: null, humidity: null,
    })).not.toThrow();
  });

  test('co2 / battery は任意', () => {
    const parsed = SensorPointSchema.parse({
      ts: 1, time: 'x', temperature: 1, humidity: 1, co2: 700, battery: 90,
    });
    expect(parsed.co2).toBe(700);
    expect(parsed.battery).toBe(90);
  });
});

describe('DeviceSeriesSchema', () => {
  test('name / type は null を許容する（DB のカラムが NULL 許容のため）', () => {
    expect(() => DeviceSeriesSchema.parse({
      device_id: 1, name: null, type: null, placement: 'indoor',
      total: 0, downsampled: false, data: [],
    })).not.toThrow();
  });

  test('placement は indoor / outdoor のみ', () => {
    expect(() => DeviceSeriesSchema.parse({
      device_id: 1, name: 'x', type: 'y', placement: 'garden',
      total: 0, downsampled: false, data: [],
    })).toThrow();
  });
});

describe('PlacementUpdateRequestSchema', () => {
  test('indoor / outdoor を受け付け、それ以外は失敗する', () => {
    expect(PlacementUpdateRequestSchema.safeParse({ placement: 'indoor' }).success).toBe(true);
    expect(PlacementUpdateRequestSchema.safeParse({ placement: 'outdoor' }).success).toBe(true);
    expect(PlacementUpdateRequestSchema.safeParse({ placement: 'garden' }).success).toBe(false);
    expect(PlacementUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(PlacementUpdateRequestSchema.safeParse(null).success).toBe(false);
  });
});
```

- [ ] **Step 4: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./api-contract.js"`

- [ ] **Step 5: api-contract.ts を実装する**

```ts
// API の契約。サーバーは応答を組み立てたあとに、クライアントは受信時に
// 同じスキーマを使う。型は z.infer で導出するので二重定義にならない。

import { z } from 'zod';

export const PlacementSchema = z.enum(['indoor', 'outdoor']);

export const SensorPointSchema = z.object({
  /** 測定時刻（エポックミリ秒）。クライアントが横軸ラベルを整形するのに使う */
  ts: z.number(),
  /** JST の表示文字列。ツールチップのフル日時に使う */
  time: z.string(),
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  battery: z.number().optional(),
  co2: z.number().optional(),
});

export const DeviceSeriesSchema = z.object({
  device_id: z.number(),
  name: z.string().nullable(),
  type: z.string().nullable(),
  placement: PlacementSchema,
  /** 表示範囲に依存しない全期間の総件数 */
  total: z.number(),
  downsampled: z.boolean(),
  data: z.array(SensorPointSchema),
});

export const SensorDataResponseSchema = z.array(DeviceSeriesSchema);

export const PlacementUpdateRequestSchema = z.object({
  placement: PlacementSchema,
});

export const PlacementUpdateResponseSchema = z.object({
  device_id: z.number(),
  placement: PlacementSchema,
});

export type SensorPointDto = z.infer<typeof SensorPointSchema>;
export type DeviceSeriesDto = z.infer<typeof DeviceSeriesSchema>;
export type SensorDataResponse = z.infer<typeof SensorDataResponseSchema>;
export type PlacementUpdateRequest = z.infer<typeof PlacementUpdateRequestSchema>;
export type PlacementUpdateResponse = z.infer<typeof PlacementUpdateResponseSchema>;
```

- [ ] **Step 6: dto.ts を実装する**

```ts
// ドメインの時系列を API の JSON へ変換する。表示のための都合（JST の日時文字列、
// スネークケースのキー名、キーの並び順）はこの層だけが知る。

import type {
  DeviceSeriesDto, SensorDataResponse, SensorPointDto,
} from '../../shared/api-contract.js';
import type { DeviceSeries, SeriesPoint } from '../domain/sensor.js';

// サーバーの time とクライアントの横軸ラベルで同じ暦を見せるため JST 固定。
const JST_FORMAT: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Tokyo' };

function toPointDto(point: SeriesPoint): SensorPointDto {
  // キーの並び順は現行実装と一致させる（移行前後で JSON をバイト単位で
  // 突き合わせて検証するため）。battery が co2 より前に来るのも現行どおり。
  return {
    ts: point.ts,
    time: new Date(point.ts).toLocaleString('ja-JP', JST_FORMAT),
    temperature: point.temperature,
    humidity: point.humidity,
    ...(point.battery !== undefined ? { battery: point.battery } : {}),
    ...(point.co2 !== undefined ? { co2: point.co2 } : {}),
  };
}

export function toDeviceSeriesDto(series: DeviceSeries): DeviceSeriesDto {
  return {
    device_id: series.deviceId,
    name: series.name,
    type: series.type,
    placement: series.placement,
    total: series.total,
    downsampled: series.downsampled,
    data: series.points.map(toPointDto),
  };
}

export function toSensorDataResponse(series: readonly DeviceSeries[]): SensorDataResponse {
  return series.map(toDeviceSeriesDto);
}
```

- [ ] **Step 7: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "zod による API 契約と DTO 変換を追加

レスポンスのスキーマを src/shared に 1 箇所だけ定義し、型は z.infer で導出する。
DTO はキーの並び順まで現行実装に合わせ、移行前後の JSON 突き合わせを成立させる。"
```

---

### Task 5: 設定（zod）とロガー（pino）

環境変数の読み取りを 1 箇所に集め、起動時に検証して失敗させる。ロガーを pino に置き換える。

**Files:**
- Create: `src/server/config.ts`, `src/server/infrastructure/logger.ts`
- Test: `src/server/config.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface AppConfig { port: number; db: { host: string; port: number; user: string; password: string; database: string; poolLimit: number }; totalsTtlMs: number; logLevel: string; nodeEnv: 'development' | 'production' | 'test' }`
  - `function loadConfig(env: NodeJS.ProcessEnv): AppConfig`（検証失敗時は読みやすいメッセージで throw）
  - `function createLogger(level: string): Logger`（pino の `Logger`）
  - `type Logger`（`src/server/infrastructure/logger.ts` から re-export）

- [ ] **Step 1: 依存を追加する**

```bash
npm install pino pino-http pino-pretty
```

`pino-pretty` は本番以外で実行時に読み込まれる（`NODE_ENV` が未設定なら本番扱いに
ならない）ため、devDependencies ではなく dependencies に入れる。

- [ ] **Step 2: 失敗するテストを書く**

`src/server/config.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { loadConfig } from './config.js';

const REQUIRED = {
  DB_HOST: 'db.local',
  DB_USER: 'dash',
  DB_PASSWORD: 'secret',
  DB_NAME: 'switchbot_db',
};

describe('loadConfig', () => {
  test('必須の DB 接続情報を読み取る', () => {
    const config = loadConfig({ ...REQUIRED });
    expect(config.db).toMatchObject({
      host: 'db.local', user: 'dash', password: 'secret', database: 'switchbot_db',
    });
  });

  test('省略可能な値は既定値になる', () => {
    const config = loadConfig({ ...REQUIRED });
    expect(config.port).toBe(3000);
    expect(config.db.port).toBe(3306);
    expect(config.db.poolLimit).toBe(10);
    expect(config.totalsTtlMs).toBe(60_000);
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('development');
  });

  test('数値は文字列から変換する', () => {
    const config = loadConfig({ ...REQUIRED, PORT: '8080', DB_PORT: '3307', DB_POOL_LIMIT: '25', TOTALS_TTL_MS: '5000' });
    expect(config.port).toBe(8080);
    expect(config.db.port).toBe(3307);
    expect(config.db.poolLimit).toBe(25);
    expect(config.totalsTtlMs).toBe(5000);
  });

  test('DB_HOST が無ければ起動を止める', () => {
    expect(() => loadConfig({ DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' }))
      .toThrow(/DB_HOST/);
  });

  test('DB_PASSWORD は空文字を許容する（パスワード無しの MySQL 構成）', () => {
    expect(() => loadConfig({ ...REQUIRED, DB_PASSWORD: '' })).not.toThrow();
  });

  test('数値でない PORT はエラーメッセージに変数名を含める', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: 'abc' })).toThrow(/PORT/);
  });

  test('未知のログレベルは弾く', () => {
    expect(() => loadConfig({ ...REQUIRED, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./config.js"`

- [ ] **Step 4: config.ts を実装する**

```ts
// 環境変数の読み取りと検証。process.env をここ以外では参照しない。
// 不足・不正があれば起動時点で落とす（実行中に undefined が紛れ込むより、
// 起動が失敗して原因が 1 行で分かる方が運用しやすい）。

import { z } from 'zod';

const EnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
  DB_POOL_LIMIT: z.coerce.number().int().positive().default(10),
  PORT: z.coerce.number().int().positive().default(3000),
  TOTALS_TTL_MS: z.coerce.number().int().positive().default(60_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export interface AppConfig {
  readonly port: number;
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
    readonly poolLimit: number;
  };
  readonly totalsTtlMs: number;
  readonly logLevel: string;
  readonly nodeEnv: 'development' | 'production' | 'test';
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    // zod の既定メッセージは変数名を含まないので、変数名付きで組み立て直す。
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`環境変数の設定に問題があります:\n${details}`);
  }

  const e = result.data;
  return {
    port: e.PORT,
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      database: e.DB_NAME,
      poolLimit: e.DB_POOL_LIMIT,
    },
    totalsTtlMs: e.TOTALS_TTL_MS,
    logLevel: e.LOG_LEVEL,
    nodeEnv: e.NODE_ENV,
  };
}
```

- [ ] **Step 5: logger.ts を実装する**

```ts
// pino による構造化ログ。PM2 配下（pm_id がセットされる）では PM2 が
// タイムスタンプを付けるため、二重表示を避けて自前のものは省く。
// 本番以外は pino-pretty で人が読める形に整える。

import { pino, type Logger } from 'pino';

export type { Logger };

const UNDER_PM2 = process.env['pm_id'] !== undefined;

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    timestamp: UNDER_PM2 ? false : pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
      : {}),
  });
}
```

- [ ] **Step 6: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "環境変数の zod 検証と pino ロガーを追加

process.env の参照を config.ts に集約し、不足や不正があれば起動時に
変数名付きのメッセージで落とす。lib/logger.js の自前実装を pino に置き換える。"
```

---

### Task 6: Kysely のスキーマ・接続・時間窓

**Files:**
- Create: `src/server/infrastructure/db/schema.ts`, `create-db.ts`, `window.ts`, `filters.ts`
- Test: `src/server/infrastructure/db/window.test.ts`

**Interfaces:**
- Consumes: `RANGE_BY_KEY` / `RangeKey` from `src/shared/ranges.ts`, `AppConfig` from `src/server/config.ts`
- Produces:
  - `interface Database { devices: DevicesTable; device_status_logs: DeviceStatusLogsTable; device_settings: DeviceSettingsTable }`
  - `type Db = Kysely<Database>`
  - `function createDb(config: AppConfig['db']): { db: Db; close: () => Promise<void> }`
  - `function applyWindow<O>(qb: SelectQueryBuilder<Database, 'device_status_logs as l', O>, range: unknown, offset: unknown): SelectQueryBuilder<Database, 'device_status_logs as l', O>`（丸め込みは内部で行うので未検証の値を渡してよい）
  - `function hasSensorReading(eb: ExpressionBuilder<Database, 'device_status_logs as l'>): Expression<SqlBool>`
  - `function createTestDb(): Db`（SQL のコンパイルだけを行うダミー DB。テスト用）

- [ ] **Step 1: 依存を追加する**

```bash
npm install kysely
```

（`mysql2` は既に依存にある）

- [ ] **Step 2: 失敗するテストを書く**

`src/server/infrastructure/db/window.test.ts` — `test/ranges.test.js` の SQL 生成に関する 6 ケースを、コンパイル済み SQL の検証として移植する。

```ts
import { describe, expect, test } from 'vitest';
import { INTERVAL_UNITS, RANGE_KEYS } from '../../../shared/ranges.js';
import { createTestDb } from './create-db.js';
import { applyWindow } from './window.js';

const db = createTestDb();

function compile(range: unknown, offset: unknown) {
  const { sql, parameters } = applyWindow(
    db.selectFrom('device_status_logs as l').select('l.device_id'),
    range,
    offset,
  ).compile();
  return { sql, parameters };
}

describe('applyWindow', () => {
  test('offset=0 は下限のみ・count をバインドする', () => {
    const { sql, parameters } = compile('24h', 0);
    expect(sql).toMatch(/`l`\.`recorded_at` >= DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
    expect(sql).not.toMatch(/</);
    expect(parameters).toEqual([24]);
  });

  test('offset>0 は上下限あり・count の倍数をバインドする', () => {
    const { sql, parameters } = compile('24h', 2);
    expect(sql).toMatch(/>= DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
    expect(sql).toMatch(/< DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
    expect(parameters).toEqual([24 * 3, 24 * 2]);   // [遠い境界, 近い境界]
  });

  test('週・月・年の単位が正しく使われる', () => {
    expect(compile('1w', 0).sql).toMatch(/INTERVAL \? DAY/);
    expect(compile('1w', 0).parameters).toEqual([7]);
    expect(compile('1mo', 1).sql).toMatch(/INTERVAL \? MONTH/);
    expect(compile('3y', 1).sql).toMatch(/INTERVAL \? YEAR/);
    expect(compile('3y', 1).parameters).toEqual([6, 3]);
  });

  test("'all' は絞り込みを付けない（オフセットも無視）", () => {
    for (const offset of [0, 5]) {
      const { sql, parameters } = compile('all', offset);
      expect(sql).not.toMatch(/recorded_at/);
      expect(parameters).toEqual([]);
    }
  });

  test('未知のキーは既定(24h)として扱う', () => {
    expect(compile('; DROP TABLE devices;--', 0)).toEqual(compile('24h', 0));
  });

  test('不正な offset は最新ウィンドウに丸められる', () => {
    expect(compile('24h', -3)).toEqual(compile('24h', 0));
    expect(compile('24h', 'xyz')).toEqual(compile('24h', 0));
    expect(compile('24h', undefined)).toEqual(compile('24h', 0));
  });

  test('生成される SQL の単位はホワイトリスト由来で、数量は必ずバインドされる', () => {
    for (const key of RANGE_KEYS) {
      for (const offset of [0, 1, 4]) {
        const { sql } = compile(key, offset);
        const units = [...sql.matchAll(/INTERVAL \? (\w+)/g)].map((m) => m[1]!);
        for (const unit of units) expect(INTERVAL_UNITS.has(unit)).toBe(true);
        // 数値リテラルが直接埋め込まれていないこと
        expect(sql).not.toMatch(/INTERVAL \d/);
      }
    }
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./create-db.js"`

- [ ] **Step 4: schema.ts を実装する**

```ts
// Kysely が参照するテーブル定義。ddl/ の CREATE TABLE と 1 対 1 で対応する。
// devices / device_status_logs はデータ収集側が管理するテーブルで、
// ダッシュボードは参照のみ。device_settings だけが自己管理。

import type { Generated } from 'kysely';
import type { Placement } from '../../domain/placement.js';

export interface DevicesTable {
  id: number;
  device_name: string | null;
  device_type: string | null;
  is_virtual_infrared: number | null;
}

export interface DeviceStatusLogsTable {
  id: Generated<number>;
  device_id: number | null;
  /** JSON 列。中身の形は収集側が決めるので unknown で受けて repository で絞り込む */
  status_data: unknown;
  recorded_at: Date | null;
}

export interface DeviceSettingsTable {
  device_id: number;
  placement: Placement;
}

export interface Database {
  devices: DevicesTable;
  device_status_logs: DeviceStatusLogsTable;
  device_settings: DeviceSettingsTable;
}
```

- [ ] **Step 5: create-db.ts を実装する**

```ts
// MySQL 接続の生成。接続はリクエスト毎に張り直さずプールで使い回す
// （TCP/認証ハンドシェイクを毎回払うのを避け、表示のレイテンシを下げる）。

import {
  DummyDriver, Kysely, MysqlAdapter, MysqlDialect,
  MysqlIntrospector, MysqlQueryCompiler,
} from 'kysely';
import { createPool } from 'mysql2';
import type { AppConfig } from '../../config.js';
import type { Database } from './schema.js';

export type Db = Kysely<Database>;

export function createDb(config: AppConfig['db']): { db: Db; close: () => Promise<void> } {
  const pool = createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.poolLimit,
    maxIdle: config.poolLimit,
  });

  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
  // destroy はプールごと閉じる。閉じ忘れるとプロセスが終了しない。
  return { db, close: () => db.destroy() };
}

/**
 * SQL のコンパイルだけを行うダミー DB。実行するとエラーになるが、
 * `.compile()` で生成 SQL とバインド値を検証できるためテストで使う。
 */
export function createTestDb(): Db {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  });
}
```

- [ ] **Step 6: filters.ts を実装する**

```ts
// ダッシュボードが扱う有効なセンサー行だけに絞る条件。総件数の集計と表示窓の
// 抽出で必ず同じ式を使うため、1 箇所に置いて両方から呼ぶ（件数の整合を保つ）。

import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { Database } from './schema.js';

export function hasSensorReading(
  _eb: ExpressionBuilder<Database, 'device_status_logs as l'>,
): Expression<SqlBool> {
  return sql<SqlBool>`JSON_LENGTH(l.status_data) > 0
          AND JSON_EXTRACT(l.status_data, '$.temperature') IS NOT NULL`;
}
```

- [ ] **Step 7: window.ts を実装する**

```ts
// 表示範囲とページオフセットから recorded_at の絞り込みを組み立てる。
//
// 時刻の基準は DB の NOW() のまま残す。アプリ側で Date を計算すると、
// DB が別ホストにある構成で時計ずれという新しい障害要因が増えるうえ、
// INTERVAL 1 MONTH の月末クランプ挙動を JS 側で再現する必要も出るため。
//
// unit は RANGE_BY_KEY 由来の固定文字列、count は必ずバインドするので
// 注入の余地はない。条件を「付ける / 付けない」の分岐は Kysely の $if で
// 表現し、SQL 断片の文字列連結は行わない。

import { sql, type SelectQueryBuilder } from 'kysely';
import { RANGE_BY_KEY, type IntervalUnit } from '../../../shared/ranges.js';
import { resolveOffset, resolveRange } from '../../domain/range.js';
import type { Database } from './schema.js';

type LogsQuery<O> = SelectQueryBuilder<Database, 'device_status_logs as l', O>;

const ago = (count: number, unit: IntervalUnit) =>
  sql<Date>`DATE_SUB(NOW(), INTERVAL ${count} ${sql.raw(unit)})`;

// range / offset はクエリ文字列由来の未検証の値を受け取り、内部で丸める。
export function applyWindow<O>(qb: LogsQuery<O>, range: unknown, offset: unknown): LogsQuery<O> {
  const spec = RANGE_BY_KEY[resolveRange(range)];
  if (spec.unit === null) return qb;          // 'all' は窓幅を持たないので絞り込まない

  const unit = spec.unit;
  const off = resolveOffset(offset);

  // offset=0 は最新ウィンドウ（下限のみ）。offset=k は 1 区間幅ずつ k 個ぶん
  // 過去の窓 [NOW-(k+1)*span, NOW-k*span)。
  return qb
    .where('l.recorded_at', '>=', ago(spec.count * (off + 1), unit))
    .$if(off > 0, (q) => q.where('l.recorded_at', '<', ago(spec.count * off, unit)));
}
```

- [ ] **Step 8: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS

生成 SQL がバッククォート付きの識別子（`` `l`.`recorded_at` ``）になる点でテストの正規表現が合わない場合は、テスト側の正規表現を実際の出力に合わせて修正する（生成 SQL の形が現行の手書き SQL と文字単位で同じである必要はない。重要なのは単位がホワイトリスト由来であること・数量がバインドされていること・境界の値が同じであること）。

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "Kysely のスキーマ・接続・時間窓を追加

windowClause が返していた SQL 文字列とバインド値の組を、Kysely の式の
合成に置き換える。時刻の基準は DB の NOW() のまま残し、挙動を変えない。
センサー行フィルタは 1 つの式にして総件数と窓クエリの両方から使う。"
```

---

### Task 7: Port の定義と Repository / キャッシュの実装

**Files:**
- Create: `src/server/application/ports.ts`
- Create: `src/server/infrastructure/db/device.repository.ts`, `src/server/infrastructure/db/sensor-log.repository.ts`
- Create: `src/server/infrastructure/totals-cache.ts`
- Test: `src/server/infrastructure/totals-cache.test.ts`, `src/server/infrastructure/db/sensor-log.repository.test.ts`

**Interfaces:**
- Consumes: `DeviceInfo` / `Reading` from `src/server/domain/sensor.ts`, `Placement` from `src/server/domain/placement.ts`, `Db` from `../db/create-db.js`, `applyWindow`, `hasSensorReading`
- Produces:
  - `interface DeviceRepository { listSensorDevices(): Promise<DeviceInfo[]>; savePlacement(deviceId: number, placement: Placement): Promise<void> }`
  - `interface SensorLogRepository { listReadings(range: RangeKey, offset: number): Promise<Reading[]>; countByDevice(): Promise<Map<number, number>> }`
  - `interface TotalsCache { get(): Map<number, number> | undefined; set(totals: Map<number, number>): void }`
  - `type Logger`（pino の `Logger` を `ports.ts` から re-export。presentation はこちらを使い、`infrastructure/logger.ts` を直接 import しない）
  - `function createDeviceRepository(db: Db): DeviceRepository`
  - `function createSensorLogRepository(db: Db): SensorLogRepository`
  - `function createTotalsCache(ttlMs: number): TotalsCache`
  - `function parseStatusData(raw: unknown): { temperature: number | null; humidity: number | null; co2?: number; battery?: number }`（`sensor-log.repository.ts` から export）

- [ ] **Step 1: 依存を追加する**

```bash
npm install lru-cache
```

- [ ] **Step 2: 失敗するテストを書く（キャッシュ）**

`src/server/infrastructure/totals-cache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTotalsCache } from './totals-cache.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createTotalsCache', () => {
  test('未設定なら undefined を返す', () => {
    expect(createTotalsCache(60_000).get()).toBeUndefined();
  });

  test('TTL 内は保存した値を返す', () => {
    const cache = createTotalsCache(60_000);
    cache.set(new Map([[1, 100]]));
    vi.advanceTimersByTime(59_000);
    expect(cache.get()).toEqual(new Map([[1, 100]]));
  });

  test('TTL を過ぎたら undefined を返す', () => {
    const cache = createTotalsCache(60_000);
    cache.set(new Map([[1, 100]]));
    vi.advanceTimersByTime(61_000);
    expect(cache.get()).toBeUndefined();
  });

  test('後から set した値で上書きされる', () => {
    const cache = createTotalsCache(60_000);
    cache.set(new Map([[1, 100]]));
    cache.set(new Map([[1, 200]]));
    expect(cache.get()).toEqual(new Map([[1, 200]]));
  });
});
```

- [ ] **Step 3: 失敗するテストを書く（status_data のパース）**

`src/server/infrastructure/db/sensor-log.repository.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseStatusData } from './sensor-log.repository.js';

describe('parseStatusData', () => {
  test('温度・湿度を取り出す', () => {
    expect(parseStatusData({ temperature: 24.9, humidity: 55 }))
      .toEqual({ temperature: 24.9, humidity: 55 });
  });

  test('CO2 は co2 という名前に付け替える（API のフィールド名に合わせる）', () => {
    expect(parseStatusData({ temperature: 22, humidity: 60, CO2: 718 }))
      .toEqual({ temperature: 22, humidity: 60, co2: 718 });
  });

  test('battery があれば取り出す', () => {
    expect(parseStatusData({ temperature: 22, humidity: 60, battery: 88 }))
      .toEqual({ temperature: 22, humidity: 60, battery: 88 });
  });

  test('欠けている温度・湿度は null になる', () => {
    expect(parseStatusData({ temperature: 24 })).toEqual({ temperature: 24, humidity: null });
  });

  test('CO2 / battery が無ければキー自体を付けない', () => {
    const parsed = parseStatusData({ temperature: 24, humidity: 50 });
    expect('co2' in parsed).toBe(false);
    expect('battery' in parsed).toBe(false);
  });

  test('MySQL が文字列で返した JSON も解釈する', () => {
    expect(parseStatusData('{"temperature":24.9,"humidity":55,"CO2":700}'))
      .toEqual({ temperature: 24.9, humidity: 55, co2: 700 });
  });

  test('壊れた値・非オブジェクトは全項目 null として扱う', () => {
    expect(parseStatusData('not json')).toEqual({ temperature: null, humidity: null });
    expect(parseStatusData(null)).toEqual({ temperature: null, humidity: null });
    expect(parseStatusData(42)).toEqual({ temperature: null, humidity: null });
  });

  test('数値でない温度・湿度は null に落とす', () => {
    expect(parseStatusData({ temperature: 'hot', humidity: true }))
      .toEqual({ temperature: null, humidity: null });
  });
});
```

- [ ] **Step 4: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — 2 件のインポート解決エラー

- [ ] **Step 5: ports.ts を実装する**

```ts
// ユースケースが外界に求めることの一覧。実装は infrastructure が持ち、
// application はこのインターフェースだけを見る。

import type { RangeKey } from '../../shared/ranges.js';
import type { Placement } from '../domain/placement.js';
import type { DeviceInfo, Reading } from '../domain/sensor.js';

export interface DeviceRepository {
  /** 仮想赤外線デバイスを除いた、センサーとして扱うデバイスの一覧 */
  listSensorDevices(): Promise<DeviceInfo[]>;
  /** 設置場所を保存する（未登録なら挿入、登録済みなら更新） */
  savePlacement(deviceId: number, placement: Placement): Promise<void>;
}

export interface SensorLogRepository {
  /** 表示窓に入る測定値を device_id・recorded_at の昇順で返す */
  listReadings(range: RangeKey, offset: number): Promise<Reading[]>;
  /** 表示範囲に依存しない全期間の総件数をデバイス別に返す */
  countByDevice(): Promise<Map<number, number>>;
}

export interface TotalsCache {
  get(): Map<number, number> | undefined;
  set(totals: Map<number, number>): void;
}

// ロガーの型。presentation も infrastructure もここから取ることで、
// presentation → infrastructure という逆向きの import を作らずに済む。
export type { Logger } from 'pino';
```

- [ ] **Step 6: totals-cache.ts を実装する**

```ts
// 総件数の TTL キャッシュ。総件数クエリは range/offset に依存せず全行を走査する
// 重い集計で、JSON 関数のため索引も効かない。値は新規ログでしか増えず変化が
// 緩やかなので、TTL の間は結果を使い回して実行頻度を下げる
// （UI は 30 秒ごとに更新するため毎回の再集計は不要）。

import { LRUCache } from 'lru-cache';
import type { TotalsCache } from '../application/ports.js';

const KEY = 'totals';

export function createTotalsCache(ttlMs: number): TotalsCache {
  const cache = new LRUCache<string, Map<number, number>>({ max: 1, ttl: ttlMs });
  return {
    get: () => cache.get(KEY),
    set: (totals) => { cache.set(KEY, totals); },
  };
}
```

- [ ] **Step 7: device.repository.ts を実装する**

```ts
import type { DeviceRepository } from '../../application/ports.js';
import type { Placement } from '../../domain/placement.js';
import type { Db } from './create-db.js';

export function createDeviceRepository(db: Db): DeviceRepository {
  return {
    async listSensorDevices() {
      const rows = await db
        .selectFrom('devices as d')
        .leftJoin('device_settings as s', 's.device_id', 'd.id')
        .select(['d.id', 'd.device_name', 'd.device_type', 's.placement'])
        .where('d.is_virtual_infrared', '=', 0)
        .orderBy('d.id')
        .execute();

      return rows.map((row) => ({
        id: row.id,
        name: row.device_name,
        type: row.device_type,
        placement: row.placement ?? null,
      }));
    },

    async savePlacement(deviceId: number, placement: Placement) {
      await db
        .insertInto('device_settings')
        .values({ device_id: deviceId, placement })
        .onDuplicateKeyUpdate({ placement })
        .execute();
    },
  };
}
```

- [ ] **Step 8: sensor-log.repository.ts を実装する**

```ts
import type { SensorLogRepository } from '../../application/ports.js';
import type { Reading } from '../../domain/sensor.js';
import type { RangeKey } from '../../../shared/ranges.js';
import type { Db } from './create-db.js';
import { hasSensorReading } from './filters.js';
import { applyWindow } from './window.js';

type StatusValues = {
  temperature: number | null;
  humidity: number | null;
  co2?: number;
  battery?: number;
};

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

/**
 * status_data（JSON 列）からダッシュボードが使う値を取り出す。
 * mysql2 は JSON 列をパース済みで返すが、ドライバ設定や列型の違いで
 * 文字列のまま来る場合もあるため両方を受ける。
 * 収集側が決める JSON なので、想定外の形は「値なし」として扱い落とさない。
 */
export function parseStatusData(raw: unknown): StatusValues {
  const source = typeof raw === 'string' ? tryParseJson(raw) : raw;
  if (typeof source !== 'object' || source === null) {
    return { temperature: null, humidity: null };
  }

  const s = source as Record<string, unknown>;
  const co2 = numberOrNull(s['CO2']);
  const battery = numberOrNull(s['battery']);
  return {
    temperature: numberOrNull(s['temperature']),
    humidity: numberOrNull(s['humidity']),
    ...(battery !== null ? { battery } : {}),
    ...(co2 !== null ? { co2 } : {}),
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createSensorLogRepository(db: Db): SensorLogRepository {
  return {
    async listReadings(range: RangeKey, offset: number): Promise<Reading[]> {
      const rows = await applyWindow(
        db
          .selectFrom('device_status_logs as l')
          .select(['l.device_id', 'l.status_data', 'l.recorded_at'])
          .where(hasSensorReading),
        range,
        offset,
      )
        .orderBy('l.device_id')
        .orderBy('l.recorded_at', 'asc')
        .execute();

      const readings: Reading[] = [];
      for (const row of rows) {
        if (row.device_id === null || row.recorded_at === null) continue;
        readings.push({
          deviceId: row.device_id,
          ts: new Date(row.recorded_at).getTime(),
          ...parseStatusData(row.status_data),
        });
      }
      return readings;
    },

    async countByDevice(): Promise<Map<number, number>> {
      const rows = await db
        .selectFrom('device_status_logs as l')
        .select(({ fn }) => ['l.device_id', fn.countAll<number>().as('total')])
        .where(hasSensorReading)
        .groupBy('l.device_id')
        .execute();

      const totals = new Map<number, number>();
      for (const row of rows) {
        if (row.device_id !== null) totals.set(row.device_id, Number(row.total));
      }
      return totals;
    },
  };
}
```

- [ ] **Step 9: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS

- [ ] **Step 10: コミット**

```bash
git add -A
git commit -m "Port の定義と Repository / 総件数キャッシュの実装を追加

application が外界に求めることを ports.ts のインターフェースに切り出し、
MySQL 実装と lru-cache 実装を infrastructure に置く。status_data の
JSON パースは repository の責務として型付きの値へ変換する。"
```

---

### Task 8: ユースケース

**Files:**
- Create: `src/server/application/get-sensor-data.ts`, `src/server/application/set-device-placement.ts`
- Test: `src/server/application/get-sensor-data.test.ts`, `src/server/application/set-device-placement.test.ts`

**Interfaces:**
- Consumes: `DeviceRepository` / `SensorLogRepository` / `TotalsCache` from `./ports.js`, `buildSeries` from `../domain/build-series.js`
- Produces:
  - `interface GetSensorDataDeps { devices: DeviceRepository; logs: SensorLogRepository; totalsCache: TotalsCache }`
  - `function makeGetSensorData(deps: GetSensorDataDeps): (query: { range: unknown; offset: unknown }) => Promise<DeviceSeries[]>`
  - `function makeSetDevicePlacement(deps: { devices: DeviceRepository }): (deviceId: number, placement: Placement) => Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`src/server/application/get-sensor-data.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import type { RangeKey } from '../../shared/ranges.js';
import type { DeviceInfo, Reading } from '../domain/sensor.js';
import { makeGetSensorData } from './get-sensor-data.js';
import type { DeviceRepository, SensorLogRepository, TotalsCache } from './ports.js';

const DEVICES: DeviceInfo[] = [
  { id: 1, name: 'リビング', type: 'WoIOSensor', placement: null },
];

const READINGS: Reading[] = [
  { deviceId: 1, ts: Date.UTC(2026, 4, 31, 10, 0), temperature: 24.9, humidity: 55 },
];

function fakes(overrides: {
  readings?: Reading[];
  totals?: Map<number, number>;
  cached?: Map<number, number>;
} = {}) {
  const listReadings = vi.fn<SensorLogRepository['listReadings']>()
    .mockResolvedValue(overrides.readings ?? READINGS);
  const countByDevice = vi.fn<SensorLogRepository['countByDevice']>()
    .mockResolvedValue(overrides.totals ?? new Map([[1, 12345]]));
  let stored = overrides.cached;

  const devices: DeviceRepository = {
    listSensorDevices: vi.fn().mockResolvedValue(DEVICES),
    savePlacement: vi.fn(),
  };
  const logs: SensorLogRepository = { listReadings, countByDevice };
  const totalsCache: TotalsCache = {
    get: () => stored,
    set: (totals) => { stored = totals; },
  };
  return { devices, logs, totalsCache, listReadings, countByDevice };
}

describe('makeGetSensorData', () => {
  test('デバイス・測定値・総件数を組み合わせて時系列を返す', async () => {
    const { devices, logs, totalsCache } = fakes();
    const result = await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0]!.deviceId).toBe(1);
    expect(result[0]!.total).toBe(12345);
    expect(result[0]!.points).toHaveLength(1);
  });

  test('不正な range / offset は既定へ丸めて repository に渡す', async () => {
    const { devices, logs, totalsCache, listReadings } = fakes();
    await makeGetSensorData({ devices, logs, totalsCache })({ range: 'bogus', offset: -5 });

    expect(listReadings).toHaveBeenCalledWith('24h' satisfies RangeKey, 0);
  });

  test('有効な range / offset はそのまま渡す', async () => {
    const { devices, logs, totalsCache, listReadings } = fakes();
    await makeGetSensorData({ devices, logs, totalsCache })({ range: '1w', offset: '3' });

    expect(listReadings).toHaveBeenCalledWith('1w', 3);
  });

  test('キャッシュに総件数があれば集計クエリを実行しない', async () => {
    const { devices, logs, totalsCache, countByDevice } = fakes({ cached: new Map([[1, 999]]) });
    const result = await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(countByDevice).not.toHaveBeenCalled();
    expect(result[0]!.total).toBe(999);
  });

  test('キャッシュが空なら集計してキャッシュへ書き戻す', async () => {
    const { devices, logs, totalsCache, countByDevice } = fakes();
    await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(countByDevice).toHaveBeenCalledTimes(1);
    expect(totalsCache.get()).toEqual(new Map([[1, 12345]]));
  });

  test('測定値が無ければ空配列を返す', async () => {
    const { devices, logs, totalsCache } = fakes({ readings: [] });
    const result = await makeGetSensorData({ devices, logs, totalsCache })({ range: '24h', offset: 0 });

    expect(result).toEqual([]);
  });
});
```

`src/server/application/set-device-placement.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import type { DeviceRepository } from './ports.js';
import { makeSetDevicePlacement } from './set-device-placement.js';

describe('makeSetDevicePlacement', () => {
  test('repository に設置場所の保存を委譲する', async () => {
    const savePlacement = vi.fn().mockResolvedValue(undefined);
    const devices = { listSensorDevices: vi.fn(), savePlacement } as unknown as DeviceRepository;

    await makeSetDevicePlacement({ devices })(7, 'outdoor');

    expect(savePlacement).toHaveBeenCalledWith(7, 'outdoor');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — インポート解決エラー 2 件

- [ ] **Step 3: get-sensor-data.ts を実装する**

```ts
// センサーデータ取得のユースケース。SQL も HTTP も知らず、手順だけを書く。

import { buildSeries } from '../domain/build-series.js';
import { resolveOffset, resolveRange } from '../domain/range.js';
import type { DeviceSeries } from '../domain/sensor.js';
import type { DeviceRepository, SensorLogRepository, TotalsCache } from './ports.js';

export interface GetSensorDataDeps {
  readonly devices: DeviceRepository;
  readonly logs: SensorLogRepository;
  readonly totalsCache: TotalsCache;
}

export interface SensorDataQuery {
  readonly range: unknown;
  readonly offset: unknown;
}

export function makeGetSensorData(deps: GetSensorDataDeps) {
  return async function getSensorData(query: SensorDataQuery): Promise<DeviceSeries[]> {
    const range = resolveRange(query.range);
    const offset = resolveOffset(query.offset);

    const [devices, totals, readings] = await Promise.all([
      deps.devices.listSensorDevices(),
      getTotals(deps),
      deps.logs.listReadings(range, offset),
    ]);

    return buildSeries(devices, readings, totals);
  };
}

async function getTotals(deps: GetSensorDataDeps): Promise<Map<number, number>> {
  const cached = deps.totalsCache.get();
  if (cached) return cached;

  const totals = await deps.logs.countByDevice();
  deps.totalsCache.set(totals);
  return totals;
}
```

- [ ] **Step 4: set-device-placement.ts を実装する**

```ts
// 設置場所更新のユースケース。値の妥当性は presentation が zod で検査済みで、
// ここには Placement 型の値だけが渡ってくる。

import type { Placement } from '../domain/placement.js';
import type { DeviceRepository } from './ports.js';

export interface SetDevicePlacementDeps {
  readonly devices: DeviceRepository;
}

export function makeSetDevicePlacement(deps: SetDevicePlacementDeps) {
  return async function setDevicePlacement(deviceId: number, placement: Placement): Promise<void> {
    await deps.devices.savePlacement(deviceId, placement);
  };
}
```

- [ ] **Step 5: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS

現行実装は 3 つのクエリを直列に実行していたが、互いに依存しないため `Promise.all` で並行化している。返す値は同じ。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "センサーデータ取得と設置場所更新のユースケースを追加

フェイク Repository で検証できる形にし、範囲・オフセットの丸め込みと
総件数キャッシュの判断をユースケースの責務として明示する。
互いに依存しない 3 つの問い合わせは Promise.all で並行化する。"
```

---

### Task 9: HTTP 層（ルート・エラーハンドラ・アプリ組み立て）

**Files:**
- Create: `src/server/presentation/routes/sensor-data.ts`, `src/server/presentation/routes/placement.ts`
- Create: `src/server/presentation/error-handler.ts`, `src/server/presentation/create-app.ts`
- Test: `src/server/presentation/create-app.test.ts`

**Interfaces:**
- Consumes: `makeGetSensorData` / `makeSetDevicePlacement` の戻り値の型、`toSensorDataResponse` from `../dto.js`
- Produces:
  - `interface AppDeps { getSensorData: ReturnType<typeof makeGetSensorData>; setDevicePlacement: ReturnType<typeof makeSetDevicePlacement>; logger: Logger; staticDir: string }`
  - `function createApp(deps: AppDeps): express.Express`
  - `function errorHandler(logger: Logger): express.ErrorRequestHandler`

- [ ] **Step 1: 依存を追加する**

```bash
npm install http-errors
npm install --save-dev supertest @types/supertest @types/express @types/http-errors
```

- [ ] **Step 2: 失敗するテストを書く**

`src/server/presentation/create-app.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { pino } from 'pino';
import type { DeviceSeries } from '../domain/sensor.js';
import { createApp } from './create-app.js';

const SERIES: DeviceSeries[] = [{
  deviceId: 1, name: 'リビング', type: 'WoIOSensor', placement: 'outdoor',
  total: 12345, downsampled: false,
  points: [{ ts: Date.UTC(2026, 4, 31, 10, 0), temperature: 24.9, humidity: 55 }],
}];

const silentLogger = pino({ level: 'silent' });

function app(overrides: {
  getSensorData?: ReturnType<typeof vi.fn>;
  setDevicePlacement?: ReturnType<typeof vi.fn>;
} = {}) {
  const getSensorData = overrides.getSensorData ?? vi.fn().mockResolvedValue(SERIES);
  const setDevicePlacement = overrides.setDevicePlacement ?? vi.fn().mockResolvedValue(undefined);
  const instance = createApp({
    getSensorData, setDevicePlacement,
    logger: silentLogger,
    staticDir: fileURLToPath(new URL('.', import.meta.url)),
  });
  return { instance, getSensorData, setDevicePlacement };
}

describe('GET /api/sensor-data', () => {
  test('ユースケースの結果を API の JSON 形式で返す', async () => {
    const { instance } = app();
    const res = await request(instance).get('/api/sensor-data?range=24h&offset=0');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      device_id: 1, name: 'リビング', type: 'WoIOSensor', placement: 'outdoor',
      total: 12345, downsampled: false,
      data: [{
        ts: Date.UTC(2026, 4, 31, 10, 0),
        time: new Date(Date.UTC(2026, 4, 31, 10, 0)).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        temperature: 24.9, humidity: 55,
      }],
    }]);
  });

  test('range / offset をそのままユースケースへ渡す', async () => {
    const { instance, getSensorData } = app();
    await request(instance).get('/api/sensor-data?range=1w&offset=3');

    expect(getSensorData).toHaveBeenCalledWith({ range: '1w', offset: '3' });
  });

  test('クエリが無くても 200 を返す（丸め込みはユースケースの責務）', async () => {
    const { instance, getSensorData } = app();
    const res = await request(instance).get('/api/sensor-data');

    expect(res.status).toBe(200);
    expect(getSensorData).toHaveBeenCalledWith({ range: undefined, offset: undefined });
  });

  test('ユースケースが失敗したら 500 と error を返す', async () => {
    const { instance } = app({ getSensorData: vi.fn().mockRejectedValue(new Error('DB 落ちた')) });
    const res = await request(instance).get('/api/sensor-data');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'DB 落ちた' });
  });
});

describe('PUT /api/devices/:id/placement', () => {
  test('設置場所を保存して device_id と placement を返す', async () => {
    const { instance, setDevicePlacement } = app();
    const res = await request(instance).put('/api/devices/7/placement').send({ placement: 'outdoor' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ device_id: 7, placement: 'outdoor' });
    expect(setDevicePlacement).toHaveBeenCalledWith(7, 'outdoor');
  });

  test('placement が不正なら 400 を返し、保存しない', async () => {
    const { instance, setDevicePlacement } = app();
    for (const body of [{ placement: 'garden' }, {}, { placement: null }]) {
      const res = await request(instance).put('/api/devices/1/placement').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/indoor/);
    }
    expect(setDevicePlacement).not.toHaveBeenCalled();
  });

  test('id が整数でなければ 400 を返し、保存しない', async () => {
    const { instance, setDevicePlacement } = app();
    for (const id of ['abc', '1.5', '']) {
      const res = await request(instance).put(`/api/devices/${id}/placement`).send({ placement: 'indoor' });
      expect(res.status).toBe(400);
    }
    expect(setDevicePlacement).not.toHaveBeenCalled();
  });

  test('保存に失敗したら 500 を返す', async () => {
    const { instance } = app({ setDevicePlacement: vi.fn().mockRejectedValue(new Error('書けない')) });
    const res = await request(instance).put('/api/devices/1/placement').send({ placement: 'indoor' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: '書けない' });
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./create-app.js"`

- [ ] **Step 4: error-handler.ts を実装する**

```ts
// 例外を HTTP レスポンスへ写像する唯一の場所。Express 5 は Promise を返す
// ハンドラの reject をここへ自動で流すため、各ルートに try/catch を書かない。

import type { ErrorRequestHandler } from 'express';
import { isHttpError } from 'http-errors';
import type { Logger } from '../application/ports.js';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const status = isHttpError(err) ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);

    // 4xx は呼び出し側の入力ミスなので warn、5xx は要調査なので error。
    const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log({ err, method: req.method, url: req.originalUrl, status }, 'リクエスト処理に失敗');

    res.status(status).json({ error: message });
  };
}
```

- [ ] **Step 5: routes/sensor-data.ts を実装する**

```ts
import { Router } from 'express';
import type { makeGetSensorData } from '../../application/get-sensor-data.js';
import { toSensorDataResponse } from '../dto.js';

export function sensorDataRouter(getSensorData: ReturnType<typeof makeGetSensorData>): Router {
  const router = Router();

  // range / offset の不正値は 400 にせず既定へ丸める（URL 直打ちで画面が
  // 壊れないようにする現行仕様）。丸め込みはユースケース側の責務。
  router.get('/sensor-data', async (req, res) => {
    const series = await getSensorData({
      range: req.query['range'],
      offset: req.query['offset'],
    });
    res.json(toSensorDataResponse(series));
  });

  return router;
}
```

- [ ] **Step 6: routes/placement.ts を実装する**

```ts
import { Router } from 'express';
import createHttpError from 'http-errors';
import { z } from 'zod';
import type { makeSetDevicePlacement } from '../../application/set-device-placement.js';
import { PlacementUpdateRequestSchema } from '../../../shared/api-contract.js';

const ParamsSchema = z.object({ id: z.coerce.number().int() });

export function placementRouter(
  setDevicePlacement: ReturnType<typeof makeSetDevicePlacement>,
): Router {
  const router = Router();

  router.put('/devices/:id/placement', async (req, res) => {
    const params = ParamsSchema.safeParse(req.params);
    const body = PlacementUpdateRequestSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      throw createHttpError(400, 'placement は indoor / outdoor のいずれか、id は整数が必要です');
    }

    await setDevicePlacement(params.data.id, body.data.placement);
    res.json({ device_id: params.data.id, placement: body.data.placement });
  });

  return router;
}
```

`z.coerce.number().int()` は `'1.5'` を 1.5 に変換したうえで `.int()` が失敗するため、現行の `Number.isInteger` と同じ判定になる。`''` は 0 に変換されるので、`.int()` を通ってしまう点に注意する。空文字は Express のルーティング上 `/api/devices//placement` となりこのルートに一致しないため 404 になる。テストの期待値が 400 でなく 404 になる場合は、テスト側を 404 に直す（現行実装も同じく 404 を返す）。

- [ ] **Step 7: create-app.ts を実装する**

```ts
// Express アプリの組み立て。依存は引数で受け取り、この層は生成しない。

import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { makeGetSensorData } from '../application/get-sensor-data.js';
import type { makeSetDevicePlacement } from '../application/set-device-placement.js';
import type { Logger } from '../application/ports.js';
import { errorHandler } from './error-handler.js';
import { placementRouter } from './routes/placement.js';
import { sensorDataRouter } from './routes/sensor-data.js';

export interface AppDeps {
  readonly getSensorData: ReturnType<typeof makeGetSensorData>;
  readonly setDevicePlacement: ReturnType<typeof makeSetDevicePlacement>;
  readonly logger: Logger;
  /** ビルド済みフロントエンドの配置先 */
  readonly staticDir: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(pinoHttp({ logger: deps.logger }));
  app.use(express.json());
  app.use(express.static(deps.staticDir));

  app.use('/api', sensorDataRouter(deps.getSensorData));
  app.use('/api', placementRouter(deps.setDevicePlacement));

  app.use(errorHandler(deps.logger));

  return app;
}
```

- [ ] **Step 8: テストを通す**

Run: `npm test && npm run lint && npm run typecheck`
Expected: すべて PASS

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "HTTP 層（ルート・エラーハンドラ・アプリ組み立て）を追加

Express 5 の async エラー自動伝播により、各ルートの try/catch と
個別の 500 応答を 1 つのエラーハンドラへ集約する。リクエスト検証は
zod に委譲し、400 の判定を手書きの分岐から外す。"
```

---

### Task 10: DDL 適用と合成ルート

**Files:**
- Create: `src/server/infrastructure/ddl-runner.ts`, `src/server/main.ts`
- Test: なし（`ddl-runner` は Task 11 の統合テストで検証する。`main.ts` は配線のみで分岐を持たない）

**Interfaces:**
- Consumes: これまでの全モジュール
- Produces:
  - `function applySettingsDdl(db: Db, ddlDir: string): Promise<void>`

- [ ] **Step 1: 依存を追加する**

```bash
npm install close-with-grace
```

- [ ] **Step 2: ddl-runner.ts を実装する**

```ts
// ダッシュボード専用テーブルの DDL は ddl/ に外出しし、起動時に読み込んで実行する。
// データ収集側の devices / device_status_logs には触れず、device_settings だけを
// 自己管理する（利用者に手動マイグレーションを求めない）。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { Db } from './db/create-db.js';

export async function applySettingsDdl(db: Db, ddlDir: string): Promise<void> {
  const ddl = await readFile(join(ddlDir, 'device_settings.sql'), 'utf8');
  await sql.raw(ddl).execute(db);
}
```

- [ ] **Step 3: main.ts を実装する**

```ts
// 合成ルート。依存の生成と配線はここだけで行い、他の層は import で外界に触らない。

import { fileURLToPath } from 'node:url';
import closeWithGrace from 'close-with-grace';
import 'dotenv/config';

import { makeGetSensorData } from './application/get-sensor-data.js';
import { makeSetDevicePlacement } from './application/set-device-placement.js';
import { loadConfig } from './config.js';
import { createDb } from './infrastructure/db/create-db.js';
import { createDeviceRepository } from './infrastructure/db/device.repository.js';
import { createSensorLogRepository } from './infrastructure/db/sensor-log.repository.js';
import { applySettingsDdl } from './infrastructure/ddl-runner.js';
import { createLogger } from './infrastructure/logger.js';
import { createTotalsCache } from './infrastructure/totals-cache.js';
import { createApp } from './presentation/create-app.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel, config.nodeEnv !== 'production');

const { db, close: closeDb } = createDb(config.db);

const deviceRepository = createDeviceRepository(db);
const sensorLogRepository = createSensorLogRepository(db);
const totalsCache = createTotalsCache(config.totalsTtlMs);

const app = createApp({
  getSensorData: makeGetSensorData({
    devices: deviceRepository,
    logs: sensorLogRepository,
    totalsCache,
  }),
  setDevicePlacement: makeSetDevicePlacement({ devices: deviceRepository }),
  logger,
  staticDir: fileURLToPath(new URL('../public', import.meta.url)),
});

// 設置場所テーブルの用意を待ってから listen する。先に listen すると、
// テーブル作成完了前のリクエストで sensor-data の JOIN が失敗し得るため。
await applySettingsDdl(db, `${ROOT}ddl`);
logger.info('device_settings テーブルを確認');

const server = app.listen(config.port, () => {
  logger.info(`SwitchBot ダッシュボード起動: http://localhost:${config.port} (pid ${process.pid})`);
});

// PM2 の reload / stop（SIGINT・SIGTERM）と想定外の例外をまとめて捌く。
// HTTP を閉じ切ってから DB プールも解放する（残すとプロセスが終了しない）。
closeWithGrace({ delay: 10_000, logger }, async ({ err }) => {
  if (err) logger.error({ err }, '想定外のエラーで終了します');
  await new Promise<void>((resolve, reject) => {
    server.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
  });
  await closeDb();
  logger.info('全接続をクローズ、プロセス終了');
});
```

`main.ts` はトップレベル `await` を使うため、`tsconfig.json` の `module: NodeNext` と `"type": "module"` の組み合わせが前提になる（Task 1 で設定済み）。

- [ ] **Step 4: ビルドが通ることを確認する**

`package.json` の `scripts` に `build:server` を追加する。

```json
    "build:server": "tsc -p tsconfig.server.json",
```

Run: `npm run build:server && npm run lint && npm run typecheck && npm test`
Expected: すべて PASS。`dist/server/main.js` が生成される

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "DDL 適用と合成ルートを追加

依存の生成と配線を main.ts に集約する。graceful shutdown は
close-with-grace に委譲し、SIGINT / SIGTERM / 想定外の例外の登録を
1 箇所にまとめる。"
```

---

### Task 11: Testcontainers による Repository 統合テスト

実際の MySQL 8 に対して Repository の SQL を検証する。単体テストとは別コマンドに分け、遅い統合テストが日常の `npm test` を鈍くしないようにする。

**Files:**
- Create: `vitest.integration.config.ts`
- Create: `src/server/infrastructure/db/test-support.ts`
- Test: `src/server/infrastructure/db/repositories.integration.test.ts`

**Interfaces:**
- Consumes: `createDeviceRepository` / `createSensorLogRepository` / `applySettingsDdl` / `createDb`
- Produces:
  - `interface SeedRow { deviceId: number; minutesAgo: number; status: Record<string, unknown> }`
  - `interface TestMysql { db: Db; seedDevices(devices: { id: number; name: string; type: string; virtual?: boolean }[]): Promise<void>; seedLogs(rows: SeedRow[]): Promise<void>; truncate(): Promise<void>; stop(): Promise<void> }`
  - `async function startMysql(): Promise<TestMysql>`

- [ ] **Step 1: 依存を追加する**

```bash
npm install --save-dev @testcontainers/mysql testcontainers
```

- [ ] **Step 2: 統合テスト用の Vitest 設定を作る**

`vitest.integration.config.ts`:

```ts
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
```

`package.json` に追加:

```json
    "test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 3: test-support.ts を実装する**

```ts
// 統合テスト用の MySQL コンテナ。ddl/ の 3 ファイルをそのまま適用するので、
// 本番と同じスキーマ（索引を含む）に対して検証できる。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { sql } from 'kysely';
import { createDb, type Db } from './create-db.js';

const DDL_DIR = fileURLToPath(new URL('../../../../ddl/', import.meta.url));

export interface SeedRow {
  deviceId: number;
  /** 現在時刻から何分前の測定か（時間窓のテストで境界を作るのに使う） */
  minutesAgo: number;
  status: Record<string, unknown>;
}

export interface TestMysql {
  db: Db;
  seedDevices: (devices: { id: number; name: string; type: string; virtual?: boolean }[]) => Promise<void>;
  seedLogs: (rows: SeedRow[]) => Promise<void>;
  truncate: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startMysql(): Promise<TestMysql> {
  const container: StartedMySqlContainer = await new MySqlContainer('mysql:8.0')
    .withDatabase('switchbot_db')
    .withUsername('dash')
    .withUserPassword('dash')
    .start();

  const { db, close } = createDb({
    host: container.getHost(),
    port: container.getPort(),
    user: 'dash',
    password: 'dash',
    database: 'switchbot_db',
    poolLimit: 5,
  });

  for (const file of ['devices.sql', 'device_status_logs.sql', 'device_settings.sql']) {
    await sql.raw(await readFile(`${DDL_DIR}${file}`, 'utf8')).execute(db);
  }

  return {
    db,
    async seedDevices(devices) {
      await db.insertInto('devices').values(devices.map((d) => ({
        id: d.id,
        device_name: d.name,
        device_type: d.type,
        is_virtual_infrared: d.virtual ? 1 : 0,
      }))).execute();
    },
    async seedLogs(rows) {
      await db.insertInto('device_status_logs').values(rows.map((r) => ({
        device_id: r.deviceId,
        status_data: JSON.stringify(r.status),
        recorded_at: sql<Date>`DATE_SUB(NOW(), INTERVAL ${r.minutesAgo} MINUTE)`,
      }))).execute();
    },
    async truncate() {
      for (const table of ['device_status_logs', 'device_settings', 'devices'] as const) {
        await sql.raw(`TRUNCATE TABLE ${table}`).execute(db);
      }
    },
    async stop() {
      await close();
      await container.stop();
    },
  };
}
```

- [ ] **Step 4: 統合テストを書く**

`src/server/infrastructure/db/repositories.integration.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { sql } from 'kysely';
import { applySettingsDdl } from '../ddl-runner.js';
import { createDeviceRepository } from './device.repository.js';
import { createSensorLogRepository } from './sensor-log.repository.js';
import { startMysql, type TestMysql } from './test-support.js';
import { fileURLToPath } from 'node:url';

let mysql: TestMysql;

beforeAll(async () => { mysql = await startMysql(); });
afterAll(async () => { await mysql?.stop(); });

beforeEach(async () => {
  await mysql.truncate();
  await mysql.seedDevices([
    { id: 1, name: 'リビング', type: 'WoIOSensor' },
    { id: 2, name: '書斎', type: 'MeterPro(CO2)' },
    { id: 3, name: 'エアコン', type: 'Virtual', virtual: true },
  ]);
});

describe('DeviceRepository', () => {
  test('仮想赤外線デバイスを除いた一覧を id 順で返す', async () => {
    const devices = await createDeviceRepository(mysql.db).listSensorDevices();
    expect(devices.map((d) => d.id)).toEqual([1, 2]);
    expect(devices[0]).toEqual({ id: 1, name: 'リビング', type: 'WoIOSensor', placement: null });
  });

  test('設置場所を挿入し、二度目は更新する', async () => {
    const repo = createDeviceRepository(mysql.db);
    await repo.savePlacement(1, 'outdoor');
    expect((await repo.listSensorDevices())[0]!.placement).toBe('outdoor');

    await repo.savePlacement(1, 'indoor');
    expect((await repo.listSensorDevices())[0]!.placement).toBe('indoor');

    const rows = await mysql.db.selectFrom('device_settings').selectAll().execute();
    expect(rows).toHaveLength(1);   // 重複行を作らない
  });
});

describe('SensorLogRepository', () => {
  beforeEach(async () => {
    await mysql.seedLogs([
      { deviceId: 1, minutesAgo: 10,     status: { temperature: 24.9, humidity: 55 } },
      { deviceId: 1, minutesAgo: 100,    status: { temperature: 23.0, humidity: 57 } },   // 1h 窓の外
      { deviceId: 1, minutesAgo: 60 * 30, status: { temperature: 10.0, humidity: 70 } },  // 24h 窓の外
      { deviceId: 2, minutesAgo: 5,      status: { temperature: 22.0, humidity: 60, CO2: 718, battery: 88 } },
      { deviceId: 2, minutesAgo: 5,      status: {} },                                     // 温度なし → 除外
      { deviceId: 2, minutesAgo: 5,      status: { humidity: 60 } },                       // 温度なし → 除外
    ]);
  });

  test('1h の窓には直近 1 時間の測定だけが入る', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('1h', 0);
    expect(readings.map((r) => r.temperature)).toEqual([24.9, 22.0]);
  });

  test('24h の窓には 24 時間以内の測定が入る', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('24h', 0);
    expect(readings.filter((r) => r.deviceId === 1).map((r) => r.temperature)).toEqual([23.0, 24.9]);
  });

  test('offset=1 は 1 区間ぶん過去の窓を返す', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('1h', 1);
    expect(readings.map((r) => r.temperature)).toEqual([23.0]);   // 100 分前だけ
  });

  test("'all' は全期間を返し、offset を無視する", async () => {
    const repo = createSensorLogRepository(mysql.db);
    expect(await repo.listReadings('all', 0)).toHaveLength(4);
    expect(await repo.listReadings('all', 5)).toHaveLength(4);
  });

  test('device_id・recorded_at の昇順で返る', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('all', 0);
    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1]!, cur = readings[i]!;
      expect(cur.deviceId > prev.deviceId || (cur.deviceId === prev.deviceId && cur.ts >= prev.ts)).toBe(true);
    }
  });

  test('CO2 / battery を持つ行だけがその値を持つ', async () => {
    const readings = await createSensorLogRepository(mysql.db).listReadings('1h', 0);
    const study = readings.find((r) => r.deviceId === 2)!;
    expect(study.co2).toBe(718);
    expect(study.battery).toBe(88);
    const living = readings.find((r) => r.deviceId === 1)!;
    expect('co2' in living).toBe(false);
  });

  test('総件数は窓に依存せず、窓クエリと同じフィルタで数える', async () => {
    const totals = await createSensorLogRepository(mysql.db).countByDevice();
    expect(totals.get(1)).toBe(3);   // 温度を持つ 3 行すべて
    expect(totals.get(2)).toBe(1);   // 温度なしの 2 行は除外
  });

  test('窓クエリが idx_device_recorded を使う', async () => {
    const plan = await sql<{ key: string | null }>`
      EXPLAIN SELECT l.device_id FROM device_status_logs l
       WHERE l.recorded_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY l.device_id, l.recorded_at
    `.execute(mysql.db);
    expect(plan.rows[0]!.key).toBe('idx_device_recorded');
  });
});

describe('applySettingsDdl', () => {
  test('二度実行してもエラーにならない（冪等）', async () => {
    const ddlDir = fileURLToPath(new URL('../../../../ddl', import.meta.url));
    await applySettingsDdl(mysql.db, ddlDir);
    await expect(applySettingsDdl(mysql.db, ddlDir)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: 統合テストを実行する**

Run: `npm run test:integration`
Expected: PASS（初回は MySQL イメージの取得に数分かかる）

`EXPLAIN` の `key` が `idx_device_recorded` にならない場合は、テストデータが少なすぎて MySQL がフルスキャンを選んでいる可能性がある。その場合は `FORCE INDEX` ではなく、シードするログ行を 5,000 行程度に増やして再確認する。それでも索引が使われない場合は、その事実を `docs/db-performance.md` に追記したうえでテストを「索引が存在すること」の確認（`SHOW INDEX FROM device_status_logs`）に置き換える。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "Testcontainers による Repository の統合テストを追加

ddl/ の 3 ファイルをそのまま適用した MySQL 8 に対して、時間窓の境界・
総件数とのフィルタ一致・placement の upsert・DDL の冪等性を検証する。
単体テストとは別コマンドに分け、日常の npm test は高速に保つ。"
```

---

### Task 12: 旧実装のカットオーバー

新しい実装へ切り替え、旧ファイルを削除し、層の境界チェックを有効化する。

**Files:**
- Delete: `server.cjs`, `lib/db.cjs`, `lib/downsample.cjs`, `lib/logger.cjs`, `lib/placement.cjs`, `lib/ranges.cjs`, `lib/transform.cjs`
- Delete: `test/ranges.test.cjs`, `test/transform.test.cjs`, `test/placement.test.cjs`, `test/downsample.test.cjs`
- Create: `scripts/seed-verify.sql`（旧新の突き合わせ用シード。移行後もスキーマ変更時の手動確認に使う）
- Modify: `package.json`, `eslint.config.js`, `ecosystem.config.cjs`, `.gitignore`, `.env.example`, `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: すべて
- Produces: なし

**注意:** `public/` と `test/clothing.test.mjs` / `test/format.test.mjs` / `test/share.test.mjs` はフロントエンドのフェーズで扱うため、このタスクでは残す。`main.ts` の `staticDir` は暫定的にリポジトリ直下の `public/` を指す。

- [ ] **Step 1: 旧実装との JSON 一致を確認する**

統合テスト用の MySQL コンテナに同じデータを入れ、旧 `server.js` と新 `dist/server/main.js` の両方に同じリクエストを投げてレスポンスを突き合わせる。

まず検証用のシードを 1 ファイルにまとめる。`scripts/seed-verify.sql`（このファイルはコミットする。移行後もスキーマ変更時の手動確認に使える）:

```sql
-- 旧新の JSON 突き合わせ用のシード。ddl/ を適用したあとに実行する。
INSERT INTO devices (id, device_name, device_type, is_virtual_infrared) VALUES
  (1, 'リビング', 'WoIOSensor',    0),
  (2, '書斎',     'MeterPro(CO2)', 0),
  (3, 'エアコン', 'Virtual',       1),
  (4, '物置',     NULL,            0);   -- device_type が NULL のデバイス

-- 1 分刻みで 3 日ぶんの測定を作る（24h の窓境界と offset の両方を跨がせる）。
INSERT INTO device_status_logs (device_id, status_data, recorded_at)
SELECT
  d.id,
  CASE d.id
    WHEN 1 THEN JSON_OBJECT('temperature', 20 + (n.i % 100) / 10, 'humidity', 50 + (n.i % 20), 'battery', 88)
    WHEN 2 THEN JSON_OBJECT('temperature', 22 + (n.i % 50) / 10, 'humidity', 60, 'CO2', 700 + (n.i % 300))
    ELSE JSON_OBJECT('temperature', 15 + (n.i % 30) / 10, 'humidity', 40)
  END,
  DATE_SUB(NOW(), INTERVAL n.i MINUTE)
FROM devices d
CROSS JOIN (
  SELECT a.i + b.i * 10 + c.i * 100 + e.i * 1000 AS i
  FROM (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a
  CROSS JOIN (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b
  CROSS JOIN (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) c
  CROSS JOIN (SELECT 0 i UNION SELECT 1 UNION SELECT 2 UNION SELECT 3) e
) n
WHERE d.is_virtual_infrared = 0;

-- フィルタで除外されるべき行（温度なし・空 JSON）も混ぜる。
INSERT INTO device_status_logs (device_id, status_data, recorded_at) VALUES
  (1, JSON_OBJECT('humidity', 55), NOW()),
  (1, JSON_OBJECT(),               NOW());

-- 設置場所を明示的に持つデバイスと、持たないデバイスの両方を作る。
INSERT INTO device_settings (device_id, placement) VALUES (2, 'outdoor');
```

```bash
# 1) MySQL コンテナを起動する
docker run -d --name switchbot-verify -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=switchbot_db -e MYSQL_USER=dash -e MYSQL_PASSWORD=dash \
  -p 13306:3306 mysql:8.0

# 起動完了を待つ
until docker exec switchbot-verify mysqladmin ping -h127.0.0.1 --silent; do sleep 2; done

# 2) ddl/ とシードを適用する
for f in ddl/devices.sql ddl/device_status_logs.sql ddl/device_settings.sql scripts/seed-verify.sql; do
  docker exec -i switchbot-verify mysql -udash -pdash switchbot_db < "$f"
done

# 3) 旧実装で取得（Task 1 で .cjs へリネーム済み）
DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=dash DB_PASSWORD=dash DB_NAME=switchbot_db \
  PORT=3001 node server.cjs &
sleep 2
for r in 1h 24h 1w all; do
  curl -s "http://localhost:3001/api/sensor-data?range=$r&offset=0" > "/tmp/old-$r.json"
  curl -s "http://localhost:3001/api/sensor-data?range=$r&offset=1" > "/tmp/old-$r-p1.json"
done
kill %1

# 4) 新実装で取得
npm run build:server
DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=dash DB_PASSWORD=dash DB_NAME=switchbot_db \
  PORT=3002 node dist/server/main.js &
sleep 2
for r in 1h 24h 1w all; do
  curl -s "http://localhost:3002/api/sensor-data?range=$r&offset=0" > "/tmp/new-$r.json"
  curl -s "http://localhost:3002/api/sensor-data?range=$r&offset=1" > "/tmp/new-$r-p1.json"
done
kill %1

# 5) 突き合わせ（差分が出ないこと）
for f in /tmp/old-*.json; do diff "$f" "${f/old/new}" || echo "差分あり: $f"; done

# 6) placement 更新も突き合わせる（成功・不正値・不正 id の 3 系統）
#    ※ 旧実装を 3001、新実装を 3002 で同時に起動して実行する
for port in 3001 3002; do
  curl -s -X PUT -H 'Content-Type: application/json' -d '{"placement":"outdoor"}' \
    "http://localhost:$port/api/devices/1/placement" > "/tmp/pl-ok-$port.json"
  curl -s -o "/tmp/pl-ng-$port.json" -w '%{http_code}\n' -X PUT -H 'Content-Type: application/json' \
    -d '{"placement":"garden"}' "http://localhost:$port/api/devices/1/placement" > "/tmp/pl-ng-code-$port.txt"
  curl -s -o "/tmp/pl-id-$port.json" -w '%{http_code}\n' -X PUT -H 'Content-Type: application/json' \
    -d '{"placement":"indoor"}' "http://localhost:$port/api/devices/abc/placement" > "/tmp/pl-id-code-$port.txt"
done
diff /tmp/pl-ok-3001.json /tmp/pl-ok-3002.json
diff /tmp/pl-ng-code-3001.txt /tmp/pl-ng-code-3002.txt
diff /tmp/pl-id-code-3001.txt /tmp/pl-id-code-3002.txt
```

Expected: すべて差分なし。差分が出た場合は先に原因を直し、このステップをやり直す。

検証が終わったらコンテナを片付ける。

```bash
docker rm -f switchbot-verify
```

- [ ] **Step 2: 旧ファイルを削除する**

```bash
git rm server.cjs lib/db.cjs lib/downsample.cjs lib/logger.cjs lib/placement.cjs lib/ranges.cjs lib/transform.cjs
git rm test/ranges.test.cjs test/transform.test.cjs test/placement.test.cjs test/downsample.test.cjs
```

`lib/` ディレクトリは空になるので消える。`test/` には `clothing.test.mjs` /
`format.test.mjs` / `share.test.mjs` が残る（フロントエンドのフェーズで移植する）。

- [ ] **Step 3: package.json を更新する**

```json
  "scripts": {
    "start": "node dist/server/main.js",
    "dev": "tsx watch src/server/main.ts",
    "build": "npm run build:server",
    "build:server": "tsc -p tsconfig.server.json",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.server.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "pm2:start": "pm2 start ecosystem.config.cjs",
    "pm2:reload": "pm2 reload ecosystem.config.cjs",
    "pm2:stop": "pm2 stop ecosystem.config.cjs",
    "pm2:logs": "pm2 logs switchbot-dashboard"
  },
```

`tsx` を devDependencies へ追加する。

```bash
npm install --save-dev tsx
```

- [ ] **Step 4: ecosystem.config.cjs の起動スクリプトを変更する**

```js
      script: 'dist/server/main.js',
```

同ファイルのコメント「PM2 がログ各行にタイムスタンプを付与（logger 側は二重を避けて自前分を省く）」はそのまま有効なので残す。

- [ ] **Step 5: .gitignore に dist/ を追加する**

```
dist/
```

- [ ] **Step 6: .env.example に新しい変数を追記する**

```
DB_HOST=192.168.150.222
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=switchbot_db

# 任意（既定値あり）
PORT=3000
DB_POOL_LIMIT=10
TOTALS_TTL_MS=60000
LOG_LEVEL=info
```

- [ ] **Step 7: eslint.config.js から旧 JS の設定を外し、層の境界チェックを有効にする**

```js
// ESLint v9 フラット設定。
// TypeScript のバックエンドと、まだ素の ESM が残るフロントエンドが併存する。
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default [
  { ignores: ['node_modules/**', 'dist/**'] },

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
      'boundaries/elements': [
        { type: 'shared',         pattern: 'src/shared/*' },
        { type: 'domain',         pattern: 'src/server/domain/*' },
        { type: 'application',    pattern: 'src/server/application/*' },
        { type: 'infrastructure', pattern: 'src/server/infrastructure/**/*' },
        { type: 'presentation',   pattern: 'src/server/presentation/**/*' },
        { type: 'config',         pattern: 'src/server/config.ts' },
        { type: 'main',           pattern: 'src/server/main.ts' },
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
          { from: 'main',           allow: ['main', 'presentation', 'application', 'infrastructure', 'domain', 'shared', 'config'] },
        ],
      }],
    },
  },
];
```

`presentation` は `Logger` 型を `application/ports.js` から取っているため（Task 7・Task 9 で対応済み）、`presentation → infrastructure` の逆向き import は発生しない。lint がそれ以外の境界違反を報告した場合は、**依存の向きを直す**（許可ルールを緩めない）。

- [ ] **Step 8: CI を更新する**

`.github/workflows/ci.yml`:

```yaml
name: CI

# main への push と、すべての Pull Request で検査を実行する。
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: npm
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: npm
      - run: npm ci
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        # package.json の engines（>=20）に合わせ、現行 LTS を検証する。
        node-version: ['20.x', '22.x']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: npm
      - run: npm ci
      # Testcontainers が MySQL 8 を起動する。ubuntu-latest には Docker が入っている。
      - run: npm run test:integration

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: npm
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 9: README を更新する**

次の箇所を書き換える。

1. 「動作要件」に `Node.js 20 以上` はそのまま。ビルドが必要になった旨を「起動」節に追記する:

```markdown
## 起動

```bash
npm run build   # TypeScript をビルド（dist/ に出力）
npm start       # dist/server/main.js を起動
```

開発中は `npm run dev`（`tsx watch`）でビルド無しに再起動できます。
```

2. 「環境変数」の表に `PORT` / `DB_POOL_LIMIT` / `TOTALS_TTL_MS` / `LOG_LEVEL` を追加する
3. 「テスト」節を Vitest と統合テストの説明に置き換える:

```markdown
## テスト

Vitest で実行します。

```bash
npm test              # 単体テスト（高速）
npm run test:integration  # Testcontainers で MySQL 8 を起動する統合テスト（Docker が必要）
```
```

4. 「ディレクトリ構成」を新しい `src/` の構成に差し替える（spec の §4.2 の図をそのまま使う）
5. 「クリーンアーキテクチャ」節を新設し、依存の向きと ESLint による強制を 3 行で説明する

- [ ] **Step 10: すべての検査を通す**

Run: `npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build`
Expected: すべて PASS

- [ ] **Step 11: 実際に起動して動作を確認する**

Step 1 で立てた MySQL コンテナに向けて起動し、ブラウザで開く。

```bash
npm run build && npm start
```

Expected: `http://localhost:3000` でダッシュボードが表示され、範囲切替・ページング・設置場所トグルが移行前と同じように動く

- [ ] **Step 12: コミット**

```bash
git add -A
git commit -m "旧バックエンド実装を削除し TypeScript 実装へ切り替える

server.cjs と lib/ を削除し、npm start を dist/server/main.js に向ける。
ESLint に層の境界チェックを追加し、依存の向きの違反をエラーにする。
CI に typecheck / integration / build のジョブを足す。"
```

---

## 完了条件

- [ ] `npm run lint` が通る（層の境界チェックを含む）
- [ ] `npm run typecheck` が通る
- [ ] `npm test` が通る
- [ ] `npm run test:integration` が通る
- [ ] `npm run build` が通り、`npm start` でアプリが起動する
- [ ] 同一データに対する `GET /api/sensor-data` のレスポンス JSON が移行前後で完全一致する（Task 12 Step 1）
- [ ] `PUT /api/devices/:id/placement` の成功・失敗時の挙動が移行前後で一致する
- [ ] `src/server/main.ts` を読むだけでアプリ全体の依存関係が把握できる
- [ ] `server.js` と `lib/` が削除されている

## 次のフェーズ

フロントエンドの React 化（spec のフェーズ 3・4）は別計画 `docs/superpowers/plans/2026-XX-XX-frontend-react.md` で扱う。このフェーズの完了後に作成する。残る作業:

- `public/js/` の React + Vite への移行
- `public/css/style.css` の `src/client/styles/` への移設
- `test/clothing.test.mjs` / `format.test.mjs` / `share.test.mjs` の `src/client/domain/` への移植
- spec §9 のバグ 1・2（`deviceIcon` の NULL 例外、モーダルの keydown リスナーリーク）の修正
- `main.ts` の `staticDir` を `dist/public` へ変更
- README のディレクトリ構成の最終更新
