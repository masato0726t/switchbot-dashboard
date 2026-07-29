#!/usr/bin/env bash
#
# 本番サーバーでの更新スクリプト。
#
#   ssh switchbot-dashboard
#   cd ~/switchbot-dashboard && ./scripts/reload.sh
#
# 最新コードの取得 → 依存導入 → ビルド → PM2 反映 → 疎通確認 までを行う。
# どの段階で失敗しても、そこで止まって理由を出す。
#
# 環境変数:
#   SKIP_PULL=1  … git pull を飛ばす（手元で checkout 済みの版を反映したいとき）
#   PORT=3000    … 疎通確認に使うポート。未指定なら .env、それも無ければ 3000
#
# 【重要】このアプリは TypeScript をビルドして dist/ を実行する。ビルドを飛ばすと
# 古いコードのまま動き続けるか、dist/ が無くて起動に失敗する。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m失敗: %s\033[0m\n' "$1" >&2; exit 1; }

# --- node / npm / pm2 を使えるようにする -----------------------------------
# ssh の非対話シェルや cron では nvm が PATH に入らないため、明示的に読み込む。
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi
command -v node >/dev/null 2>&1 || fail "node が見つからない（nvm を読み込めなかった）"
command -v pm2  >/dev/null 2>&1 || fail "pm2 が見つからない"

step "実行環境"
echo "  リポジトリ: $ROOT"
echo "  node: $(node -v) / npm: $(npm -v) / pm2: $(pm2 -v)"

# --- 最新コードの取得 -------------------------------------------------------
BEFORE=$(git rev-parse HEAD)
if [ "${SKIP_PULL:-}" = "1" ]; then
  step "git pull をスキップ（SKIP_PULL=1）"
else
  step "最新コードを取得"
  # 未コミットの変更があると pull が中途半端に失敗するので先に止める。
  [ -z "$(git status --porcelain --untracked-files=no)" ] \
    || fail "未コミットの変更がある。git status を確認して退避してから再実行すること"
  git pull --ff-only
fi
AFTER=$(git rev-parse HEAD)
echo "  反映前: $(git log --oneline -1 "$BEFORE")"
echo "  反映後: $(git log --oneline -1 "$AFTER")"
[ "$BEFORE" = "$AFTER" ] && echo "  （コード変更なし。依存とビルドは念のため実行する）"

# --- 依存とビルド -----------------------------------------------------------
# ここまでは稼働中のプロセスに影響しない。失敗しても現行版が動き続ける。
step "依存パッケージを導入"
npm ci

step "TypeScript をビルド"
npm run build
[ -f dist/server/main.js ] || fail "dist/server/main.js が生成されていない"
echo "  生成: $(find dist -name '*.js' | wc -l) ファイル"

# --- PM2 へ反映 -------------------------------------------------------------
# startOrReload は未起動なら start、起動中なら reload する。プロセス定義
# （起動スクリプト・メモリ上限・NODE_ENV）は ecosystem.config.cjs が唯一の出典。
step "PM2 へ反映"
ROLLBACK=$BEFORE
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null
echo "  PM2 の定義を保存した（サーバー再起動後も復元される）"

# --- 疎通確認 ---------------------------------------------------------------
# 起動しただけでは動作の保証にならない。実際に応答するまで確かめる。
step "疎通確認"
if [ -z "${PORT:-}" ] && [ -f .env ]; then
  PORT=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)
fi
PORT=${PORT:-3000}

for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/api/sensor-data?range=1h" || echo 000)
  [ "$CODE" = "200" ] && break
  sleep 2
done

if [ "$CODE" != "200" ]; then
  pm2 logs switchbot-dashboard --lines 30 --nostream || true
  fail "$(printf 'ポート %s が 30 秒以内に 200 を返さなかった（最後の応答: %s）\n\n戻すには:\n  git checkout %s && npm ci && npm run build && pm2 startOrReload ecosystem.config.cjs' "$PORT" "$CODE" "$ROLLBACK")"
fi

echo "  GET /api/sensor-data => 200"
curl -s -o /dev/null -w '  GET /                    => %{http_code}\n' "http://localhost:${PORT}/"

# --- 結果 -------------------------------------------------------------------
step "状態"
pm2 list | grep -E 'name|switchbot-dashboard' || pm2 list

step "直近のログ"
pm2 logs switchbot-dashboard --lines 15 --nostream || true

printf '\n\033[1;32m完了: %s\033[0m\n' "$(git log --oneline -1)"
