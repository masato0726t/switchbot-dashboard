# SwitchBot センサーダッシュボード

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

- Node.js 18 以上
- MySQL 8 以上
- SwitchBot のデータが格納された `switchbot_db` データベース

### データベーステーブル構成

```sql
-- デバイス一覧
CREATE TABLE devices (
  id INT PRIMARY KEY,
  device_name VARCHAR(255),
  device_type VARCHAR(255),
  is_virtual_infrared TINYINT(1)
);

-- センサーログ
CREATE TABLE device_status_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id INT,
  status_data JSON,
  recorded_at DATETIME
);
```

`devices` / `device_status_logs` はデータ収集側が管理するテーブルです。
ダッシュボードは設置場所（室内 / 屋外）を保持するための専用テーブル
`device_settings` を**起動時に自動作成**します（収集側テーブルには手を加えません）。

```sql
-- 設置場所（ダッシュボードが自己管理。手動作成は不要）
CREATE TABLE device_settings (
  device_id INT PRIMARY KEY,
  placement ENUM('indoor', 'outdoor') NOT NULL DEFAULT 'indoor'
);
```

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

純粋ロジック（`lib/`）に対する単体テストを Node 標準のテストランナーで実行します（追加依存なし）。

```bash
npm test
```

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
│       ├── clothing.js  # 体感温度 → 服装提案の純粋ロジック（室内/屋外）
│       ├── placement.js # 設置場所トグル UI（室内/屋外の切替・保存）
│       ├── charts.js    # Chart.js グラフの生成・更新
│       ├── device.js    # デバイスセクションの描画・更新・破棄
│       └── nav.js       # 範囲／ページ状態とナビ UI
├── lib/                 # DB 非依存の純粋ロジック（テスト対象）
│   ├── ranges.js        # 表示範囲・ページオフセット → SQL 句とバインド値の解決
│   ├── transform.js     # DB 行 → API レスポンスへの整形・間引き
│   ├── placement.js     # 設置場所の初期推測・バリデーション
│   └── downsample.js    # LTTB ダウンサンプリング
├── test/                # node:test による単体テスト
│   ├── ranges.test.js
│   ├── transform.test.js
│   ├── placement.test.js
│   ├── clothing.test.mjs
│   └── downsample.test.js
├── server.js            # Express サーバー・API
├── package.json
├── .env.example         # 環境変数テンプレート
└── .gitignore
```
