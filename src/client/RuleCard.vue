<script setup lang="ts">
// ルール 1 件のカード。現在の状態の表示と、設定の編集・操作をまとめる。
import { ref } from 'vue';
import type { AcCommandLogDto, AcDeviceOptionDto, AcRuleDto, AcRuleInput } from '../shared/ac-contract.js';
import CommandLogTable from './CommandLogTable.vue';
import RuleForm from './RuleForm.vue';
import { formatDateTime, readingLabel, stateLabel } from './format.js';

const props = defineProps<{
  rule: AcRuleDto;
  airConditioners: AcDeviceOptionDto[];
  sensors: AcDeviceOptionDto[];
  busy: boolean;
  /** 履歴。まだ読み込んでいなければ null */
  logs: AcCommandLogDto[] | null;
}>();

const emit = defineEmits<{
  save: [id: number, input: AcRuleInput];
  remove: [id: number, name: string];
  toggle: [id: number, enabled: boolean];
  snooze: [id: number, hours: number];
  loadLogs: [id: number];
}>();

const editing = ref(false);
const draft = ref<AcRuleInput>(toInput(props.rule));

/** 応答 DTO を、そのまま送り返せる入力の形へ写す。 */
function toInput(rule: AcRuleDto): AcRuleInput {
  return {
    name: rule.name,
    ac_device_id: rule.ac_device_id,
    sensor_device_id: rule.sensor_device_id,
    default_target_temp: rule.default_target_temp,
    default_humidity_max: rule.default_humidity_max,
    default_humidity_min: rule.default_humidity_min,
    temp_hysteresis: rule.temp_hysteresis,
    humidity_hysteresis: rule.humidity_hysteresis,
    min_interval_min: rule.min_interval_min,
    resend_interval_min: rule.resend_interval_min,
    sensor_max_age_min: rule.sensor_max_age_min,
    fan_speed: rule.fan_speed,
    base_humidity: rule.base_humidity,
    comfort_adjust_max: rule.comfort_adjust_max,
    setpoint_offset: rule.setpoint_offset,
    fan_boost_threshold: rule.fan_boost_threshold,
    allowed_modes: rule.allowed_modes,
    schedules: rule.schedules.map((s) => ({
      start_minute: s.start_minute,
      end_minute: s.end_minute,
      target_temp: s.target_temp,
      humidity_max: s.humidity_max,
      humidity_min: s.humidity_min,
    })),
  };
}

function startEditing() {
  // 開くたびに最新の内容から作り直す。前回の編集途中の値を持ち越さない。
  draft.value = toInput(props.rule);
  editing.value = true;
}

const SNOOZE_CHOICES = [1, 3, 8] as const;
</script>

<template>
  <section class="card">
    <header class="card-header">
      <h2>{{ rule.name }}</h2>
      <label class="toggle">
        <input
          type="checkbox"
          :checked="rule.enabled"
          :disabled="busy"
          @change="emit('toggle', rule.id, ($event.target as HTMLInputElement).checked)"
        >
        自動制御
      </label>
    </header>

    <dl class="status">
      <dt>推定している運転状態</dt>
      <dd>{{ stateLabel(rule.last_command) }}</dd>

      <dt>基準センサー</dt>
      <dd>
        {{ rule.sensor_device_name ?? '(不明なデバイス)' }}
        <template v-if="rule.reading">
          — {{ readingLabel(rule.reading.temperature, rule.reading.humidity) }}
          <span class="muted">（{{ formatDateTime(rule.reading.recorded_at) }}）</span>
        </template>
        <span v-else class="error">測定値がありません</span>
      </dd>

      <dt>エアコン</dt>
      <dd>{{ rule.ac_device_name ?? '(不明なデバイス)' }}</dd>

      <dt>一時停止</dt>
      <dd>
        <template v-if="rule.snooze_until">{{ formatDateTime(rule.snooze_until) }} まで停止中</template>
        <template v-else>解除中</template>
      </dd>
    </dl>

    <p v-if="rule.humidity_low_warning" class="warning">
      湿度が下限を下回っています。エアコンでは加湿できないため、加湿器の使用を検討してください。
    </p>

    <div class="actions">
      <button type="button" :disabled="busy" @click="startEditing">設定を編集</button>
      <button
        v-for="hours in SNOOZE_CHOICES"
        :key="hours"
        type="button"
        :disabled="busy"
        @click="emit('snooze', rule.id, hours)"
      >
        {{ hours }}時間停止
      </button>
      <button type="button" :disabled="busy" @click="emit('snooze', rule.id, 0)">停止を解除</button>
      <button type="button" :disabled="busy" @click="emit('loadLogs', rule.id)">履歴を見る</button>
      <button type="button" class="danger" :disabled="busy" @click="emit('remove', rule.id, rule.name)">
        削除
      </button>
    </div>

    <form v-if="editing" class="editor" @submit.prevent="emit('save', rule.id, draft)">
      <RuleForm v-model="draft" :air-conditioners="airConditioners" :sensors="sensors" />
      <div class="actions">
        <button type="submit" :disabled="busy">保存</button>
        <button type="button" :disabled="busy" @click="editing = false">閉じる</button>
      </div>
    </form>

    <CommandLogTable v-if="logs" :logs="logs" />
  </section>
</template>
