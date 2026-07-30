<script setup lang="ts">
// ルールの設定値を編集するフォーム。作成にも更新にも同じものを使う。
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
</script>

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
        <span v-if="baseHumidityTooHigh" class="hint warning-text">
          基準湿度が湿度上限に近すぎます。基準の状態が常にドライ運転の条件を満たします。
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
