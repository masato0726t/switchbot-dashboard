// Chart.js（CDN の UMD グローバル Chart）を使った折れ線グラフの生成・更新。

// 新しい折れ線チャートを作る。fullTimes はツールチップに出すフル日時の配列で、
// dataIndex から参照するため chart.$fullTimes として保持する。
export function buildChart(canvasId, labels, values, yLabel, color, fullTimes) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  const chart = new Chart(ctx, {
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
          callbacks: {
            // 横軸ラベルは短縮表示なので、ツールチップではフル日時を見せる
            title: (items) => items[0].chart.$fullTimes?.[items[0].dataIndex] ?? items[0].label,
          },
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } },
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
  chart.$fullTimes = fullTimes;   // ツールチップ用のフル日時（dataIndex で参照）
  return chart;
}

// 既存チャートのラベル・値・ツールチップ用日時を差し替えて再描画する。
export function updateChart(chart, labels, values, fullTimes) {
  chart.data.labels = labels;
  chart.$fullTimes = fullTimes;
  chart.data.datasets[0].data = values;
  chart.data.datasets[0].pointRadius = labels.length > 60 ? 0 : 3;
  chart.update();
}
