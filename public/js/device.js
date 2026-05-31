// デバイス1台ぶんのセクション（統計カード＋グラフ）の生成・更新・破棄。

import { PALETTE } from './config.js';
import { deviceIcon, latest, extractSeries } from './format.js';
import { buildChart, updateChart } from './charts.js';

// device_id -> { charts: {temp, humi, co2}, dataLen, total }
export const registry = new Map();

// CSS アニメーションを再生し直すためのリフロー付きフラッシュ。
function flashCard(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// 初回表示。セクション DOM を作り、各グラフを生成して registry に登録する。
export function initDevice(device, range) {
  const { device_id, name, type, data, downsampled, total } = device;
  const { labels, times, temps, humids, co2s, hasCO2 } = extractSeries(data, range);

  const lastTemp = latest(data, 'temperature');
  const lastHumi = latest(data, 'humidity');
  const lastCO2  = hasCO2 ? latest(data, 'co2') : null;

  const tid = `chart-temp-${device_id}`;
  const hid = `chart-humi-${device_id}`;
  const cid = `chart-co2-${device_id}`;

  const section = document.createElement('div');
  section.className = 'device-section';
  section.id = `device-section-${device_id}`;

  section.innerHTML = `
    <div class="device-header">
      <div class="device-icon">${deviceIcon(type)}</div>
      <div>
        <div class="device-name">${name}</div>
        <div class="device-type">device_id: ${device_id} &nbsp;|&nbsp; ${type || 'N/A'}${downsampled ? ' &nbsp;|&nbsp; <span class="downsample-tag">間引き表示</span>' : ''}</div>
      </div>
    </div>
    <div class="stats-row" id="stats-row-${device_id}">
      ${lastTemp != null ? `<div class="stat-card" id="stat-card-temp-${device_id}"><div class="stat-label">現在の温度</div><div class="stat-value temp-color" id="stat-temp-${device_id}">${lastTemp}<span class="stat-unit">°C</span></div></div>` : ''}
      ${lastHumi != null ? `<div class="stat-card" id="stat-card-humi-${device_id}"><div class="stat-label">現在の湿度</div><div class="stat-value humi-color" id="stat-humi-${device_id}">${lastHumi}<span class="stat-unit">%</span></div></div>` : ''}
      ${lastCO2  != null ? `<div class="stat-card" id="stat-card-co2-${device_id}"><div class="stat-label">現在のCO2</div><div class="stat-value co2-color" id="stat-co2-${device_id}">${lastCO2}<span class="stat-unit">ppm</span></div></div>` : ''}
      <div class="stat-card" id="stat-card-count-${device_id}"><div class="stat-label">データ件数（表示 / 全）</div><div class="stat-value" style="color:#e2e8f0;font-size:1.4rem" id="stat-count-${device_id}">${data.length}<span class="stat-unit">件</span></div><div class="stat-sub">全 <span class="stat-sub-num" id="stat-total-${device_id}">${total}</span> 件</div></div>
    </div>
    <div class="charts-grid" style="grid-template-columns: repeat(auto-fit, minmax(400px, 1fr))">
      ${lastTemp != null ? `<div class="chart-card"><div class="chart-title">温度 (°C)</div><div class="chart-wrap"><canvas id="${tid}"></canvas></div></div>` : ''}
      ${lastHumi != null ? `<div class="chart-card"><div class="chart-title">湿度 (%)</div><div class="chart-wrap"><canvas id="${hid}"></canvas></div></div>` : ''}
      ${hasCO2           ? `<div class="chart-card"><div class="chart-title">CO2 (ppm)</div><div class="chart-wrap"><canvas id="${cid}"></canvas></div></div>` : ''}
    </div>
  `;

  document.getElementById('dashboard').appendChild(section);

  const charts = {};
  if (lastTemp != null) charts.temp = buildChart(tid, labels, temps,  '温度 (°C)',  PALETTE.temperature, times);
  if (lastHumi != null) charts.humi = buildChart(hid, labels, humids, '湿度 (%)',   PALETTE.humidity,    times);
  if (hasCO2)           charts.co2  = buildChart(cid, labels, co2s,   'CO2 (ppm)', PALETTE.co2,         times);

  registry.set(device_id, { charts, dataLen: data.length, total });
}

// 既存セクションの値・グラフ・件数を更新する。新データ取得時はカードをフラッシュ。
export function updateDevice(device, range) {
  const { device_id, data, total } = device;
  const rec = registry.get(device_id);
  const isNew = data.length > rec.dataLen;

  const { labels, times, temps, humids, co2s, hasCO2 } = extractSeries(data, range);

  if (rec.charts.temp) updateChart(rec.charts.temp, labels, temps,  times);
  if (rec.charts.humi) updateChart(rec.charts.humi, labels, humids, times);
  if (rec.charts.co2)  updateChart(rec.charts.co2,  labels, co2s,   times);

  const lastTemp = latest(data, 'temperature');
  const lastHumi = latest(data, 'humidity');
  const lastCO2  = hasCO2 ? latest(data, 'co2') : null;

  function setStatValue(id, cardId, value, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    const card = document.getElementById(cardId);
    const current = el.dataset.raw;
    if (String(value) !== current) {
      el.innerHTML = `${value}<span class="stat-unit">${unit}</span>`;
      el.dataset.raw = String(value);
      if (isNew && card) flashCard(card);
    }
  }

  if (lastTemp != null) setStatValue(`stat-temp-${device_id}`, `stat-card-temp-${device_id}`, lastTemp, '°C');
  if (lastHumi != null) setStatValue(`stat-humi-${device_id}`, `stat-card-humi-${device_id}`, lastHumi, '%');
  if (lastCO2  != null) setStatValue(`stat-co2-${device_id}`,  `stat-card-co2-${device_id}`,  lastCO2,  'ppm');

  // 表示中の件数（間引き後の点数）
  const countEl = document.getElementById(`stat-count-${device_id}`);
  if (countEl) countEl.innerHTML = `${data.length}<span class="stat-unit">件</span>`;

  // 全データ件数（全期間）。増えたら件数カードをフラッシュする
  const totalEl = document.getElementById(`stat-total-${device_id}`);
  if (totalEl && total != null) {
    const card = document.getElementById(`stat-card-count-${device_id}`);
    if (total > rec.total && card) flashCard(card);
    totalEl.textContent = total;
  }

  rec.dataLen = data.length;
  rec.total = total;
}

// 全デバイスのチャートを破棄して registry とダッシュボード DOM を空にする。
export function clearDashboard() {
  for (const rec of registry.values()) {
    for (const chart of Object.values(rec.charts)) chart.destroy();
  }
  registry.clear();
  document.getElementById('dashboard').innerHTML = '';
}
