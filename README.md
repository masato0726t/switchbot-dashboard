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
`device_settings` のみを自己管理し、`server.js` が起動時に `ddl/device_settings.sql`
を読み込んで実行します（収集側テーブルには手を加えません）。

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

| 変数名        | 説明                  |
|-------------|-----------------------|
| `DB_HOST`   | MySQL ホスト           |
| `DB_PORT`   | MySQL ポート（通常 3306）|
| `DB_USER`   | MySQL ユーザー名        |
| `DB_PASSWORD` | MySQL パスワード      |
| `DB_NAME`   | データベース名           |

## 起動

```bash
npm start
```

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
**800 点**（`lib/transform.js` の `MAX_POINTS`）を超えると LTTB で間引かれ、その場合
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

純粋ロジック（`lib/` の純粋モジュールと `public/js/` の純粋ヘルパー）に対する単体テストを
Node 標準のテストランナーで実行します（追加依存なし）。`db.js` / `logger.js` などインフラ層は
対象外です。

```bash
npm test
```

## Lint

ESLint（フラット設定 `eslint.config.js`）でコードを静的解析します。backend（CommonJS/Node）と
frontend（ブラウザ ESM）でグローバルと sourceType を切り替えています。

```bash
npm run lint           # チェックのみ
npx eslint . --fix     # 自動修正できるものは修正
```

## CI

`main` への push と Pull Request では、GitHub Actions（`.github/workflows/ci.yml`）が
**Lint**（ESLint）と**テスト**（Node.js 20 / 22）を自動実行します。

## ディレクトリ構成

```
switchbot-dashboard/
├── public/
│   ├── index.html       # メイン HTML
│   ├── css/
│   │   └── style.css    # スタイルシート
│   └── js/              # ES Modules（バンドラなし・ブラウザ直読み）
│       ├── app.js       # エントリ：データ取得・自動更新・初期化
│       ├── config.js    # 定数（更新間隔・配色・表示範囲）
│       ├── format.js    # 表示用の純粋ヘルパー（ラベル整形・系列抽出）
│       ├── clothing.js       # 体感温度 → 服装提案の純粋ロジック（室内/屋外）
│       ├── placement-toggle.js  # 設置場所トグル UI（室内/屋外の切替・保存）
│       ├── charts.js         # Chart.js グラフの生成・更新
│       ├── device.js         # デバイスセクションの描画・更新・破棄
│       └── nav.js            # 範囲／ページ状態とナビ UI
├── lib/                 # サーバー共通モジュール
│   ├── ranges.js        # 〔純粋〕表示範囲・ページオフセット → SQL 句とバインド値の解決
│   ├── transform.js     # 〔純粋〕DB 行 → API レスポンスへの整形・間引き
│   ├── placement.js     # 〔純粋〕設置場所の初期推測・バリデーション
│   ├── downsample.js    # 〔純粋〕LTTB ダウンサンプリング
│   ├── db.js            # 〔インフラ〕MySQL 接続設定と接続ヘルパー
│   └── logger.js        # 〔インフラ〕JST タイムスタンプ付きロガー
├── ddl/                 # テーブル DDL
│   ├── devices.sql              # デバイス一覧（収集側管理・参照用）
│   ├── device_status_logs.sql   # センサーログ（収集側管理・参照用）
│   └── device_settings.sql      # 設置場所テーブル（起動時に自動実行）
├── test/                # node:test による単体テスト
│   ├── ranges.test.js
│   ├── transform.test.js
│   ├── placement.test.js
│   ├── clothing.test.mjs
│   └── downsample.test.js
├── .github/
│   └── workflows/
│       └── ci.yml       # GitHub Actions（Node 18/20/22 でテスト実行）
├── server.js            # Express サーバー・API
├── eslint.config.js     # ESLint フラット設定（backend/frontend で切替）
├── package.json
├── .env.example         # 環境変数テンプレート
└── .gitignore
```
