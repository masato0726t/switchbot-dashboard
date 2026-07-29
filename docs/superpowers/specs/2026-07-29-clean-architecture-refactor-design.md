# クリーンアーキテクチャ移行 + TypeScript 化 設計

- 日付: 2026-07-29
- 対象: switchbot-dashboard 全体（バックエンド・フロントエンド・テスト・ビルド）

## 1. 背景と目的

現状のコードは動作しており、コメントも手厚い。一方で以下が読み手の負担になっている。

- `server.js`（194 行）に設定・SQL・キャッシュ・ルーティング・DDL 投入・graceful shutdown が同居している
- `lib/` が純粋ロジック（ranges / transform / placement / downsample）とインフラ（db / logger）を区別なくフラットに並べている
- `public/js/device.js` の `initDevice` / `updateDevice` / `clearDashboard` が「初期描画の DOM 構造」と「更新時の差分適用」の 2 つの真実を持ち、読み手が頭の中で突き合わせる必要がある
- `lib/ranges.js` の `windowClause` が SQL 文字列とバインド値の組を返し、呼び出し側でテンプレート補完している。安全性がコメントの規律だけで保たれている

目的は次の 3 点。

1. **クリーンアーキテクチャの採用** — 依存の向きを一方向に固定し、機械的に強制する
2. **フレームワーク・ライブラリの活用** — 手書きの定型処理をライブラリに委譲する
3. **認知負荷の低減** — 1 つの事実が 1 箇所にある状態にする

**機能追加・機能削除は行わない。** API レスポンスの JSON 形状と画面の見た目・挙動は現行と同一を保つ。

## 2. スコープ

### 対象

- バックエンドの層分離と TypeScript 化
- フロントエンドの React 化と TypeScript 化
- テストランナーの統一（node:test → Vitest）と統合テストの追加
- ビルド・デプロイ・CI の整備
- ドキュメント（README / docs）の更新

### 非対象

- 新機能の追加
- API の互換性を破る変更
- `devices` / `device_status_logs`（データ収集側が管理）のスキーマ変更
- CSS の再設計（`public/css/style.css` はクラス名を維持したまま移設のみ）

## 3. 決定事項

| 項目 | 決定 | 根拠 |
|---|---|---|
| 言語 | TypeScript | 層の境界（Port / Adapter）を型で表現できる |
| BE フレームワーク | Express 5 を維持 + 手動 DI | 2 エンドポイントのアプリに DI コンテナは過剰。合成ルートを 1 ファイルに置けば依存の向きがソースを追うだけで分かる |
| データアクセス | Kysely | SQL 文字列連結を式の合成に置き換えられる。マイグレーション機構を強制しないので `ddl/` の運用がそのまま残る |
| FE フレームワーク | React + Vite | react-chartjs-2 / TanStack Query が揃っており、手動 DOM 同期を丸ごと削除できる |
| テストランナー | Vitest | BE の純粋ロジックと FE の TSX を 1 つのランナーで実行できる |
| 統合テスト | Testcontainers (MySQL) | Repository の SQL を実際の MySQL で検証する。Docker が利用可能 |

## 4. アーキテクチャ

### 4.1 依存規則

```
presentation ──▶ application ──▶ domain ◀── infrastructure
                      │                          │
                      └────── ports (interface) ─┘
```

- `domain` は何にも依存しない（Node の標準 API すら使わない純粋な関数と型のみ）
- `application` は `domain` と `ports.ts` のインターフェースにのみ依存する
- `infrastructure` は `ports.ts` のインターフェースを実装する。外界（MySQL・ファイル・ログ出力）に触れるのはこの層だけ
- `presentation` は `application` のユースケースにのみ依存する
- 配線は `main.ts`（合成ルート）でのみ行う

この規則は `eslint-plugin-boundaries` で強制する。違反は lint エラーになるので、レビューで人間が見張る必要がない。

### 4.2 ディレクトリ構成

```
src/
├── shared/
│   ├── api-contract.ts              FE/BE 共有の API 契約（zod スキーマ + 推論型）
│   └── ranges.ts                    表示範囲の定義（キー・期間・日本語ラベル）
│
├── server/
│   ├── domain/                      依存ゼロ
│   │   ├── placement.ts             Placement 型 / defaultPlacement / isValidPlacement
│   │   ├── range.ts                 resolveRange / resolveOffset（範囲表は shared/ranges.ts）
│   │   ├── sensor.ts                DeviceInfo / Reading / DeviceSeries の型
│   │   ├── downsample.ts            lttb
│   │   └── build-series.ts          devices + readings + totals → DeviceSeries[]
│   ├── application/
│   │   ├── ports.ts                 DeviceRepository / SensorLogRepository / TotalsCache
│   │   ├── get-sensor-data.ts
│   │   └── set-device-placement.ts
│   ├── infrastructure/
│   │   ├── db/
│   │   │   ├── schema.ts            Kysely の Database インターフェース
│   │   │   ├── create-db.ts         mysql2 プール + MysqlDialect
│   │   │   ├── window.ts            RangeKey + offset → SQL 式（NOW() 基準）
│   │   │   ├── device.repository.ts
│   │   │   └── sensor-log.repository.ts
│   │   ├── ddl-runner.ts            ddl/device_settings.sql の適用
│   │   ├── totals-cache.ts          lru-cache による TotalsCache 実装
│   │   └── logger.ts                pino
│   ├── presentation/
│   │   ├── dto.ts                   DeviceSeries → API JSON（JST 整形はここ）
│   │   ├── routes/sensor-data.ts
│   │   ├── routes/placement.ts
│   │   ├── error-handler.ts
│   │   └── create-app.ts
│   ├── config.ts                    zod による環境変数の検証
│   └── main.ts                      合成ルート + 起動 + shutdown
│
└── client/
    ├── domain/                      純粋。DOM もネットワークも触らない
    │   ├── clothing.ts              体感温度 → 服装提案（室内 THI / 屋外 Heat Index）
    │   ├── format.ts                deviceIcon / latest / formatTimeLabel
    │   ├── share-text.ts            buildShareText / normalizeDomain
    │   └── metrics.ts               METRICS 定義
    ├── config.ts                    REFRESH_SEC / DEFAULT_INSTANCES / 共有先の定義
    ├── api/
    │   ├── client.ts                fetch + api-contract によるレスポンス検証
    │   └── queries.ts               useSensorData / useSetPlacement
    ├── state/
    │   └── use-view-range.ts        range / offset の状態
    ├── hooks/
    │   └── use-flash.ts             値変化時のフラッシュ演出
    ├── components/
    │   ├── App.tsx
    │   ├── RangeBar.tsx / NavBar.tsx
    │   ├── DeviceSection.tsx / DeviceHeader.tsx / StatsRow.tsx / StatCard.tsx
    │   ├── MetricChart.tsx
    │   ├── ClothingLine.tsx / PlacementToggle.tsx
    │   └── share/ShareButtons.tsx / share/InstancePicker.tsx
    ├── styles/style.css
    ├── index.html
    └── main.tsx
```

`ddl/` は現在の位置・内容のまま残す。

### 4.3 各層の責務

**domain** — 業務ルールと型。`build-series.ts` は「デバイス一覧と生の測定値から、デバイス別時系列を組み立て、点数超過なら LTTB で間引く」という規則そのもの。JST 文字列の整形は表示の都合なので domain には置かない（現行 `lib/transform.js` は `time` の整形を含んでいるが、これを presentation へ移す）。

**application** — ユースケース。`get-sensor-data.ts` は「デバイス一覧を取り、総件数を（キャッシュ経由で）取り、窓内のログを取り、時系列を組み立てて返す」という手順だけを書く。SQL も HTTP も知らない。

**infrastructure** — Port の実装。SQL・JSON パース・接続プール・ログ出力・DDL 適用。`status_data`（JSON 列）から `Reading` への変換はここで行う。

**presentation** — HTTP。zod によるリクエスト検証、ドメイン型から API DTO への変換（`ts` / `time` の生成を含む）、エラーの HTTP ステータスへの写像。

## 5. 導入ライブラリ

### バックエンド

| ライブラリ | 用途 | 置き換わる現行コード |
|---|---|---|
| `kysely` | 型安全なクエリ構築 | `windowClause` の文字列 + バインド値、`SENSOR_LOG_FILTER` のテンプレート補完 |
| `zod` | 環境変数・リクエストの検証 | `Number.isInteger` / `isValidPlacement` の手書き分岐、`process.env` の散在 |
| `pino` / `pino-http` | 構造化ログ・アクセスログ | `lib/logger.js` 全体、アクセスログ用ミドルウェア |
| `lru-cache` | 総件数の TTL キャッシュ | `totalsCache` グローバル変数と TTL 判定 |
| `close-with-grace` | 終了シグナルの一括処理 | `shutdown()` と 4 つの `process.on` |
| `http-errors` | HTTP エラーの表現 | 各ルートの `res.status(...).json({ error })` |

Express 5 は Promise を返すハンドラの reject をエラーミドルウェアへ自動伝播するため、全ルートの `try/catch` を削除する。

### フロントエンド

| ライブラリ | 用途 | 置き換わる現行コード |
|---|---|---|
| `react` / `react-dom` | 宣言的 UI | `registry` Map、`initDevice` / `updateDevice` / `clearDashboard`、`innerHTML` 文字列テンプレート、`getElementById` の ID 文字列結合 |
| `vite` | 開発サーバ・バンドル | CDN `<script>` 直読み |
| `@tanstack/react-query` | 取得・ポーリング・状態管理 | `setInterval` + `remaining` カウンタ、`loading` / `error-msg` の `style.display` 直操作、`reload()` |
| `chart.js` / `react-chartjs-2` | グラフ | UMD グローバル `Chart`、`chart.$fullTimes` への独自プロパティ付与、`chart.destroy()` の手動管理 |

### 開発・テスト

`typescript`, `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom`, `@testcontainers/mysql`, `typescript-eslint`, `eslint-plugin-boundaries`, `eslint-plugin-react-hooks`, `tsx`

## 6. API 契約

**現行と完全に同一の JSON を返す。** これが「壊れていないこと」の判定基準になる。

`src/shared/api-contract.ts` に zod スキーマを 1 箇所だけ定義し、サーバーはレスポンス生成時、クライアントは受信時に同じスキーマを使う。型は `z.infer` で導出するので二重定義しない。

```ts
export const SensorPointSchema = z.object({
  ts: z.number(),
  time: z.string(),
  temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  co2: z.number().optional(),
  battery: z.number().optional(),
});

export const DeviceSeriesSchema = z.object({
  device_id: z.number(),
  name: z.string().nullable(),
  type: z.string().nullable(),
  placement: z.enum(['indoor', 'outdoor']),
  total: z.number(),
  downsampled: z.boolean(),
  data: z.array(SensorPointSchema),
});
```

`GET /api/sensor-data` のクエリ（`range` / `offset`）は未知の値をデフォルト（`24h` / `0`）へ丸める現行挙動を維持する（400 にはしない）。`PUT /api/devices/:id/placement` は不正値で 400 を返す現行挙動を維持する。

## 7. データアクセス設計

### 7.1 時間窓を DB の `NOW()` 基準のまま残す

現行は `DATE_SUB(NOW(), INTERVAL ? HOUR)` で **DB サーバーの時計**を基準にしている。アプリ側で `Date` を計算する構成に変えると、DB が別ホスト（`.env.example` の既定は `192.168.150.222`）である以上、時計ずれという新しい障害要因が増える。また `INTERVAL 1 MONTH` の月末クランプ挙動を JS 側で再現する必要も生じる。

そこで **domain は「窓の仕様（range + offset）」だけを持ち、絶対時刻への変換は infrastructure が `NOW()` 基準で行う**。domain は純粋なまま、挙動は 1 ミリも変わらず、危険な文字列連結だけが消える。

```ts
// infrastructure/db/window.ts
// unit は RANGE_SPECS 由来の固定文字列、count は必ずバインドする
const ago = (count: number, unit: IntervalUnit) =>
  sql<Date>`DATE_SUB(NOW(), INTERVAL ${count} ${sql.raw(unit)})`;
```

窓を「付ける / 付けない」「上限も付ける / 付けない」の分岐は Kysely の `.$if()` で表現し、SQL 断片の連結は行わない。

### 7.2 表示範囲の定義を 1 箇所にする

現在は `lib/ranges.js` の `RANGE_SPECS`（サーバー）と `public/js/config.js` の `RANGES`（クライアント）が同じ範囲リストを二重に持ち、「サーバー側 RANGE_SPECS と対応」というコメントで手動同期を約束している。

これを `src/shared/ranges.ts` に統合する。キー・期間の数量・MySQL の INTERVAL 単位・日本語ラベル・ページング可否を 1 つのテーブルで持ち、サーバーは SQL 生成に、クライアントは範囲バーと窓ラベルの生成に使う。範囲を 1 つ増やすときに触る場所が 1 箇所になる。

### 7.3 センサー行フィルタ

`JSON_LENGTH(status_data) > 0 AND JSON_EXTRACT(status_data, '$.temperature') IS NOT NULL` は総件数クエリと窓クエリの両方で使う必要がある（件数の整合のため）。これを Kysely の式ファクトリとして 1 箇所に定義し、両方から呼ぶ。現行はコメントで整合を約束していたが、式の共有で構造的に保証される。

### 7.4 総件数キャッシュ

`lru-cache` の `ttl` に委譲する。TTL は `TOTALS_TTL_MS`（既定 60,000ms）で従来どおり設定可能。`TotalsCache` は application の Port として定義し、ユースケースはキャッシュの実装を知らない。

## 8. フロントエンド設計

### 8.1 手動 DOM 同期の削除

現行の `updateDevice` は、統計カード・バッテリータグ・件数・全件数・服装提案をそれぞれ `getElementById` で引いて条件付きで書き換える。React では `DeviceSection` が props から見た目を返すだけになり、差分適用は React に任せる。

フラッシュ演出（新データ到着時のアニメーション再生）だけは DOM の都合が残る。`useFlash` フックに閉じ込め、`void el.offsetWidth` でリフローを強制している理由をコメントで残す。

### 8.2 自動更新

TanStack Query の `refetchInterval` に、ライブ表示（`offset === 0`）のときだけ 30 秒を渡す。履歴表示中は `false` を渡す。現行の `if (!isLive()) return;` という分岐と `remaining` カウンタが不要になる。

範囲・オフセットは `queryKey` の一部にする。切り替えると自然に再取得され、`reload()` の明示呼び出しが消える。

### 8.3 チャート

`react-chartjs-2` の `<Line>` に data / options を渡す。ツールチップ用のフル日時は現行では `chart.$fullTimes` としてインスタンスに生やしているが、React ではクロージャで `options.plugins.tooltip.callbacks.title` に渡せる。`chart.destroy()` の手動管理も不要になる。

### 8.4 CSS

`public/css/style.css` は `src/client/styles/style.css` へ移設し、`main.tsx` から import する。クラス名は変更しない（見た目の差分を出さないため）。

## 9. 既存バグの修正

移行に伴い次の 3 件を修正する。いずれも現行コードに存在する不具合で、修正しても外部挙動の互換性は損なわれない。

1. **`deviceIcon(type)` の NULL 例外** — `public/js/format.js` が `type.includes()` を NULL チェックなしで呼んでいる。`devices.device_type` は `VARCHAR(255)` で NULL 許容、かつ `device.js` 側は `${type || 'N/A'}` と NULL を想定しており認識が食い違っている。`type` を `string | null` として扱い、NULL 時は既定アイコンを返す
2. **モーダルの keydown リスナーリーク** — `public/js/share.js` の `openInstancePicker` は Escape 以外の閉じ方（キャンセル / 背景クリック / インスタンス選択）で `document` の `keydown` リスナーを解除しない。React 化で `useEffect` のクリーンアップにより構造的に解消する
3. **初回更新時の無駄な DOM 書き換え** — `initDevice` が `el.dataset.raw` を設定しないため、初回の `updateDevice` で必ず書き換えが走る。React 化で該当ロジックごと消える

## 10. テスト戦略

### 10.1 単体テスト（Vitest, 高速）

既存 7 ファイルのテストケースを **1 件も減らさず** 移植する。

| 現行 | 移行先 |
|---|---|
| `test/ranges.test.js` | `src/server/domain/range.test.ts`（丸め込み）+ `src/server/infrastructure/db/window.test.ts`（窓の SQL 生成） |
| `test/transform.test.js` | `src/server/domain/build-series.test.ts` + `src/server/presentation/dto.test.ts` |
| `test/placement.test.js` | `src/server/domain/placement.test.ts` |
| `test/downsample.test.js` | `src/server/domain/downsample.test.ts` |
| `test/clothing.test.mjs` | `src/client/domain/clothing.test.ts` |
| `test/format.test.mjs` | `src/client/domain/format.test.ts` |
| `test/share.test.mjs` | `src/client/domain/share-text.test.ts` |

`transform.test.js` は `time` の JST 整形も検証しているため、domain 側（時系列組み立て）と presentation 側（DTO 整形）に分割する。分割後も検証内容の合計は減らさない。

追加する単体テスト:

- `config.ts` の zod スキーマ（必須変数の欠落で起動失敗すること）
- ユースケース（`get-sensor-data`）をフェイク Repository で検証
- `DeviceSection` / `StatsRow` の描画（@testing-library/react）
- `useViewRange` の遷移（範囲変更で offset が 0 に戻ること）

### 10.2 統合テスト（Vitest + Testcontainers, 低速）

`npm run test:integration` として単体テストと分離する。MySQL 8 のコンテナを起動し、`ddl/` の 3 ファイルを適用してから検証する。

- `sensor-log.repository` が生成する SQL が期待どおりの行を返すこと（時間窓の境界値、`all` の全期間、`offset` によるページング）
- 総件数クエリと窓クエリのフィルタ条件が一致していること
- `device.repository` の placement upsert が挿入・更新の両方で機能すること
- `ddl-runner` が冪等であること（2 回実行してもエラーにならない）

### 10.3 移行の回帰検証

各フェーズ完了時に、旧実装と新実装へ同一クエリを投げてレスポンス JSON が完全一致することを確認する（Testcontainers の同一データセットに対して実行）。

### 10.4 インフラの除外方針

`logger` は現行どおりテスト対象外とする。

## 11. ビルドとデプロイ

```
npm run dev              vite dev（/api を :3000 へ proxy）+ tsx watch src/server/main.ts
npm run build            tsc -p tsconfig.server.json（→ dist/server）+ vite build（→ dist/public）
npm start                node dist/server/main.js
npm run typecheck        tsc --noEmit（server / client 両方）
npm run lint             eslint（依存の向きの検査を含む）
npm test                 vitest run（単体のみ）
npm run test:integration vitest run --config vitest.integration.config.ts
```

- Express は `dist/public` を静的配信する（現 `public/` と同じ役割）
- **`ecosystem.config.js` の `script` を `server.js` → `dist/server/main.js` へ変更する**
- デプロイ手順に `npm run build` が 1 ステップ増える。README に明記する
- `dist/` は `.gitignore` に追加する

## 12. CI

`.github/workflows/ci.yml` のジョブ構成:

| ジョブ | 内容 |
|---|---|
| `lint` | ESLint（依存の向きの検査を含む） |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest 単体テスト（Node 20 / 22 のマトリクス） |
| `integration` | Testcontainers による統合テスト（Node 22 のみ） |
| `build` | `npm run build` が通ること |

`engines` は `>=20` を維持する。

## 13. 移行フェーズ

各フェーズの終了時点で `lint` / `typecheck` / `test` / `build` が全て緑になる順序で進める。壊れたときの切り分け範囲を 1 フェーズ内に限定するため。

**フェーズ 1: ビルド基盤**
TypeScript / Vite / Vitest / ESLint(TS) を導入する。既存コードは `.js` のまま動く状態を維持し、テストだけ Vitest へ移す。この時点でアプリの挙動は変わらない。

**フェーズ 2: バックエンド**
`src/server/` へ層分離しつつ TypeScript 化する。Kysely / zod / pino / lru-cache / close-with-grace / http-errors を導入する。API レスポンスは変えない。Repository の統合テストをここで書く。

**フェーズ 3: フロントエンド**
`src/client/` へ React 化する。TanStack Query / react-chartjs-2 を導入する。CSS はクラス名を維持したまま移設する。第 9 章のバグ 1・2 をここで修正する。

**フェーズ 4: 仕上げ**
`ecosystem.config.js` の更新、README・`docs/db-performance.md` の更新、旧ファイル（`server.js` / `lib/` / `public/js/` / `test/`）の削除、CI の最終形。

## 14. リスクと対策

| リスク | 対策 |
|---|---|
| Kysely が生成する SQL が現行と異なり、`idx_device_recorded` が効かなくなる | 統合テストで `EXPLAIN` を検証し、索引が使われていることを確認する |
| API レスポンスの形状が微妙に変わる（`co2` / `battery` の省略条件、`null` の扱い） | zod スキーマを契約として固定し、旧新のレスポンス JSON を同一データで突き合わせる |
| React 化で見た目が変わる | CSS のクラス名を変更しない。DOM 構造も現行の階層を踏襲する |
| ビルド工程の追加でデプロイ手順が壊れる | フェーズ 4 で README と `ecosystem.config.js` を同時に更新し、`npm run build && npm start` を実際に通す |
| Testcontainers が CI で不安定 | 単体テストと分離し、統合テストの失敗が単体テストの結果を隠さないようにする |

## 15. 成功基準

1. `npm run lint` / `npm run typecheck` / `npm test` / `npm run test:integration` / `npm run build` が全て通る
2. 同一データに対する `GET /api/sensor-data` のレスポンス JSON が移行前後で完全一致する
3. `PUT /api/devices/:id/placement` の成功・失敗時の挙動が移行前後で一致する
4. ブラウザでの表示・範囲切替・ページング・設置場所トグル・共有ボタンが移行前と同じように動く
5. 既存テストケースが 1 件も失われていない
6. ESLint が層をまたぐ不正な import をエラーにする
7. `src/server/main.ts` を読むだけで、アプリ全体の依存関係が把握できる
