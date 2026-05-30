# SwitchBot センサーダッシュボード

SwitchBot デバイスの温度・湿度・CO2 データをリアルタイムで可視化する Web ダッシュボードです。

## 機能

- 温度・湿度・CO2 の現在値をカード表示
- 時系列グラフ（Chart.js）
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

## ディレクトリ構成

```
switchbot-dashboard/
├── public/
│   ├── index.html       # メイン HTML
│   ├── css/
│   │   └── style.css    # スタイルシート
│   └── js/
│       └── app.js       # フロントエンドロジック
├── server.js            # Express サーバー・API
├── package.json
├── .env.example         # 環境変数テンプレート
└── .gitignore
```
