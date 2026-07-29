<script setup lang="ts">
// ルールの設定値を編集するフォーム。作成にも更新にも同じものを使う。
import { computed } from 'vue';
import { AC_LIMITS, isAirConditionerType } from '../shared/air-conditioner.js';
import type { AcDeviceOptionDto, AcRuleInput } from '../shared/ac-contract.js';
import ScheduleEditor from './ScheduleEditor.vue';

const input = defineModel<AcRuleInput>({ required: true });

function patch(changes: Partial<AcRuleInput>) {
  input.value = { ...input.value, ...changes };
}

function onNumber(key: 'ac_device_id' | 'sensor_device_id' | 'default_target_temp'
  | 'temp_hysteresis' | 'humidity_hysteresis' | 'min_interval_min'
  | 'resend_interval_min' | 'sensor_max_age_min' | 'fan_speed', event: Event) {
  patch({ [key]: Number((event.target as HTMLInputElement | HTMLSelectElement).value) });
}

function onNullableNumber(key: 'default_humidity_max' | 'default_humidity_min', event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  patch({ [key]: raw === '' ? null : Number(raw) });
}

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
        :step="AC_LIMITS.tempHysteresisStep"
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

    <label>
      風量
      <select :value="input.fan_speed" @change="onNumber('fan_speed', $event)">
        <option :value="1">自動</option>
        <option :value="2">弱</option>
        <option :value="3">中</option>
        <option :value="4">強</option>
      </select>
    </label>

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

    <ScheduleEditor v-model="input.schedules" />
  </div>
</template>
