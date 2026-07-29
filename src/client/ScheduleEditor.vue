<script setup lang="ts">
// 時間帯別の目標値を編集する。時刻は HH:MM で入力し、分に変換して持つ。
import { computed } from 'vue';
import { AC_LIMITS } from '../shared/air-conditioner.js';
import { findScheduleOverlaps, labelToMinutes, minutesToLabel } from '../shared/ac-schedule.js';
import type { AcScheduleInput } from '../shared/ac-contract.js';

const schedules = defineModel<AcScheduleInput[]>({ required: true });

// 重複はサーバーでも弾かれるが、保存を押す前に気付けるようここでも出す。
const overlapping = computed(() => {
  const flagged = new Set<number>();
  for (const [i, j] of findScheduleOverlaps(schedules.value)) {
    flagged.add(i);
    flagged.add(j);
  }
  return flagged;
});

function add() {
  schedules.value = [
    ...schedules.value,
    { start_minute: 22 * 60, end_minute: 7 * 60, target_temp: 26, humidity_max: null, humidity_min: null },
  ];
}

function remove(index: number) {
  schedules.value = schedules.value.filter((_, i) => i !== index);
}

function patch(index: number, changes: Partial<AcScheduleInput>) {
  schedules.value = schedules.value.map((s, i) => (i === index ? { ...s, ...changes } : s));
}

function onTimeChange(index: number, key: 'start_minute' | 'end_minute', event: Event) {
  const minute = labelToMinutes((event.target as HTMLInputElement).value);
  if (minute === null) return;
  patch(index, { [key]: minute });
}

function onNumberChange(index: number, key: 'target_temp', event: Event) {
  patch(index, { [key]: Number((event.target as HTMLInputElement).value) });
}

function onNullableChange(index: number, key: 'humidity_max' | 'humidity_min', event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  patch(index, { [key]: raw === '' ? null : Number(raw) });
}
</script>

<template>
  <fieldset class="schedules">
    <legend>時間帯別の目標値</legend>
    <p class="hint">
      どの時間帯にも当てはまらない時刻では、上の既定値が使われます。
      終了時刻より開始時刻が後なら日跨ぎ（例 22:00〜07:00）として扱います。
    </p>

    <div
      v-for="(schedule, index) in schedules"
      :key="index"
      class="schedule-row"
      :class="{ 'has-error': overlapping.has(index) }"
    >
      <label>
        開始
        <input
          type="time"
          :value="minutesToLabel(schedule.start_minute)"
          @change="onTimeChange(index, 'start_minute', $event)"
        >
      </label>
      <label>
        終了
        <input
          type="time"
          :value="minutesToLabel(schedule.end_minute)"
          @change="onTimeChange(index, 'end_minute', $event)"
        >
      </label>
      <label>
        目標
        <input
          type="number"
          :min="AC_LIMITS.targetTempMin"
          :max="AC_LIMITS.targetTempMax"
          step="1"
          :value="schedule.target_temp"
          @input="onNumberChange(index, 'target_temp', $event)"
        >℃
      </label>
      <label>
        湿度上限
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          :value="schedule.humidity_max ?? ''"
          @input="onNullableChange(index, 'humidity_max', $event)"
        >%
      </label>
      <label>
        湿度下限
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          :value="schedule.humidity_min ?? ''"
          @input="onNullableChange(index, 'humidity_min', $event)"
        >%
      </label>
      <button type="button" class="danger" @click="remove(index)">削除</button>

      <p v-if="overlapping.has(index)" class="error">他の時間帯と重複しています</p>
    </div>

    <button type="button" @click="add">時間帯を追加</button>
  </fieldset>
</template>
