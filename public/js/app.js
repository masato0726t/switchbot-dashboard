// エントリポイント。状態をまとめ、データ取得・自動更新・初期化を束ねる。

import { REFRESH_SEC } from './config.js';
import { registry, initDevice, updateDevice, clearDashboard } from './device.js';
import {
  getRange, getOffset, isLive,
  renderRangeBar, renderNavBar, updateNavState,
} from './nav.js';

let remaining = REFRESH_SEC;

// API から現在の範囲・オフセットのデータを取得し、各デバイスを反映する。
async function fetchAndUpdate() {
  try {
    const res = await fetch(
      `/api/sensor-data?range=${encodeURIComponent(getRange())}&offset=${getOffset()}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const devices = await res.json();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('error-msg').style.display = 'none';
    document.getElementById('last-updated').textContent =
      `更新: ${new Date().toLocaleTimeString('ja-JP')}`;

    const range = getRange();
    const seen = new Set();
    for (const device of devices) {
      seen.add(device.device_id);
      if (registry.has(device.device_id)) {
        updateDevice(device, range);
      } else {
        initDevice(device, range);
      }
    }

    // この範囲ではデータが無くなったデバイスのセクションを除去
    for (const id of [...registry.keys()]) {
      if (!seen.has(id)) {
        const rec = registry.get(id);
        for (const chart of Object.values(rec.charts)) chart.destroy();
        registry.delete(id);
        document.getElementById(`device-section-${id}`)?.remove();
      }
    }

    if (devices.length === 0) {
      document.getElementById('dashboard').innerHTML =
        '<div class="empty-msg">この期間のデータはありません</div>';
    }
  } catch (err) {
    const el = document.getElementById('error-msg');
    el.style.display = 'block';
    el.textContent = `データ取得エラー: ${err.message}`;
  }
}

// 範囲・オフセットを変えたあとの再読み込み（チャートを作り直す）
function reload() {
  clearDashboard();
  document.getElementById('loading').style.display = 'flex';
  remaining = REFRESH_SEC;
  updateNavState();
  fetchAndUpdate();
}

setInterval(() => {
  if (!isLive()) return;                         // 履歴表示中は自動更新しない
  remaining--;
  if (remaining <= 0) {
    remaining = REFRESH_SEC;
    fetchAndUpdate();
  }
}, 1000);

renderRangeBar(reload);
renderNavBar(reload);
updateNavState();
fetchAndUpdate();
