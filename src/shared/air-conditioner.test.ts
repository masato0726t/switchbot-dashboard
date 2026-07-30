import { describe, expect, it } from 'vitest';
import {
  AC_RULE_DEFAULTS, ALL_MODES, MODE_BITS, isBaseHumidityTooHigh, isFanLowUnreachable,
} from './air-conditioner.js';

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
    expect(isBaseHumidityTooHigh(1.5, 55, 60, 5, ALL_MODES)).toBe(true);
  });

  it('境界の内側なら警告しない', () => {
    expect(isBaseHumidityTooHigh(1.5, 54, 60, 5, ALL_MODES)).toBe(false);
  });

  // 補正上限が 0 なら基準湿度は参照されない。
  it('補正しない設定なら警告しない', () => {
    expect(isBaseHumidityTooHigh(0, 55, 60, 5, ALL_MODES)).toBe(false);
  });

  // 湿度上限が未設定ならドライは動かない。
  it('湿度上限が未設定なら警告しない', () => {
    expect(isBaseHumidityTooHigh(1.5, 55, null, 5, ALL_MODES)).toBe(false);
  });

  // ドライを許可から外していればドライは動かない。「常にドライ運転の条件を
  // 満たします」という警告文が成立しないので出さない。
  it('ドライを許可していなければ警告しない', () => {
    expect(isBaseHumidityTooHigh(1.5, 55, 60, 5, MODE_BITS.cool | MODE_BITS.heat)).toBe(false);
  });

  it('ドライだけ許可していても警告する', () => {
    expect(isBaseHumidityTooHigh(1.5, 55, 60, 5, MODE_BITS.dry)).toBe(true);
  });
});

describe('新規ルールの既定値', () => {
  // 既定で警告が出る状態は、警告を読み飛ばす癖をつけるので避ける。
  // 値は画面の初期値と同じ AC_RULE_DEFAULTS から取る。リテラルで持つと、
  // 画面の既定だけ変えてもこのテストが緑のままになり主張が空洞化する。
  it('どちらの警告も出ない', () => {
    expect(
      isFanLowUnreachable(
        AC_RULE_DEFAULTS.fan_speed,
        AC_RULE_DEFAULTS.fan_boost_threshold,
        AC_RULE_DEFAULTS.temp_hysteresis,
      ),
    ).toBe(false);
    expect(
      isBaseHumidityTooHigh(
        AC_RULE_DEFAULTS.comfort_adjust_max,
        AC_RULE_DEFAULTS.base_humidity,
        AC_RULE_DEFAULTS.default_humidity_max,
        AC_RULE_DEFAULTS.humidity_hysteresis,
        AC_RULE_DEFAULTS.allowed_modes,
      ),
    ).toBe(false);
  });
});
