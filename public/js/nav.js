// 表示範囲・ページオフセットの状態と、範囲バー／ナビバーの描画。
// 状態はこのモジュールが一元的に持ち、外部へは getter で公開する。

import { RANGES } from './config.js';

let currentRange = '24h';
// 何区間ぶん過去を見ているか。0 = 最新（ライブ）、1 以上 = 過去ページ。
let currentOffset = 0;

export const getRange  = () => currentRange;
export const getOffset = () => currentOffset;

function rangeDef() {
  return RANGES.find(r => r.key === currentRange);
}

export function isLive() {
  return currentOffset === 0;
}

// 現在見ている窓の人間向けラベル。offset=0 は「最新」、それ以外は「a〜b単位前」。
function windowLabel() {
  const r = rangeDef();
  if (isLive()) return `最新の${r.label}`;
  const near = r.count * currentOffset;
  const far  = r.count * (currentOffset + 1);
  return `${near}〜${far}${r.unitJa}前`;
}

// 範囲切り替えボタンを並べる。選択時は最新（offset=0）に戻して onChange を呼ぶ。
export function renderRangeBar(onChange) {
  const bar = document.getElementById('range-bar');
  for (const { key, label } of RANGES) {
    const btn = document.createElement('button');
    btn.className = 'range-btn' + (key === currentRange ? ' active' : '');
    btn.textContent = label;
    btn.dataset.range = key;
    btn.addEventListener('click', () => {
      if (key === currentRange) return;
      currentRange = key;
      currentOffset = 0;                 // 範囲を変えたら最新に戻す
      for (const b of bar.children) b.classList.toggle('active', b.dataset.range === key);
      onChange();
    });
    bar.appendChild(btn);
  }
}

// ページング用のナビボタン（過去へ／新しい方へ／最新へ）を作る。
export function renderNavBar(onChange) {
  const bar = document.getElementById('nav-bar');
  bar.innerHTML = `
    <button id="nav-prev" class="nav-btn" title="ひとつ過去の期間へ">← 過去へ</button>
    <span id="nav-label" class="nav-label">最新</span>
    <button id="nav-next" class="nav-btn" title="ひとつ新しい期間へ">新しい方へ →</button>
    <button id="nav-latest" class="nav-btn nav-latest" title="最新の期間に戻る">最新へ ⏭</button>
  `;
  bar.querySelector('#nav-prev').addEventListener('click', () => {
    if (!rangeDef().nav) return;
    currentOffset += 1;
    onChange();
  });
  bar.querySelector('#nav-next').addEventListener('click', () => {
    if (currentOffset === 0) return;
    currentOffset -= 1;
    onChange();
  });
  bar.querySelector('#nav-latest').addEventListener('click', () => {
    if (currentOffset === 0) return;
    currentOffset = 0;
    onChange();
  });
}

// 現在のモードに合わせてナビボタンの活性状態とラベルを更新する。
export function updateNavState() {
  const navOk = rangeDef().nav;
  const prev = document.getElementById('nav-prev');
  const next = document.getElementById('nav-next');
  const latest = document.getElementById('nav-latest');
  const label = document.getElementById('nav-label');
  if (!prev) return;

  prev.disabled = !navOk;                       // 全期間表示中は遡れない
  next.disabled = currentOffset === 0;          // 最新では「新しい方へ」不可
  latest.disabled = currentOffset === 0;        // 最新では「最新へ」不要
  label.textContent = navOk ? windowLabel() : '全期間';
  label.classList.toggle('historical', !isLive());
}
