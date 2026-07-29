// デバイスの設置場所（室内 / 屋外）に関する規則。DB にも HTTP にも依存しない。

export type Placement = 'indoor' | 'outdoor';

// 設置場所が未設定のときの初期推測。SwitchBot の防水温湿度計（device_type に
// "IO" を含む WoIOSensor 系）は屋外設置の可能性が高いので outdoor、それ以外は
// indoor を初期値にする。あくまで推測で、最終的にはユーザーが画面から上書きする。
export function defaultPlacement(type: string | null | undefined): Placement {
  return typeof type === 'string' && type.includes('IO') ? 'outdoor' : 'indoor';
}

// 値の妥当性検査は presentation/routes/placement.ts が
// shared/api-contract.ts の PlacementUpdateRequestSchema（zod）で行う。
// かつてここにあった isValidPlacement / PLACEMENTS はそれと重複する
// 検証経路で、HTTP 境界からは呼ばれず自分のテストからしか使われていなかった
// ため削除した（レビュー対応: 検証は zod のスキーマ 1 箇所に一本化する）。
