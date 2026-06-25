// デバイス1台ぶんのセクション（統計カード＋グラフ）の生成・更新・破棄。

import { METRICS } from './config.js';
import { deviceIcon, latest, extractSeries } from './format.js';
import { buildChart, updateChart } from './charts.js';
import { buildShareButtons } from './share.js';
import { buildPlacementToggle } from './placement.js';
import { clothingFor } from './clothing.js';

// device_id -> { charts: {temp, humi, co2}, dataLen, total, last, placement }
export const registry = new Map();

// 設置場所と最新値から服装提案の 1 行を組み立てる。値が無ければ空文字。
function clothingLineHtml(placement, last) {
  const c = clothingFor(placement, last.temperature, last.humidity);
  if (!c) return '';
  const metric = c.kind === 'feels' ? `体感 ${c.value}°C` : `不快指数 ${c.value}`;
  return `<span class="clothing-icon">👕</span><span class="clothing-advice">${c.advice}</span><span class="clothing-feeling">${c.feeling} ・ ${metric}</span>`;
}

// 服装提案の行を再描画する（設置場所の切替・新データ取得のたびに呼ぶ）。
function renderClothing(device_id, placement, last) {
  const el = document.getElementById(`clothing-${device_id}`);
  if (!el) return;
  const html = clothingLineHtml(placement, last);
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}

// 表示中データの最新値（時刻＋各メトリクス）をまとめる。SNS 共有にも使う。
// 値が一度も記録されていないメトリクスは null になる。
function latestValues(data) {
  const last = { time: latest(data, 'time') };
  for (const m of METRICS) last[m.field] = latest(data, m.field);
  return last;
}

// CSS アニメーションを再生し直すためのリフロー付きフラッシュ。
function flashCard(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// 初回表示。セクション DOM を作り、各グラフを生成して registry に登録する。
export function initDevice(device, range) {
  const { device_id, name, type, placement, data, downsampled, total } = device;
  const { labels, times, series } = extractSeries(data, range);

  const last = latestValues(data);
  const lastBattery = latest(data, 'battery');
  // 値を持つメトリクスだけカードとグラフを出す
  const shown = METRICS.filter(m => last[m.field] != null);

  const section = document.createElement('div');
  section.className = 'device-section';
  section.id = `device-section-${device_id}`;

  const statCards = shown.map(m =>
    `<div class="stat-card" id="stat-card-${m.key}-${device_id}"><div class="stat-label">現在の${m.label}</div><div class="stat-value ${m.colorClass}" id="stat-${m.key}-${device_id}">${last[m.field]}<span class="stat-unit">${m.unit}</span></div></div>`
  ).join('');

  const chartCards = shown.map(m =>
    `<div class="chart-card"><div class="chart-title">${m.label} (${m.unit})</div><div class="chart-wrap"><canvas id="chart-${m.key}-${device_id}"></canvas></div></div>`
  ).join('');

  section.innerHTML = `
    <div class="device-header">
      <div class="device-icon">${deviceIcon(type)}</div>
      <div>
        <div class="device-name">${name}${lastBattery != null ? ` <span class="battery-tag" id="battery-tag-${device_id}">🔋 ${lastBattery}%</span>` : ''}</div>
        <div class="device-type">device_id: ${device_id} &nbsp;|&nbsp; ${type || 'N/A'}${downsampled ? ' &nbsp;|&nbsp; <span class="downsample-tag">間引き表示</span>' : ''}</div>
        <div class="clothing-line" id="clothing-${device_id}">${clothingLineHtml(placement, last)}</div>
      </div>
    </div>
    <div class="stats-row" id="stats-row-${device_id}">
      ${statCards}
      <div class="stat-card" id="stat-card-count-${device_id}"><div class="stat-label">データ件数（表示 / 全）</div><div class="stat-value stat-value-count" id="stat-count-${device_id}">${data.length}<span class="stat-unit">件</span></div><div class="stat-sub">全 <span class="stat-sub-num" id="stat-total-${device_id}">${total}</span> 件</div></div>
    </div>
    <div class="charts-grid">
      ${chartCards}
    </div>
  `;

  // 設置場所トグル（室内 / 屋外）。切替時にサーバー保存し、服装提案を再計算する。
  section.querySelector('.device-header').appendChild(
    buildPlacementToggle(device_id, placement, (p) => {
      const rec = registry.get(device_id);
      if (rec) { rec.placement = p; renderClothing(device_id, p, rec.last); }
    })
  );

  // 共有ボタン（ヘッダー右端）。クリック時に registry から最新値を取り直す。
  section.querySelector('.device-header').appendChild(
    buildShareButtons(() => ({ name, ...registry.get(device_id).last }))
  );

  document.getElementById('dashboard').appendChild(section);
  renderClothing(device_id, placement, last);   // 値が無いときは行を隠す

  const charts = {};
  for (const m of shown) {
    charts[m.key] = buildChart(
      `chart-${m.key}-${device_id}`, labels, series[m.field],
      `${m.label} (${m.unit})`, m.palette, times
    );
  }

  registry.set(device_id, { charts, dataLen: data.length, total, last, placement });
}

// 既存セクションの値・グラフ・件数を更新する。新データ取得時はカードをフラッシュ。
export function updateDevice(device, range) {
  const { device_id, data, total } = device;
  const rec = registry.get(device_id);
  const isNew = data.length > rec.dataLen;

  const { labels, times, series } = extractSeries(data, range);
  const last = latestValues(data);

  for (const m of METRICS) {
    if (rec.charts[m.key]) updateChart(rec.charts[m.key], labels, series[m.field], times);

    // 統計カードは値が変わったときだけ書き換え、新データならフラッシュする
    if (last[m.field] == null) continue;
    const el = document.getElementById(`stat-${m.key}-${device_id}`);
    if (!el || String(last[m.field]) === el.dataset.raw) continue;
    el.innerHTML = `${last[m.field]}<span class="stat-unit">${m.unit}</span>`;
    el.dataset.raw = String(last[m.field]);
    const card = document.getElementById(`stat-card-${m.key}-${device_id}`);
    if (isNew && card) flashCard(card);
  }

  const lastBattery = latest(data, 'battery');
  const batteryEl = document.getElementById(`battery-tag-${device_id}`);
  if (batteryEl && lastBattery != null) batteryEl.textContent = `🔋 ${lastBattery}%`;

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
  rec.last = last;

  // 現在値が変わったら服装提案も更新する（設置場所は現在のトグル状態を使う）。
  renderClothing(device_id, rec.placement, last);
}

// 全デバイスのチャートを破棄して registry とダッシュボード DOM を空にする。
export function clearDashboard() {
  for (const rec of registry.values()) {
    for (const chart of Object.values(rec.charts)) chart.destroy();
  }
  registry.clear();
  document.getElementById('dashboard').innerHTML = '';
}
