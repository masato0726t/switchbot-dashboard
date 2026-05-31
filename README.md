# SwitchBot センサーダッシュボード

SwitchBot デバイスの温度・湿度・CO2 データをリアルタイムで可視化する Web ダッシュボードです。

## 機能

- 温度・湿度・CO2 の現在値をカード表示
- 時系列グラフ（Chart.js）
- 表示範囲の切り替え（1時間 / 6時間 / 12時間 / 24時間 / 1週間 / 1ヶ月 / 1年 / 3年 / 全部）
- 長期間データの自動ダウンサンプリング（LTTB）でグラフ描画を高速化
- 30 秒ごとの自動更新（カウントダウン表示付き）
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

未知の値が渡された場合はデフォルト（`24h`）に丸められます。1 デバイスあたりの点数が
**800 点**（`lib/transform.js` の `MAX_POINTS`）を超えると LTTB で間引かれ、その場合
`downsampled: true` が付きます。

レスポンス例:
```json
[
  {
    "device_id": 1,
    "name": "リビング",
    "type": "WoIOSensor",
    "downsampled": false,
    "data": [
      { "time": "2026/5/31 19:00:00", "temperature": 24.9, "humidity": 55, "co2": 718 }
    ]
  }
]
```

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
│   └── js/
│       └── app.js       # フロントエンドロジック
├── lib/                 # DB 非依存の純粋ロジック（テスト対象）
│   ├── ranges.js        # 表示範囲キー → SQL 句の解決
│   ├── transform.js     # DB 行 → API レスポンスへの整形・間引き
│   └── downsample.js    # LTTB ダウンサンプリング
├── test/                # node:test による単体テスト
│   ├── ranges.test.js
│   ├── transform.test.js
│   └── downsample.test.js
├── server.js            # Express サーバー・API
├── package.json
├── .env.example         # 環境変数テンプレート
└── .gitignore
```
