'use strict';

// デバイスの設置場所（室内 / 屋外）に関する純粋ロジック。DB には依存しない。

// 有効な設置場所。これ以外は不正値として弾く。
const PLACEMENTS = ['indoor', 'outdoor'];

// 設置場所が未設定のときの初期推測。SwitchBot の防水温湿度計（device_type に
// "IO" を含む WoIOSensor 系）は屋外設置の可能性が高いので outdoor、それ以外は
// indoor を初期値にする。あくまで推測で、最終的にはユーザーが画面から上書きする。
function defaultPlacement(type) {
  return typeof type === 'string' && type.includes('IO') ? 'outdoor' : 'indoor';
}

// 設置場所として妥当な値かどうか。
function isValidPlacement(value) {
  return PLACEMENTS.includes(value);
}

module.exports = { PLACEMENTS, defaultPlacement, isValidPlacement };
