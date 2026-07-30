# 体感ベース制御の設定 UI 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 設計書: `docs/superpowers/specs/2026-07-30-ac-comfort-settings-ui-design.md`

**Goal:** 制御ツールが増やした 5 つの設定を画面から編集できるようにし、誤設定すると挙動が逆になる `allowed_modes` の罠を UI とスキーマの両方で塞ぐ。

**Architecture:** 既存の構造をそのまま踏襲する。`src/shared` の zod スキーマをサーバーとクライアントの両方が使い、`AC_LIMITS` に範囲を集約し、DB の列名（snake_case）をそのまま契約に通す。設定値どうしの関係の警告だけは新しく、純粋な述語を `src/shared` に置いてクライアントが入力中に呼ぶ。

**Tech Stack:** TypeScript / zod / Kysely / Vue 3 / vitest

## Global Constraints

- コメント・UI 文言・エラーメッセージはすべて日本語
- `src/shared` は DB にも HTTP にも Vue にも依存しない
- DB の列名は snake_case のまま契約に通す。サーバーの domain だけ camelCase
- `ac_control_rules` の所有者は制御ツール `auto-air-conditioner`。`ddl/` にあるのは参照用の写しで、ダッシュボードは実行しない
- 各タスクの終わりで `npm run lint`、`npm run typecheck`、`npm test` が通ること
- 作業ブランチは `feature/comfort-settings-ui`（作成済み・設計書コミット済み）

## 追加・変更される列

| 列 | 型 | 既定 | 意味 |
|---|---|---|---|
| `base_humidity` | TINYINT | 50 | 目標温度が前提とする湿度(%) |
| `comfort_adjust_max` | DECIMAL(2,1) | 1.5 | 湿度による目標温度の補正上限(±℃)。0 で補正なし |
| `setpoint_offset` | DECIMAL(2,1) | 2.0 | 設定温度を目標からずらす幅(℃)。0 で目標と同じ |
| `fan_boost_threshold` | DECIMAL(2,1) | 2.0 | 風量を強にする偏差(℃)。中はこの半分 |
| `allowed_modes` | TINYINT | 7 | 許可する運転のビット和(1=冷房 2=ドライ 4=暖房) |
| `fan_speed` | TINYINT | 1 | **NULL 許容に変更。** NULL なら偏差から自動判別 |

## ファイル構成

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/shared/air-conditioner.ts` | 変更 | 範囲・ビット定数・警告の述語 |
| `src/shared/air-conditioner.test.ts` | 新規 | 述語のテスト |
| `src/shared/ac-contract.ts` | 変更 | zod スキーマ |
| `src/shared/ac-contract.test.ts` | 変更 | スキーマのテスト |
| `ddl/ac_control_rules.sql` | 変更 | 参照用の写し |
| `src/server/domain/ac-rule.ts` | 変更 | `AcRule` の型 |
| `src/server/infrastructure/db/schema.ts` | 変更 | Kysely のテーブル型 |
| `src/server/infrastructure/db/ac-rule.repository.ts` | 変更 | SELECT と書き込み |
| `src/client/RuleForm.vue` | 変更 | fieldset 4 分割・5 欄・警告 |
| `src/client/App.vue` | 変更 | 新規ルールの既定値 |
| `src/client/RuleCard.vue` | 変更 | 編集開始時の初期値 |

---

## Task 1: 共有の定数・スキーマ・警告の述語

`src/shared` だけで閉じる。サーバーもクライアントも触らないので、この時点では
まだ型エラーが出る（`AcRuleInput` に増えたフィールドを渡していない箇所がある）。
**Task 1 の完了条件は `npm run test:backend` が通ることまでで、`typecheck` は
Task 2 以降で通す。**

**Files:**
- Modify: `src/shared/air-conditioner.ts`
- Modify: `src/shared/ac-contract.ts`
- Create: `src/shared/air-conditioner.test.ts`
- Modify: `src/shared/ac-contract.test.ts`

**Interfaces:**
- Produces:
  - `MODE_BITS = { cool: 1, dry: 2, heat: 4 }` と `ALL_MODES = 7`
  - `AC_LIMITS` に `baseHumidityMin/Max`・`comfortAdjustMaxMin/Max`・`setpointOffsetMin/Max`・`fanBoostThresholdMin/Max`・`allowedModesMin/Max`・`decimalStep`
  - `isFanLowUnreachable(fanSpeed: number | null, fanBoostThreshold: number, tempHysteresis: number): boolean`
  - `isBaseHumidityTooHigh(comfortAdjustMax: number, baseHumidity: number, humidityMax: number | null, humidityHysteresis: number): boolean`
  - `AcRuleInput` に 5 フィールド追加、`fan_speed` が `number | null`
- Note: `AC_LIMITS.tempHysteresisStep` は `decimalStep` へ改名する。値は 0.5 のまま
  で挙動は変わらない。新しい 3 つの小数も同じ刻みなので、同じ値の定数を 4 つ並べる
  より 1 つにまとめる

- [ ] **Step 1: 警告の述語の失敗するテストを書く**

`src/shared/air-conditioner.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest';
import { isBaseHumidityTooHigh, isFanLowUnreachable } from './air-conditioner.js';

describe('isFanLowUnreachable', () => {
  // 冷暖の運転開始には偏差が許容幅を超える必要があり、中に上がる閾値は
  // 強風閾値の半分。強風閾値が許容幅の 2 倍以下だと弱の段に届かない。
  it('自動判別で強風閾値が許容幅の2倍を下回るなら弱が使われない', () => {
    expect(isFanLowUnreachable(null, 1.5, 1.0)).toBe(true);
  });

  it('境界ちょうど（許容幅の2倍）でも弱は使われない', () => {
    expect(isFanLowUnreachable(null, 2.0, 1.0)).toBe(true);
  });

  it('強風閾値を許容幅の2倍より大きくすれば弱が使える', () => {
    expect(isFanLowUnreachable(null, 2.5, 1.0)).toBe(false);
  });

  // 風量が固定なら強風閾値は参照されない。既定の「エアコンにまかせる」で
  // 警告が出ると、利用者が警告を読み飛ばす癖をつける。
  it('風量が固定なら警告しない', () => {
    expect(isFanLowUnreachable(1, 2.0, 1.0)).toBe(false);
    expect(isFanLowUnreachable(4, 2.0, 1.0)).toBe(false);
  });
});

describe('isBaseHumidityTooHigh', () => {
  // 基準湿度が「湿度上限 − 許容幅」以上だと、基準の状態が常にドライの
  // 継続条件を満たす。基準を部屋のふだんの湿度に合わせる運用での誤設定。
  it('基準湿度が湿度上限から許容幅を引いた値以上なら警告する', () => {
    expect(isBaseHumidityTooHigh(1.5, 55, 60, 5)).toBe(true);
  });

  it('境界の内側なら警告しない', () => {
    expect(isBaseHumidityTooHigh(1.5, 54, 60, 5)).toBe(false);
  });

  // 補正上限が 0 なら基準湿度は参照されない。
  it('補正しない設定なら警告しない', () => {
    expect(isBaseHumidityTooHigh(0, 55, 60, 5)).toBe(false);
  });

  // 湿度上限が未設定ならドライは動かない。
  it('湿度上限が未設定なら警告しない', () => {
    expect(isBaseHumidityTooHigh(1.5, 55, null, 5)).toBe(false);
  });
});

describe('新規ルールの既定値', () => {
  // 既定で警告が出る状態は、警告を読み飛ばす癖をつけるので避ける。
  // 既定は 目標25 / 基準湿度50 / 補正上限1.5 / 許容幅1.0 / 湿度上限60 /
  // 湿度許容幅5 / 強風閾値2.0 / 風量1（エアコンにまかせる）。
  it('どちらの警告も出ない', () => {
    expect(isFanLowUnreachable(1, 2.0, 1.0)).toBe(false);
    expect(isBaseHumidityTooHigh(1.5, 50, 60, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```
npx vitest run src/shared/air-conditioner.test.ts
```

期待: `isFanLowUnreachable` が未定義でインポートエラー。

- [ ] **Step 3: 定数と述語を実装する**

`src/shared/air-conditioner.ts` の `FAN_SPEEDS` の下に足す。

```ts
/**
 * 許可する運転モードのビット。制御ツールの ModeSet と同じ並び。
 *
 * ゼロ値は制御ツール側で「未設定＝全許可」として扱われる。写し忘れた経路が
 * あってもルールが黙って沈黙しないようにする防御だが、そのぶん 0 を保存すると
 * 全部止めたつもりで全部動く。保存前に弾くこと。
 */
export const MODE_BITS = { cool: 1, dry: 2, heat: 4 } as const;
export const ALL_MODES = MODE_BITS.cool | MODE_BITS.dry | MODE_BITS.heat;
```

`AC_LIMITS` の `tempHysteresisStep: 0.5,` の行を消し、代わりに次を足す（並びは
既存の順序に合わせ、`tempHysteresisMax` の直後に `decimalStep` を置く）。

```ts
  /** 温度系の小数入力の刻み。setAll に渡る前に制御ツールが丸めるので細かすぎる値を許さない。 */
  decimalStep: 0.5,
  baseHumidityMin: 1,
  baseHumidityMax: 99,
  comfortAdjustMaxMin: 0,
  comfortAdjustMaxMax: 5,
  setpointOffsetMin: 0,
  setpointOffsetMax: 5,
  fanBoostThresholdMin: 0.5,
  fanBoostThresholdMax: 5,
  allowedModesMin: 1,
  allowedModesMax: ALL_MODES,
```

ファイル末尾に述語を足す。

```ts
/**
 * 風量「弱」が到達不能な組み合わせかを返す。
 *
 * 冷暖の運転開始には偏差が温度の許容幅を超える必要があり、中へ上がる閾値は
 * 強風閾値の半分。したがって強風閾値が許容幅の 2 倍以下だと、弱の段には
 * 決して落ちない。風量が固定のときは強風閾値そのものが参照されないので
 * 警告しない。
 */
export function isFanLowUnreachable(
  fanSpeed: number | null,
  fanBoostThreshold: number,
  tempHysteresis: number,
): boolean {
  if (fanSpeed !== null) return false;
  return fanBoostThreshold <= tempHysteresis * 2;
}

/**
 * 基準湿度が高すぎて、基準の状態が常にドライ運転の条件を満たすかを返す。
 *
 * 基準湿度は「その部屋のふだんの湿度」に合わせる設定だが、湿度上限に近づけると
 * 補正が効いている状態が常にドライの継続条件（湿度 > 上限 − 許容幅）に入る。
 * 補正しない設定や、湿度上限が未設定でドライが動かない場合は警告しない。
 */
export function isBaseHumidityTooHigh(
  comfortAdjustMax: number,
  baseHumidity: number,
  humidityMax: number | null,
  humidityHysteresis: number,
): boolean {
  if (comfortAdjustMax <= 0 || humidityMax === null) return false;
  return baseHumidity >= humidityMax - humidityHysteresis;
}
```

- [ ] **Step 4: 述語のテストが通ることを確認する**

```
npx vitest run src/shared/air-conditioner.test.ts
```

期待: PASS

- [ ] **Step 5: スキーマの失敗するテストを書く**

`src/shared/ac-contract.test.ts` の `validRule` に 5 つ足す（`fan_speed: 1,` の直後）。

```ts
    base_humidity: 50,
    comfort_adjust_max: 1.5,
    setpoint_offset: 2,
    fan_boost_threshold: 2,
    allowed_modes: 7,
```

同ファイルの末尾に足す。

```ts
describe('AcRuleInputSchema の体感ベース制御の設定', () => {
  // ゼロ値は制御ツールが「全許可」として扱う。全部止めるつもりで 0 を
  // 保存すると全部動く。ここで弾く。
  it('許可する運転が 0 なら弾く', () => {
    const result = AcRuleInputSchema.safeParse(validRule({ allowed_modes: 0 }));
    expect(result.success).toBe(false);
  });

  it('許可する運転は 1 から 7 まで通る', () => {
    for (const value of [1, 3, 6, 7]) {
      expect(AcRuleInputSchema.safeParse(validRule({ allowed_modes: value })).success).toBe(true);
    }
  });

  it('許可する運転が 8 以上なら弾く', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ allowed_modes: 8 })).success).toBe(false);
  });

  // NULL は「偏差から自動判別」を意味する。
  it('風量が null なら通る', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ fan_speed: null })).success).toBe(true);
  });

  it('基準湿度は 1 から 99 まで', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 1 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 99 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 0 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ base_humidity: 100 })).success).toBe(false);
  });

  it('小数の設定は 0.5 刻みでなければ弾く', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ comfort_adjust_max: 1.2 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ setpoint_offset: 2.3 })).success).toBe(false);
    expect(AcRuleInputSchema.safeParse(validRule({ fan_boost_threshold: 1.7 })).success).toBe(false);
  });

  it('補正上限とオフセットは 0 を許す', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ comfort_adjust_max: 0 })).success).toBe(true);
    expect(AcRuleInputSchema.safeParse(validRule({ setpoint_offset: 0 })).success).toBe(true);
  });

  // 制御ツールは 0（常に強）も受け付けるが、UI から縮退設定を勧める理由がない。
  it('強風閾値の 0 は弾く', () => {
    expect(AcRuleInputSchema.safeParse(validRule({ fan_boost_threshold: 0 })).success).toBe(false);
  });
});
```

- [ ] **Step 6: テストが失敗することを確認する**

```
npx vitest run src/shared/ac-contract.test.ts
```

期待: `許可する運転が 0 なら弾く` などが FAIL（未知のキーは zod が無視するため
`allowed_modes: 0` が通ってしまう）。

- [ ] **Step 7: スキーマを実装する**

`src/shared/ac-contract.ts` の分割代入（9-18 行）を差し替える。

```ts
const {
  targetTempMin, targetTempMax,
  humidityMin, humidityMax,
  tempHysteresisMin, tempHysteresisMax, decimalStep,
  humidityHysteresisMin, humidityHysteresisMax,
  minIntervalMin, minIntervalMax,
  resendIntervalMin, resendIntervalMax,
  sensorMaxAgeMin, sensorMaxAgeMax,
  baseHumidityMin, baseHumidityMax,
  comfortAdjustMaxMin, comfortAdjustMaxMax,
  setpointOffsetMin, setpointOffsetMax,
  fanBoostThresholdMin, fanBoostThresholdMax,
  allowedModesMin, allowedModesMax,
  snoozeHoursMax,
} = AC_LIMITS;
```

`FanSpeedSchema` の下に共通のヘルパーを足す。

```ts
/** 0.5 刻みの℃を受ける。制御ツールが送信前に整数へ丸めるので、細かすぎる値を許さない。 */
function halfStep(min: number, max: number, label: string) {
  return z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Number.isInteger(v / decimalStep), {
      message: `${label}は ${decimalStep} 刻みで指定してください`,
    });
}
```

`AcRuleInputSchema` の `temp_hysteresis` をヘルパーに置き換え、`fan_speed` を
nullable にし、5 つを足す。

```ts
    temp_hysteresis: halfStep(tempHysteresisMin, tempHysteresisMax, '温度の許容幅'),
```

```ts
    fan_speed: FanSpeedSchema.nullable(),
    base_humidity: z.number().int().min(baseHumidityMin).max(baseHumidityMax),
    comfort_adjust_max: halfStep(comfortAdjustMaxMin, comfortAdjustMaxMax, '補正の上限'),
    setpoint_offset: halfStep(setpointOffsetMin, setpointOffsetMax, '設定温度のオフセット'),
    fan_boost_threshold: halfStep(fanBoostThresholdMin, fanBoostThresholdMax, '強風の閾値'),
    // 0 は制御ツールが「未設定＝全許可」として扱う。全部止めるつもりの 0 が
    // 全許可になるのを避けるため、ここで弾いて enabled へ誘導する。
    allowed_modes: z
      .number()
      .int()
      .min(allowedModesMin, '運転を少なくとも 1 つ許可してください。すべて止めるなら自動制御を無効にしてください')
      .max(allowedModesMax),
```

`AcRuleSchema`（応答 DTO）の `fan_speed: z.number().int(),` を差し替え、5 つを足す。

```ts
  fan_speed: z.number().int().nullable(),
  base_humidity: z.number().int(),
  comfort_adjust_max: z.number(),
  setpoint_offset: z.number(),
  fan_boost_threshold: z.number(),
  allowed_modes: z.number().int(),
```

- [ ] **Step 8: テストが通ることを確認する**

```
npm run test:backend
```

期待: すべて PASS。**`npm run typecheck` はまだ通らない**（サーバーとクライアントが
新しいフィールドを渡していないため）。Task 2 以降で通す。

- [ ] **Step 9: コミット**

```bash
git add src/shared/
git commit -m "feat: 体感ベース制御の設定を契約に足し、許可モードのゼロ値を弾く"
```

---

## Task 2: サーバーと参照用 DDL

**Files:**
- Modify: `ddl/ac_control_rules.sql`
- Modify: `src/server/domain/ac-rule.ts`
- Modify: `src/server/infrastructure/db/schema.ts`
- Modify: `src/server/infrastructure/db/ac-rule.repository.ts`
- Modify: `src/server/application/get-ac-rules.ts`（DTO の組み立て）

**Interfaces:**
- Consumes: Task 1 の `AcRuleInput`（5 フィールド追加・`fan_speed` は `number | null`）
- Produces: `AcRule` に `baseHumidity: number` / `comfortAdjustMax: number` /
  `setpointOffset: number` / `fanBoostThreshold: number` / `allowedModes: number`、
  `fanSpeed: number | null`

- [ ] **Step 1: 参照用 DDL を実物に合わせる**

`ddl/ac_control_rules.sql` の `fan_speed` の行を差し替え、その下に 5 列足す。
制御ツールのマイグレーション（`00002`〜`00004`）と同じ既定値・COMMENT にすること。

```sql
    fan_speed            TINYINT      NULL DEFAULT 1 COMMENT '固定風量(1=自動 2=弱 3=中 4=強)。NULLなら偏差から自動判別',
    base_humidity        TINYINT      NOT NULL DEFAULT 50 COMMENT '目標温度が前提とする湿度(%)。部屋のふだんの湿度に合わせる',
    comfort_adjust_max   DECIMAL(2,1) NOT NULL DEFAULT 1.5 COMMENT '湿度による目標温度の補正上限(±℃)。0で補正しない',
    setpoint_offset      DECIMAL(2,1) NOT NULL DEFAULT 2.0 COMMENT 'エアコンへ送る設定温度を目標からずらす幅(℃)。0で目標と同じ',
    fan_boost_threshold  DECIMAL(2,1) NOT NULL DEFAULT 2.0 COMMENT '風量を強にする偏差(℃)。中はこの半分',
    allowed_modes        TINYINT      NOT NULL DEFAULT 7 COMMENT '許可する運転モードのビット和(1=冷房 2=ドライ 4=暖房)',
```

- [ ] **Step 2: Kysely のテーブル型を直す**

`src/server/infrastructure/db/schema.ts` の `AcControlRulesTable` で
`fan_speed: number;` を差し替え、5 つ足す。DECIMAL は mysql2 が文字列で返す
ことがあるため、既存の `temp_hysteresis` と同じく両方を受ける。

```ts
  /** NULL は「偏差から自動判別」を意味する */
  fan_speed: number | null;
  base_humidity: number;
  /** DECIMAL 列。mysql2 は文字列で返すことがあるため両方を受ける */
  comfort_adjust_max: number | string;
  setpoint_offset: number | string;
  fan_boost_threshold: number | string;
  allowed_modes: number;
```

- [ ] **Step 3: ドメインの型を直す**

`src/server/domain/ac-rule.ts` の `AcRule` で `fanSpeed: number;` を差し替え、
5 つ足す。

```ts
  fanSpeed: number | null;
  baseHumidity: number;
  comfortAdjustMax: number;
  setpointOffset: number;
  fanBoostThreshold: number;
  allowedModes: number;
```

- [ ] **Step 4: リポジトリの読み書きに列を足す**

`ac-rule.repository.ts` の `selectRuleRows` の SELECT に足す（`'r.fan_speed',` の直後）。

```ts
        'r.base_humidity', 'r.comfort_adjust_max', 'r.setpoint_offset',
        'r.fan_boost_threshold', 'r.allowed_modes',
```

`listRules` の写しで `fanSpeed: row.fan_speed,` の直後に足す。DECIMAL の 3 つは
既存の `tempHysteresis` と同じく `toNumber` を通す。

```ts
        baseHumidity: row.base_humidity,
        comfortAdjustMax: toNumber(row.comfort_adjust_max),
        setpointOffset: toNumber(row.setpoint_offset),
        fanBoostThreshold: toNumber(row.fan_boost_threshold),
        allowedModes: row.allowed_modes,
```

`toRuleValues` の `fan_speed: input.fan_speed,` の直後に足す。

```ts
      base_humidity: input.base_humidity,
      comfort_adjust_max: input.comfort_adjust_max,
      setpoint_offset: input.setpoint_offset,
      fan_boost_threshold: input.fan_boost_threshold,
      allowed_modes: input.allowed_modes,
```

- [ ] **Step 5: DTO の組み立てに足す**

写しは `src/server/application/get-ac-rules.ts` ではなく
`src/server/presentation/ac-dto.ts` にある（`get-ac-rules.ts` は導出フラグを
添えるだけで、列の写しはしない）。

`ac-dto.ts` の `fan_speed: rule.fanSpeed,` の直後に足す。

```ts
    base_humidity: rule.baseHumidity,
    comfort_adjust_max: rule.comfortAdjustMax,
    setpoint_offset: rule.setpointOffset,
    fan_boost_threshold: rule.fanBoostThreshold,
    allowed_modes: rule.allowedModes,
```

`fan_speed: rule.fanSpeed,` は型が `number | null` になるだけで、行そのものは
変えない。

**写し漏れると画面には出ないまま保存時にゼロ値が飛ぶ。** `allowed_modes` は
ゼロ値が「全許可」として扱われるので、**写し忘れても表面上は動いてしまい、
設定した許可モードが黙って無視される。** 5 つすべてが繋がっていることを、
次の Step で必ず確認すること。

- [ ] **Step 6: 統合テストに往復を足す**

`src/server/infrastructure/db/repositories.integration.test.ts` にルールの
往復（作成 → 取得）を見ているテストがあれば、5 列を足して落ちないことを固定する。

**期待値はゼロ値と区別できる値にすること。** `allowed_modes` を全許可の `7` に
すると、写し忘れてゼロ値になった場合と挙動で区別がつかない。**冷房＋暖房の `5`**
を使う。`fan_speed` は `null` を往復させるケースも足す。

このテストは `vitest.integration.config.ts` で動き、実 DB が要るため
`npm test` には含まれない。**実行できない環境なら、その旨を報告に明記すること。**
「テストを足した」と「テストが通った」を混同しないこと。

- [ ] **Step 7: 型と既存テストを通す**

```
npm run lint && npm run typecheck && npm test
```

期待: すべて通る。**クライアントの型エラーが出る場合は Task 3 の範囲なので、
`typecheck` のうち `vue-tsc` の失敗だけは Task 3 まで残ってよい。** サーバー側
（`tsc -p tsconfig.json`）が通ればこのタスクは完了。既存のリポジトリテストが
新しい列で落ちる場合は、直す前に報告すること。

- [ ] **Step 8: コミット**

```bash
git add ddl/ src/server/
git commit -m "feat: 体感ベース制御の設定をサーバーで読み書きする"
```

---

## Task 3: 設定画面

**Files:**
- Modify: `src/client/App.vue`
- Modify: `src/client/RuleCard.vue`
- Modify: `src/client/RuleForm.vue`

**Interfaces:**
- Consumes: Task 1 の `AC_LIMITS`・`MODE_BITS`・`ALL_MODES`・
  `isFanLowUnreachable`・`isBaseHumidityTooHigh`、Task 2 の DTO

- [ ] **Step 1: 新規ルールの既定値を足す**

`src/client/App.vue` の `newRuleInput()` で `fan_speed: 1,` の直後に足す。

```ts
    base_humidity: 50,
    comfort_adjust_max: 1.5,
    setpoint_offset: 2,
    fan_boost_threshold: 2,
    allowed_modes: 7,
```

`fan_speed` は `1`（エアコンにまかせる）のままにする。制御ツール側の DB 既定と
揃え、風量の自動判別はオプトインという方針を崩さないため。

- [ ] **Step 2: 編集開始時の初期値を足す**

`src/client/RuleCard.vue` の `toInput()` で `fan_speed: rule.fan_speed,` の直後に足す。

```ts
    base_humidity: rule.base_humidity,
    comfort_adjust_max: rule.comfort_adjust_max,
    setpoint_offset: rule.setpoint_offset,
    fan_boost_threshold: rule.fan_boost_threshold,
    allowed_modes: rule.allowed_modes,
```

- [ ] **Step 3: フォームのスクリプト部を直す**

`src/client/RuleForm.vue` の `<script setup>` を差し替える。`onNumber` のキーから
`'fan_speed'` を外し（null を扱えないため）、専用のハンドラを足す。

```ts
import { computed } from 'vue';
import {
  AC_LIMITS, MODE_BITS,
  isAirConditionerType, isBaseHumidityTooHigh, isFanLowUnreachable,
} from '../shared/air-conditioner.js';
import type { AcDeviceOptionDto, AcRuleInput } from '../shared/ac-contract.js';
import ScheduleEditor from './ScheduleEditor.vue';

const input = defineModel<AcRuleInput>({ required: true });

function patch(changes: Partial<AcRuleInput>) {
  input.value = { ...input.value, ...changes };
}

function onNumber(key: 'ac_device_id' | 'sensor_device_id' | 'default_target_temp'
  | 'temp_hysteresis' | 'humidity_hysteresis' | 'min_interval_min'
  | 'resend_interval_min' | 'sensor_max_age_min'
  | 'base_humidity' | 'comfort_adjust_max' | 'setpoint_offset'
  | 'fan_boost_threshold', event: Event) {
  patch({ [key]: Number((event.target as HTMLInputElement | HTMLSelectElement).value) });
}

function onNullableNumber(key: 'default_humidity_max' | 'default_humidity_min', event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  patch({ [key]: raw === '' ? null : Number(raw) });
}

/** 風量は空文字を null（偏差から自動判別）に読み替える。 */
function onFanSpeed(event: Event) {
  const raw = (event.target as HTMLSelectElement).value;
  patch({ fan_speed: raw === '' ? null : Number(raw) });
}

/**
 * 許可する運転のビットを立て下げする。
 *
 * 全部外した 0 も、そのまま入力値に反映して画面と保存値を一致させる。
 * 保存は zod が弾き、下の注記で「全部止めるなら自動制御を無効に」と導く。
 * クリックを無視すると、なぜチェックが外れないのかが分からなくなる。
 */
function toggleMode(bit: number, event: Event) {
  const on = (event.target as HTMLInputElement).checked;
  const current = input.value.allowed_modes;
  patch({ allowed_modes: on ? current | bit : current & ~bit });
}

const hasMode = (bit: number) => (input.value.allowed_modes & bit) !== 0;

const noModeSelected = computed(() => input.value.allowed_modes === 0);

const fanLowUnreachable = computed(() =>
  isFanLowUnreachable(input.value.fan_speed, input.value.fan_boost_threshold, input.value.temp_hysteresis),
);

const baseHumidityTooHigh = computed(() =>
  isBaseHumidityTooHigh(
    input.value.comfort_adjust_max,
    input.value.base_humidity,
    input.value.default_humidity_max,
    input.value.humidity_hysteresis,
  ),
);

const props = defineProps<{
  airConditioners: AcDeviceOptionDto[];
  sensors: AcDeviceOptionDto[];
}>();

// 候補は赤外線リモコン全部（照明なども混ざる）。種別が分かるものは併記して選びやすくする。
const deviceLabel = (device: AcDeviceOptionDto) => {
  const name = device.device_name ?? `(名前なし #${device.id})`;
  return device.device_type ? `${name}（${device.device_type}）` : name;
};

// 種別が 1 つも分からないときだけ、名前で選ぶしかない旨を案内する。
const typesUnknown = computed(() =>
  props.airConditioners.length > 0 && props.airConditioners.every((d) => !d.device_type),
);

const selectedIsAirConditioner = computed(() => {
  const selected = props.airConditioners.find((d) => d.id === input.value.ac_device_id);
  return selected === undefined || !selected.device_type || isAirConditionerType(selected.device_type);
});
```

`ALL_MODES` はこのファイルでは使わないので import しない。上の import 文にも
入れていない（`AC_LIMITS.allowedModesMax` の定義に使われているだけ）。

- [ ] **Step 4: フォームのテンプレートを 4 つの fieldset に分ける**

`<template>` を差し替える。既存 12 欄はそのまま移し、5 欄を足す。

```vue
<template>
  <div class="rule-form">
    <fieldset>
      <legend>基本</legend>

      <label>
        ルール名
        <input type="text" :value="input.name" @input="patch({ name: ($event.target as HTMLInputElement).value })">
      </label>

      <label>
        エアコン
        <select :value="input.ac_device_id" @change="onNumber('ac_device_id', $event)">
          <option v-for="device in airConditioners" :key="device.id" :value="device.id">
            {{ deviceLabel(device) }}
          </option>
        </select>
        <span v-if="typesUnknown" class="hint">
          ハブに登録された赤外線リモコンをすべて表示しています。エアコンのものを名前で選んでください。
        </span>
        <span v-else-if="!selectedIsAirConditioner" class="hint warning-text">
          選んだリモコンはエアコンとして登録されていません。冷暖房の指示は届きません。
        </span>
      </label>

      <label>
        基準センサー
        <select :value="input.sensor_device_id" @change="onNumber('sensor_device_id', $event)">
          <option v-for="device in sensors" :key="device.id" :value="device.id">
            {{ deviceLabel(device) }}
          </option>
        </select>
      </label>
    </fieldset>

    <fieldset>
      <legend>目標と体感</legend>
      <p class="hint">部屋をどういう状態にしたいか。湿度が高いほど、同じ体感になる温度は低くなります。</p>

      <label>
        目標温度
        <input
          type="number"
          :min="AC_LIMITS.targetTempMin"
          :max="AC_LIMITS.targetTempMax"
          step="1"
          :value="input.default_target_temp"
          @input="onNumber('default_target_temp', $event)"
        >℃
      </label>

      <label>
        基準湿度
        <input
          type="number"
          :min="AC_LIMITS.baseHumidityMin"
          :max="AC_LIMITS.baseHumidityMax"
          step="1"
          :value="input.base_humidity"
          @input="onNumber('base_humidity', $event)"
        >%
        <span class="hint">
          目標温度が前提とする湿度です。その部屋のふだんの湿度に合わせてください。ここから離れるほど目標が補正されます。
        </span>
      </label>

      <label>
        補正の上限 ±
        <input
          type="number"
          :min="AC_LIMITS.comfortAdjustMaxMin"
          :max="AC_LIMITS.comfortAdjustMaxMax"
          :step="AC_LIMITS.decimalStep"
          :value="input.comfort_adjust_max"
          @input="onNumber('comfort_adjust_max', $event)"
        >℃
        <span class="hint">湿度で目標をずらす幅の上限です。0 にすると湿度を見ません。</span>
        <span v-if="baseHumidityTooHigh" class="hint warning-text">
          基準湿度が湿度上限に近すぎます。基準の状態が常にドライ運転の条件を満たします。
        </span>
      </label>

      <label>
        湿度上限
        <input
          type="number" min="0" max="100" step="1"
          :value="input.default_humidity_max ?? ''"
          @input="onNullableNumber('default_humidity_max', $event)"
        >%
        <span class="hint">超えるとドライ運転になります。空欄なら湿度で運転しません。</span>
      </label>

      <label>
        湿度下限
        <input
          type="number" min="0" max="100" step="1"
          :value="input.default_humidity_min ?? ''"
          @input="onNullableNumber('default_humidity_min', $event)"
        >%
        <span class="hint">エアコンでは加湿できないため、下回ったときに警告を出すだけです。</span>
      </label>

      <label>
        温度の許容幅 ±
        <input
          type="number"
          :min="AC_LIMITS.tempHysteresisMin"
          :max="AC_LIMITS.tempHysteresisMax"
          :step="AC_LIMITS.decimalStep"
          :value="input.temp_hysteresis"
          @input="onNumber('temp_hysteresis', $event)"
        >℃
        <span class="hint">目標からこれ以上ずれたら運転を始め、目標に戻ったら止めます。</span>
      </label>

      <label>
        湿度の許容幅
        <input
          type="number"
          :min="AC_LIMITS.humidityHysteresisMin"
          :max="AC_LIMITS.humidityHysteresisMax"
          step="1"
          :value="input.humidity_hysteresis"
          @input="onNumber('humidity_hysteresis', $event)"
        >%
      </label>
    </fieldset>

    <fieldset>
      <legend>操作量</legend>
      <p class="hint">エアコンに何を送るか。設定温度は目標そのものではなく、目標に届かせるための指示です。</p>

      <div class="modes">
        許可する運転
        <label class="inline">
          <input type="checkbox" :checked="hasMode(MODE_BITS.cool)" @change="toggleMode(MODE_BITS.cool, $event)">
          冷房
        </label>
        <label class="inline">
          <input type="checkbox" :checked="hasMode(MODE_BITS.dry)" @change="toggleMode(MODE_BITS.dry, $event)">
          ドライ
        </label>
        <label class="inline">
          <input type="checkbox" :checked="hasMode(MODE_BITS.heat)" @change="toggleMode(MODE_BITS.heat, $event)">
          暖房
        </label>
        <span class="hint">
          外した運転は、判定が出ても行いません。冬は冷房を外すと、湿度が高い日に冷房が入るのを防げます。
        </span>
        <span v-if="noModeSelected" class="hint warning-text">
          少なくとも 1 つ選んでください。すべて止めるなら「自動制御」を無効にしてください。
        </span>
      </div>

      <label>
        設定温度のオフセット
        <input
          type="number"
          :min="AC_LIMITS.setpointOffsetMin"
          :max="AC_LIMITS.setpointOffsetMax"
          :step="AC_LIMITS.decimalStep"
          :value="input.setpoint_offset"
          @input="onNumber('setpoint_offset', $event)"
        >℃
        <span class="hint">
          エアコンには目標よりこれだけ低い（暖房なら高い）温度を送ります。エアコンは自分のセンサーで
          設定温度に近づくと能力を絞るため、目標と同じでは届きません。0 で目標と同じになります。
        </span>
      </label>

      <label>
        風量
        <select :value="input.fan_speed ?? ''" @change="onFanSpeed($event)">
          <option value="">偏差から自動判別</option>
          <option :value="1">エアコンにまかせる</option>
          <option :value="2">弱</option>
          <option :value="3">中</option>
          <option :value="4">強</option>
        </select>
        <span class="hint">
          「偏差から自動判別」にすると、目標から離れているほど強くします。設定温度を下げるより効率よく冷えます。
        </span>
      </label>

      <label>
        強風の閾値
        <input
          type="number"
          :min="AC_LIMITS.fanBoostThresholdMin"
          :max="AC_LIMITS.fanBoostThresholdMax"
          :step="AC_LIMITS.decimalStep"
          :value="input.fan_boost_threshold"
          @input="onNumber('fan_boost_threshold', $event)"
        >℃
        <span class="hint">目標からこれだけ離れていたら強にします。中はこの半分です。</span>
        <span v-if="fanLowUnreachable" class="hint warning-text">
          この組み合わせでは風量「弱」が使われません。温度の許容幅の 2 倍より大きくしてください。
        </span>
      </label>
    </fieldset>

    <fieldset>
      <legend>送信の制御</legend>

      <label>
        最短操作間隔
        <input
          type="number"
          :min="AC_LIMITS.minIntervalMin"
          :max="AC_LIMITS.minIntervalMax"
          step="1"
          :value="input.min_interval_min"
          @input="onNumber('min_interval_min', $event)"
        >分
        <span class="hint">続けざまにエアコンを操作しないための下限です。</span>
      </label>

      <label>
        再送間隔
        <input
          type="number" min="0" :max="AC_LIMITS.resendIntervalMax" step="1"
          :value="input.resend_interval_min"
          @input="onNumber('resend_interval_min', $event)"
        >分
        <span class="hint">
          運転中に同じ指示を送り直す間隔です。手動でリモコンを使って状態がずれても復帰できます。0 で再送しません。
        </span>
      </label>

      <label>
        センサー鮮度の上限
        <input
          type="number"
          :min="AC_LIMITS.sensorMaxAgeMin"
          :max="AC_LIMITS.sensorMaxAgeMax"
          step="1"
          :value="input.sensor_max_age_min"
          @input="onNumber('sensor_max_age_min', $event)"
        >分
        <span class="hint">これより古い測定値しか無いときは、判断せず何もしません。</span>
      </label>
    </fieldset>

    <ScheduleEditor v-model="input.schedules" />
  </div>
</template>
```

- [ ] **Step 5: スタイルを直す**

`RuleForm.vue` に `<style>` ブロックは無い。スタイルは `src/client/style.css` に
ある。

**ここが今回いちばん壊れやすい。** 現在の `.rule-form` は自動折り返しの grid で、
ラベルは `.rule-form > label` という**直下セレクタ**で当たっている
（`style.css:132-138`）。`<fieldset>` で囲むとラベルが直下でなくなり、
**セレクタが外れてレイアウトが崩れる。** 外側を fieldset の縦並びにし、
2 列の grid を各 fieldset の中へ移す。

`style.css` の該当箇所を差し替える。

```css
/* 設定フォームは群ごとに囲む。中身は 2 列で、狭い画面では 1 列へ折り返す。 */
.rule-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.rule-form > fieldset {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 0.9rem 1.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.9rem 1rem 1rem;
}

.rule-form > fieldset > legend {
  padding: 0 0.4rem;
  font-size: 0.9rem;
  font-weight: 600;
}

/* 群の説明は列をまたいで先頭に置く。 */
.rule-form > fieldset > .hint {
  grid-column: 1 / -1;
  margin: 0;
}

.rule-form > fieldset > label,
.rule-form > fieldset > .modes {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.9rem;
}

/* 許可する運転のチェックは横並び。上の縦並びを打ち消す。 */
.modes .inline {
  flex-direction: row;
  align-items: center;
  gap: 0.3rem;
}
```

`.hint` と `.warning-text` の既存の定義（`style.css:96-98` 付近）はそのまま使う。
新しい色やクラスを増やさないこと。

**`ScheduleEditor` も `.rule-form` の直下にある。** これまでは grid の項目
だったが、外側が flex の縦並びになるため見え方が変わる。Step 7 の目視で
必ず確認すること。

- [ ] **Step 6: 型・lint・テストを通す**

```
npm run lint && npm run typecheck && npm test
```

期待: すべて通る。落ちるものがあれば、直す前に内容を報告すること。

- [ ] **Step 7: 画面を確認する**

```
npm run dev
```

別のシェルで `npm run dev:client`。ブラウザで設定画面を開き、次を目で確かめる。

- fieldset が 4 つに分かれている
- 許可する運転のチェックを全部外すと注記が出る。保存しようとすると弾かれる
- 風量を「偏差から自動判別」にすると、強風の閾値の下に「弱が使われません」が出る
  （既定の許容幅 1.0・強風閾値 2.0 のとき）
- 強風の閾値を 2.5 にすると注記が消える
- 風量を「エアコンにまかせる」に戻すと、閾値が 2.0 でも注記が出ない
- 既存のルールを開いても表示が壊れていない
- **時間帯設定（`ScheduleEditor`）の見え方が崩れていない。** 外側の
  レイアウトが grid から flex へ変わったため影響を受ける
- 狭い画面（ブラウザを縮める）で各 fieldset の中が 1 列に折り返す

- [ ] **Step 8: コミット**

```bash
git add src/client/
git commit -m "feat: 体感ベース制御の設定を画面から編集できるようにする"
```

---

## 完了条件

- [ ] `npm run lint` が無指摘
- [ ] `npm run typecheck` が通る
- [ ] `npm test` が全件 PASS
- [ ] `allowed_modes = 0` が zod で弾かれる
- [ ] 新規ルールの既定値でどちらの警告も出ない
- [ ] 風量を「偏差から自動判別」にした瞬間に「弱が使われません」が出る
- [ ] 既存ルール（`fan_speed = 1`）を開いても表示と保存が壊れない

## 実装後に残る作業

- 制御ツール側のマイグレーション（`00002`〜`00004`）を本番 DB に適用しないと、
  この画面は保存時に「列が無い」で失敗する。**画面を使う前に制御ツールを
  1 回実行すること**（`ddl/ac_control_rules.sql` の冒頭にある既存の注意書きと同じ前提）
- 季節プリセット（夏 / 冬をワンクリック）は見送った。運用して手間だと分かってから
