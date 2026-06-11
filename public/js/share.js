// SNS への共有（Web Intent / share URL）。現在値から投稿文を作り、
// 各 SNS の投稿画面を新しいタブで開く。トークン不要で、投稿の確定はユーザーが SNS 側で行う。
// Mastodon / Misskey はインスタンスが人によって違うため、ポップアップで選択・入力してもらい
// localStorage に履歴を保存して次回からワンクリックで選べるようにする。

import { DEFAULT_INSTANCES } from './config.js';

// 共有先の定義。build は encodeURIComponent 済みテキスト（と instanceKey 持ちならドメイン）から
// 投稿画面 URL を返す。instanceKey があるものはクリック時にインスタンス選択ポップアップを挟む。
const TARGETS = [
  { key: 'x',        label: 'X',        build: t => `https://x.com/intent/post?text=${t}` },
  { key: 'bluesky',  label: 'Bluesky',  build: t => `https://bsky.app/intent/compose?text=${t}` },
  { key: 'mastodon', label: 'Mastodon', instanceKey: 'mastodon', build: (t, d) => `https://${d}/share?text=${t}` },
  { key: 'misskey',  label: 'Misskey',  instanceKey: 'misskey',  build: (t, d) => `https://${d}/share?text=${t}` },
];

// 現在値から投稿文を組み立てる。null の項目（CO2 非搭載のデバイスなど）は行ごと省く。
export function buildShareText({ name, time, temperature, humidity, co2 }) {
  const lines = [`【${name}】${time ? ` ${time}` : ''}`];
  if (temperature != null) lines.push(`🌡️ 温度: ${temperature}°C`);
  if (humidity    != null) lines.push(`💧 湿度: ${humidity}%`);
  if (co2         != null) lines.push(`🟢 CO2: ${co2}ppm`);
  lines.push('#SwitchBot');
  return lines.join('\n');
}

// 入力されたインスタンスをドメインだけに正規化する（スキーム・パス・空白を除去）。
export function normalizeDomain(input) {
  return input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

// ---- インスタンス履歴（localStorage） ----

const STORAGE_PREFIX = 'share-instances:';

// 使った順の履歴を返す。未保存（または壊れた値）ならデフォルト候補。
function loadInstances(instanceKey) {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_PREFIX + instanceKey));
    if (Array.isArray(arr) && arr.length) return arr;
  } catch { /* 壊れた値はデフォルトにフォールバック */ }
  return DEFAULT_INSTANCES[instanceKey] ?? [];
}

// 使ったドメインを履歴の先頭へ（重複は除去、最大 8 件）。
function saveInstance(instanceKey, domain) {
  const arr = [domain, ...loadInstances(instanceKey).filter(d => d !== domain)].slice(0, 8);
  localStorage.setItem(STORAGE_PREFIX + instanceKey, JSON.stringify(arr));
}

function removeInstance(instanceKey, domain) {
  const arr = loadInstances(instanceKey).filter(d => d !== domain);
  localStorage.setItem(STORAGE_PREFIX + instanceKey, JSON.stringify(arr));
}

// ---- 投稿画面を開く ----

function openShareWindow(target, text, domain) {
  if (target.instanceKey) saveInstance(target.instanceKey, domain);
  window.open(target.build(encodeURIComponent(text), domain), '_blank', 'noopener');
}

// ---- インスタンス選択ポップアップ ----

function openInstancePicker(target, text) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-title">${target.label} のインスタンス</div>
    <div class="instance-list"></div>
    <div class="instance-input-row">
      <input class="instance-input" type="text" placeholder="例: ${(DEFAULT_INSTANCES[target.instanceKey] ?? [])[0] ?? 'example.com'}" spellcheck="false">
      <button type="button" class="modal-btn modal-btn-primary instance-open">開く</button>
    </div>
    <div class="modal-actions">
      <button type="button" class="modal-btn instance-cancel">キャンセル</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  // 履歴リスト。ドメインをクリックで即投稿画面へ、× で履歴から削除。
  const list = modal.querySelector('.instance-list');
  function renderList() {
    list.innerHTML = '';
    for (const domain of loadInstances(target.instanceKey)) {
      const row = document.createElement('div');
      row.className = 'instance-item';

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'instance-pick';
      pick.textContent = domain;
      pick.addEventListener('click', () => { openShareWindow(target, text, domain); close(); });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'instance-del';
      del.textContent = '×';
      del.title = '履歴から削除';
      del.addEventListener('click', () => { removeInstance(target.instanceKey, domain); renderList(); });

      row.append(pick, del);
      list.appendChild(row);
    }
  }
  renderList();

  // 新規入力。Enter または「開く」で確定。
  const input = modal.querySelector('.instance-input');
  const submit = () => {
    const domain = normalizeDomain(input.value);
    if (!domain) { input.focus(); return; }
    openShareWindow(target, text, domain);
    close();
  };
  modal.querySelector('.instance-open').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  modal.querySelector('.instance-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });

  input.focus();
}

// ---- 共有ボタン群 ----

// デバイス 1 台ぶんの共有ボタン群を生成する。
// クリックのたびに getLatest() で最新値を取り直すので、自動更新後も常に現在値を投稿できる。
export function buildShareButtons(getLatest) {
  const wrap = document.createElement('div');
  wrap.className = 'share-row';

  const label = document.createElement('span');
  label.className = 'share-label';
  label.textContent = '共有:';
  wrap.appendChild(label);

  for (const target of TARGETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'share-btn';
    btn.textContent = target.label;
    btn.title = `${target.label} に現在値を投稿`;
    btn.addEventListener('click', () => {
      const text = buildShareText(getLatest());
      if (target.instanceKey) openInstancePicker(target, text);
      else openShareWindow(target, text);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}
