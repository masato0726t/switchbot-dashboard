// デバイスの設置場所（室内 / 屋外）に関する規則。DB にも HTTP にも依存しない。

export type Placement = 'indoor' | 'outdoor';

export const PLACEMENTS: readonly Placement[] = ['indoor', 'outdoor'];

// 設置場所が未設定のときの初期推測。SwitchBot の防水温湿度計（device_type に
// "IO" を含む WoIOSensor 系）は屋外設置の可能性が高いので outdoor、それ以外は
// indoor を初期値にする。あくまで推測で、最終的にはユーザーが画面から上書きする。
export function defaultPlacement(type: string | null | undefined): Placement {
  return typeof type === 'string' && type.includes('IO') ? 'outdoor' : 'indoor';
}

export function isValidPlacement(value: unknown): value is Placement {
  return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value);
}
