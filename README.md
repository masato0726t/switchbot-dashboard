# SwitchBot センサーダッシュボード

[![CI](https://github.com/masato0726t/switchbot-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/masato0726t/switchbot-dashboard/actions/workflows/ci.yml)

SwitchBot デバイスの温度・湿度・CO2 データをリアルタイムで可視化する Web ダッシュボードです。

## 機能

- 温度・湿度・CO2 の現在値をカード表示
- 体感温度ベースの服装提案（デバイスごとに室内 / 屋外で判定を切替）
- 時系列グラフ（Chart.js）
- 表示範囲の切り替え（1時間 / 6時間 / 12時間 / 24時間 / 1週間 / 1ヶ月 / 1年 / 3年 / 全部）
- 過去データへのページング（「← 過去へ」で遡り、「新しい方へ →」「最新へ ⏭」で戻る）
- 長期間データの自動ダウンサンプリング（LTTB）でグラフ描画を高速化
- 30 秒ごとの自動更新
- 新しいデータ取得時のフラッシュアニメーション

## 動作要件

- Node.js 20 以上
- MySQL 8 以上
- SwitchBot のデータが格納された `switchbot_db` データベース

### データベーステーブル構成

テーブルの DDL はすべて `ddl/` に外出ししてあります。

| ファイル | テーブル | 管理 | 備考 |
|---------|---------|------|------|
| `ddl/devices.sql`            | `devices`            | データ収集側 | 参照のみ（自動実行しない） |
| `ddl/device_status_logs.sql` | `device_status_logs` | データ収集側 | 参照のみ（自動実行しない） |
| `ddl/device_settings.sql`    | `device_settings`    | ダッシュボード | **起動時に自動実行**（手動作成不要） |

`devices` / `device_status_logs` はデータ収集側が管理するテーブルで、参考用に
DDL を置いてあるだけです。ダッシュボードは設置場所（室内 / 屋外）を保持する
`device_settings` のみを自己管理し、サーバー（`src/server/main.ts`）が起動時に
`ddl/device_settings.sql` を読み込んで実行します（収集側テーブルには手を加えません）。

設定が無いデバイスは `device_type` から初期推測します（`IO` を含む種別＝屋外、
それ以外＝室内）。最終的な設置場所は画面のトグルでいつでも変更できます。

`status_data` の JSON 例:
```json
{ "temperature": 24.9, "humidity": 55, "CO2": 718 }
```

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env を編集して DB 接続情報を入力
```

## 環境変数

`.env.example` を `.env` にコピーして設定してください。

| 変数名           | 必須／任意 | 既定値    | 説明・制約                              |
|------------------|-----------|-----------|------------------------------------------|
| `DB_HOST`        | 必須      | -         | MySQL ホスト                             |
| `DB_PORT`        | 任意      | `3306`    | MySQL ポート。1 以上の整数               |
| `DB_USER`        | 必須      | -         | MySQL ユーザー名                          |
| `DB_PASSWORD`    | 必須      | -         | MySQL パスワード                          |
| `DB_NAME`        | 必須      | -         | データベース名                            |
| `DB_POOL_LIMIT`  | 任意      | `10`      | コネクションプールの最大接続数。1 以上の整数 |
| `PORT`           | 任意      | `3000`    | 待ち受けポート。1 以上の整数              |
| `TOTALS_TTL_MS`  | 任意      | `60000`   | 総件数キャッシュの有効期間（ミリ秒）。1 以上の整数 |
| `LOG_LEVEL`      | 任意      | `info`    | `fatal` / `error` / `warn` / `info` / `debug` / `trace` のいずれか |

**不正な値（空文字・0・数値でない値・列挙外の文字列など）を設定すると、既定値に
黙って倒れず起動時にエラーで停止します。** 設定ミスを黙殺すると「設定したはずなのに
効いていない」という気づきにくい障害になるため、意図的にこうしています
（旧実装は `Number(...) || 既定値` で黙って倒していましたが、これは意図的な変更です）。

## 起動

```bash
npm run build   # TypeScript をビルド（dist/ に出力）
npm start       # dist/server/main.js を起動
```

開発中は `npm run dev`（`tsx watch`）でビルド無しに再起動できます。

ブラウザで `http://localhost:3000` を開いてください。

`PORT` 環境変数で待ち受けポートを変更できます（デフォルト 3000）。

## API

### `GET /api/sensor-data`

センサーデータをデバイス別の時系列で返します。

| クエリ      | 値                                                              | デフォルト |
|-----------|-----------------------------------------------------------------|----------|
| `range`   | `1h` / `6h` / `12h` / `24h` / `1w` / `1mo` / `1y` / `3y` / `all` | `24h`    |
| `offset`  | 0 以上の整数。過去へ何区間さかのぼるか（`0` = 最新）              | `0`      |

未知の値が渡された場合はそれぞれデフォルト（`range=24h` / `offset=0`）に丸められます。

`offset` は 1 区間幅（`range`）ずつ時間をさかのぼるページングに使います。例えば `range=24h&offset=2`
は「48〜72時間前」の窓を返します。`range=all` のときは窓幅を持たないため `offset` は無視されます。

1 デバイスあたりの点数が
**800 点**（`src/server/domain/build-series.ts` の `MAX_POINTS`）を超えると LTTB で間引かれ、その場合
`downsampled: true` が付きます。

`total` は `range`/`offset` に依存しない**全期間の総件数（DB 行数）**です。
UI の「データ件数（表示 / 全）」カードでは、メインに `data` の配列長（間引き後の**表示中の点数**）、
その下に `total`（**全データ件数**）を併記します。

レスポンス例:
```json
[
  {
    "device_id": 1,
    "name": "リビング",
    "type": "WoIOSensor",
    "total": 52431,
    "downsampled": false,
    "data": [
      { "ts": 1748685600000, "time": "2026/5/31 19:00:00", "temperature": 24.9, "humidity": 55, "co2": 718 }
    ]
  }
]
```

各点は `ts`（エポックミリ秒）と `time`（JST の表示文字列）を持ちます。グラフの横軸ラベルは
クライアントが `ts` から表示範囲に応じて短く整形し（短時間=時刻のみ / 週・月=月日 / 年=年月）、
ツールチップにはフル日時（`time`）を表示します。

各デバイスには `placement`（`indoor` / `outdoor`）も付きます。クライアントはこれを使い、
最新の温度・湿度から体感温度を求めて服装提案を表示します（室内は不快指数 THI、屋外は
暑い側のみ Heat Index・寒い側は気温ベース）。

### `PUT /api/devices/:id/placement`

デバイスの設置場所を更新します。リクエストボディは JSON で `placement` を指定します。

```json
{ "placement": "outdoor" }
```

`placement` は `indoor` / `outdoor` のいずれかのみ受け付け、それ以外は `400` を返します。
成功時は `{ "device_id": 1, "placement": "outdoor" }` を返します。

## ダウンサンプリングについて

長期間（1 年・3 年・全部など）を表示するとデータ点数が膨大になり描画が重くなるため、
サーバー側で **LTTB（Largest Triangle Three Buckets）** により点数を間引きます。

- 平均化せず**実データ点を選ぶ**ため、表示される値が偽物になりません
- **最初と最後の点は必ず残る**ため、最新値の表示が正確なままです
- 折れ線の山・谷など視覚的な形を保ちます

## テスト

Vitest で実行します。

```bash
npm test              # 単体テスト（高速）
npm run test:integration  # Testcontainers で MySQL 8 を起動する統合テスト（Docker が必要）
```

## Lint

ESLint（フラット設定 `eslint.config.js`）でコードを静的解析します。backend（TypeScript・`src/`）と
frontend（ブラウザ ESM・`public/js/`）でグローバルと sourceType を切り替えています。
backend には層の境界を強制する `boundaries/element-types` ルールも入っています
（詳細は次節「クリーンアーキテクチャ」）。

```bash
npm run lint           # チェックのみ
npx eslint . --fix     # 自動修正できるものは修正
```

## クリーンアーキテクチャ

`src/server/` はドメイン中心の 4 層構成です。依存は常に外側から内側の一方向のみで、
逆向きの import は禁止されています。

```
main → presentation → application → domain
              └────────┴→ infrastructure ─┘         （domain / shared には誰からでも依存できる）
```

- `domain`（純粋ロジック）は他のどの層にも依存しません。
- `application`（ユースケース）は `domain` と、外界の必要事項だけを定義したポート
  （`application/ports.ts`）に依存します。DB や HTTP など具体的な実装は知りません。
- `infrastructure`（DB・ロガー等）と `presentation`（HTTP ルーティング）はどちらも
  `application` のポートを実装／利用するだけで、互いには依存しません。
- `main.ts` だけが全層を import して配線します。アプリ全体の依存関係は
  `src/server/main.ts` を読むだけで把握できます。

この向きは ESLint の `boundaries/element-types` ルール（`eslint.config.js`）が機械的に
強制しており、逆向きの import はレビューを待たず lint エラーになります。

## CI

`main` への push と Pull Request では、GitHub Actions（`.github/workflows/ci.yml`）が
**lint**（ESLint・層の境界チェックを含む）・**typecheck**（`tsc --noEmit`）・
**test**（Vitest 単体テスト、Node.js 20 / 22）・**integration**（Testcontainers での
MySQL 統合テスト）・**build**（TypeScript ビルド）を自動実行します。

## ディレクトリ構成

```
switchbot-dashboard/
├── public/
│   ├── index.html       # メイン HTML
│   ├── css/
│   │   └── style.css    # スタイルシート
│   └── js/              # ES Modules（バンドラなし・ブラウザ直読み。React 化までの暫定形）
│       ├── app.js       # エントリ：データ取得・自動更新・初期化
│       ├── config.js    # 定数（更新間隔・配色・表示範囲）
│       ├── format.js    # 表示用の純粋ヘルパー（ラベル整形・系列抽出）
│       ├── clothing.js       # 体感温度 → 服装提案の純粋ロジック（室内/屋外）
│       ├── placement-toggle.js  # 設置場所トグル UI（室内/屋外の切替・保存）
│       ├── charts.js         # Chart.js グラフの生成・更新
│       ├── device.js         # デバイスセクションの描画・更新・破棄
│       └── nav.js            # 範囲／ページ状態とナビ UI
├── src/
│   ├── server/           # バックエンド（クリーンアーキテクチャ、詳細は上の節）
│   │   ├── domain/          # 純粋ロジック（範囲解決・ダウンサンプリング・設置場所判定 等）
│   │   ├── application/     # ユースケース（get-sensor-data / set-device-placement）とポート定義
│   │   ├── infrastructure/  # DB（Kysely）・ロガー（pino）・総件数キャッシュ・DDL 実行
│   │   │   └── db/             # リポジトリ実装・スキーマ・表示窓クエリの組み立て
│   │   ├── presentation/    # Express アプリの組み立てとルーティング
│   │   │   └── routes/         # /api/sensor-data・/api/devices/:id/placement
│   │   ├── config.ts        # 環境変数の読み取りと検証（zod）
│   │   └── main.ts          # 合成ルート。全層の配線はここだけで行う
│   └── shared/            # フロントエンドとも共有する型・純粋関数（表示範囲など）
├── ddl/                 # テーブル DDL
│   ├── devices.sql              # デバイス一覧（収集側管理・参照用）
│   ├── device_status_logs.sql   # センサーログ（収集側管理・参照用）
│   └── device_settings.sql      # 設置場所テーブル（起動時に自動実行）
├── scripts/
│   └── seed-verify.sql  # 手動確認用のシード（DB スキーマ変更時などに使う）
├── test/                # フロントエンドの純粋ヘルパーに対する単体テスト（node:test）
│   ├── clothing.test.mjs
│   ├── format.test.mjs
│   └── share.test.mjs
├── docs/
│   └── db-performance.md  # DB チューニング手順と実測結果
├── .github/
│   └── workflows/
│       └── ci.yml       # GitHub Actions（lint / typecheck / test / integration / build）
├── eslint.config.js     # ESLint フラット設定（backend/frontend で切替、層境界チェック込み）
├── tsconfig.json / tsconfig.server.json  # TypeScript 設定
├── vitest.config.ts / vitest.integration.config.ts  # Vitest 設定（単体／統合）
├── package.json
├── ecosystem.config.cjs # PM2 プロセス定義
├── .env.example         # 環境変数テンプレート
└── .gitignore
```
