const REFRESH_SEC = 30;

const PALETTE = {
  temperature: { line: '#f97316', fill: 'rgba(249,115,22,0.12)' },
  humidity:    { line: '#38bdf8', fill: 'rgba(56,189,248,0.12)' },
  co2:         { line: '#a78bfa', fill: 'rgba(167,139,250,0.12)' },
};

// 表示範囲の選択肢（key はサーバー側 RANGE_INTERVALS と対応）
const RANGES = [
  { key: '1h',  label: '1時間' },
  { key: '6h',  label: '6時間' },
  { key: '12h', label: '12時間' },
  { key: '24h', label: '24時間' },
  { key: '1w',  label: '1週間' },
  { key: '1mo', label: '1ヶ月' },
  { key: '1y',  label: '1年' },
  { key: '3y',  label: '3年' },
  { key: 'all', label: '全部' },
];

let currentRange = '24h';

// device_id -> { charts: {temp, humi, co2}, dataLen }
const registry = new Map();

function deviceIcon(type) {
  if (type.includes('CO2'))   return '🌡️';
  if (type.includes('Meter')) return '🌡️';
  if (type.includes('IO'))    return '🌿';
  if (type.includes('Hub'))   return '📡';
  return '📟';
}

function latest(arr, key) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i][key] != null) return arr[i][key];
  }
  return null;
}

function buildChart(canvasId, labels, values, yLabel, color) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: yLabel,
        data: values,
        borderColor: color.line,
        backgroundColor: color.fill,
        borderWidth: 2,
        pointRadius: labels.length > 60 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1,
          titleColor: '#94a3b8', bodyColor: '#f1f5f9',
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 30, font: { size: 11 } },
          grid: { color: '#1e293b' }
        },
        y: {
          ticks: { color: '#64748b', font: { size: 11 } },
          grid: { color: '#334155' },
          title: { display: true, text: yLabel, color: '#475569', font: { size: 11 } }
        }
      }
    }
  });
}

function updateChart(chart, labels, values) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = values;
  chart.data.datasets[0].pointRadius = labels.length > 60 ? 0 : 3;
  chart.update();
}

function flashCard(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function initDevice(device) {
  const { device_id, name, type, data, downsampled } = device;
  const labels = data.map(d => d.time);
  const temps  = data.map(d => d.temperature);
  const humids = data.map(d => d.humidity);
  const hasCO2 = data.some(d => d.co2 != null);
  const co2s   = hasCO2 ? data.map(d => d.co2 ?? null) : [];

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
      <div class="stat-card" id="stat-card-count-${device_id}"><div class="stat-label">データ件数</div><div class="stat-value" style="color:#e2e8f0;font-size:1.4rem" id="stat-count-${device_id}">${data.length}<span class="stat-unit">件</span></div></div>
    </div>
    <div class="charts-grid" style="grid-template-columns: repeat(auto-fit, minmax(400px, 1fr))">
      ${lastTemp != null ? `<div class="chart-card"><div class="chart-title">温度 (°C)</div><div class="chart-wrap"><canvas id="${tid}"></canvas></div></div>` : ''}
      ${lastHumi != null ? `<div class="chart-card"><div class="chart-title">湿度 (%)</div><div class="chart-wrap"><canvas id="${hid}"></canvas></div></div>` : ''}
      ${hasCO2           ? `<div class="chart-card"><div class="chart-title">CO2 (ppm)</div><div class="chart-wrap"><canvas id="${cid}"></canvas></div></div>` : ''}
    </div>
  `;

  document.getElementById('dashboard').appendChild(section);

  const charts = {};
  if (lastTemp != null) charts.temp = buildChart(tid, labels, temps,  '温度 (°C)',  PALETTE.temperature);
  if (lastHumi != null) charts.humi = buildChart(hid, labels, humids, '湿度 (%)',   PALETTE.humidity);
  if (hasCO2)           charts.co2  = buildChart(cid, labels, co2s,   'CO2 (ppm)', PALETTE.co2);

  registry.set(device_id, { charts, dataLen: data.length });
}

function updateDevice(device) {
  const { device_id, data } = device;
  const rec = registry.get(device_id);
  const isNew = data.length > rec.dataLen;

  const labels = data.map(d => d.time);
  const temps  = data.map(d => d.temperature);
  const humids = data.map(d => d.humidity);
  const hasCO2 = data.some(d => d.co2 != null);
  const co2s   = hasCO2 ? data.map(d => d.co2 ?? null) : [];

  if (rec.charts.temp) updateChart(rec.charts.temp, labels, temps);
  if (rec.charts.humi) updateChart(rec.charts.humi, labels, humids);
  if (rec.charts.co2)  updateChart(rec.charts.co2,  labels, co2s);

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

  const countEl = document.getElementById(`stat-count-${device_id}`);
  if (countEl) {
    if (isNew && document.getElementById(`stat-card-count-${device_id}`))
      flashCard(document.getElementById(`stat-card-count-${device_id}`));
    countEl.innerHTML = `${data.length}<span class="stat-unit">件</span>`;
  }

  rec.dataLen = data.length;
}

function clearDashboard() {
  for (const rec of registry.values()) {
    for (const chart of Object.values(rec.charts)) chart.destroy();
  }
  registry.clear();
  document.getElementById('dashboard').innerHTML = '';
}

async function fetchAndUpdate() {
  try {
    const res = await fetch(`/api/sensor-data?range=${encodeURIComponent(currentRange)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const devices = await res.json();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('error-msg').style.display = 'none';
    document.getElementById('last-updated').textContent =
      `更新: ${new Date().toLocaleTimeString('ja-JP')}`;

    const seen = new Set();
    for (const device of devices) {
      seen.add(device.device_id);
      if (registry.has(device.device_id)) {
        updateDevice(device);
      } else {
        initDevice(device);
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

let remaining = REFRESH_SEC;
const countdownEl = document.getElementById('countdown');

function renderRangeBar() {
  const bar = document.getElementById('range-bar');
  for (const { key, label } of RANGES) {
    const btn = document.createElement('button');
    btn.className = 'range-btn' + (key === currentRange ? ' active' : '');
    btn.textContent = label;
    btn.dataset.range = key;
    btn.addEventListener('click', () => {
      if (key === currentRange) return;
      currentRange = key;
      for (const b of bar.children) b.classList.toggle('active', b.dataset.range === key);
      clearDashboard();
      document.getElementById('loading').style.display = 'flex';
      remaining = REFRESH_SEC;
      countdownEl.textContent = `次の更新まで ${REFRESH_SEC}秒`;
      fetchAndUpdate();
    });
    bar.appendChild(btn);
  }
}

setInterval(() => {
  remaining--;
  countdownEl.textContent = `次の更新まで ${remaining}秒`;
  if (remaining <= 0) {
    remaining = REFRESH_SEC;
    fetchAndUpdate();
  }
}, 1000);

renderRangeBar();
fetchAndUpdate();
countdownEl.textContent = `次の更新まで ${REFRESH_SEC}秒`;
