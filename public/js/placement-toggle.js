// デバイスの設置場所（室内 / 屋外）を切り替えるトグル UI。
// 切替時にサーバーへ PUT し、成功したら onChange(placement) を呼んで服装提案を更新する。
// 室内 / 屋外で服装の判定ロジックが切り替わる（clothing.js を参照）。

const PLACEMENT_OPTIONS = [
  { value: 'indoor',  label: '室内' },
  { value: 'outdoor', label: '屋外' },
];

// 設置場所をサーバーに保存する。失敗時は例外を投げる（呼び出し側で UI を戻す）。
async function savePlacement(deviceId, placement) {
  const res = await fetch(`/api/devices/${deviceId}/placement`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placement }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 室内 / 屋外のセグメント型トグルを生成する。
// 選択を切り替えると楽観的に表示を更新し、PUT が失敗したら元に戻す。
export function buildPlacementToggle(deviceId, current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'placement-toggle';

  const buttons = new Map();
  let value = current;

  const setActive = (v) => {
    value = v;
    for (const [pv, btn] of buttons) btn.classList.toggle('active', pv === v);
  };
  const setDisabled = (d) => {
    for (const btn of buttons.values()) btn.disabled = d;
  };

  for (const { value: pv, label } of PLACEMENT_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'placement-btn';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      if (pv === value) return;
      const prev = value;
      setActive(pv);                 // 先に表示へ反映（楽観的更新）
      setDisabled(true);
      try {
        await savePlacement(deviceId, pv);
        onChange(pv);
      } catch {
        setActive(prev);             // 保存に失敗したら元の選択へ戻す
      } finally {
        setDisabled(false);
      }
    });
    buttons.set(pv, btn);
    wrap.appendChild(btn);
  }

  setActive(current);
  return wrap;
}
