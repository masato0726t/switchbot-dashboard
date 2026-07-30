<script setup lang="ts">
// エアコン自動制御の設定画面。
//
// 実際にエアコンを操作するのは制御ツール auto-air-conditioner で、この画面は
// その設定を預かって表示するだけ。保存してもすぐには操作されず、次に制御ツールが
// 動いたとき（5 分ごと）に反映される。
import { computed, onMounted, ref } from 'vue';
import { AC_RULE_DEFAULTS } from '../shared/air-conditioner.js';
import type { AcCommandLogDto, AcDevicesResponse, AcRuleDto, AcRuleInput } from '../shared/ac-contract.js';
import * as api from './api.js';
import RuleCard from './RuleCard.vue';
import RuleForm from './RuleForm.vue';

const rules = ref<AcRuleDto[]>([]);
const devices = ref<AcDevicesResponse>({ air_conditioners: [], sensors: [] });
const logsByRule = ref<Record<number, AcCommandLogDto[]>>({});

const message = ref('');
const errorMessage = ref('');
const busy = ref(false);
const loaded = ref(false);
const creating = ref(false);

const hasAirConditioner = computed(() => devices.value.air_conditioners.length > 0);
const canCreate = computed(() => hasAirConditioner.value && devices.value.sensors.length > 0);

function newRuleInput(): AcRuleInput {
  return {
    name: 'リビング',
    ac_device_id: devices.value.air_conditioners[0]?.id ?? 0,
    sensor_device_id: devices.value.sensors[0]?.id ?? 0,
    ...AC_RULE_DEFAULTS,
    schedules: [],
  };
}

const draft = ref<AcRuleInput>(newRuleInput());

/**
 * 通信を 1 か所で包む。失敗は必ず画面に出す（握りつぶさない）。
 * 成功したら一覧を取り直して、サーバー側の状態を正として表示する。
 */
async function run(action: () => Promise<void>, successText: string) {
  busy.value = true;
  errorMessage.value = '';
  try {
    await action();
    await reload();
    message.value = successText;
  } catch (err) {
    message.value = '';
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function reload() {
  rules.value = await api.fetchRules();
}

async function loadDevices() {
  devices.value = await api.fetchDevices();
  draft.value = newRuleInput();
}

function startCreating() {
  draft.value = newRuleInput();
  creating.value = true;
}

const onCreate = () =>
  run(async () => {
    await api.createRule(draft.value);
    creating.value = false;
  }, 'ルールを追加しました');

const onSave = (id: number, input: AcRuleInput) =>
  run(() => api.updateRule(id, input).then(() => undefined), '保存しました');

const onToggle = (id: number, enabled: boolean) =>
  run(
    () => api.setEnabled(id, enabled).then(() => undefined),
    enabled ? '自動制御を有効にしました' : '自動制御を無効にしました（エアコンはそのままです）',
  );

const onSnooze = (id: number, hours: number) =>
  run(
    () => api.snooze(id, hours).then(() => undefined),
    hours === 0 ? '一時停止を解除しました' : `${hours}時間停止します`,
  );

function onRemove(id: number, name: string) {
  if (!window.confirm(`ルール「${name}」を削除します。送信履歴も一緒に消えます。よろしいですか？`)) return;
  void run(() => api.deleteRule(id).then(() => undefined), '削除しました');
}

async function onLoadLogs(id: number) {
  errorMessage.value = '';
  try {
    logsByRule.value = { ...logsByRule.value, [id]: await api.fetchLogs(id) };
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(async () => {
  try {
    await loadDevices();
    await reload();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    loaded.value = true;
  }
});
</script>

<template>
  <header class="page-header">
    <h1>エアコン自動制御</h1>
    <a href="/index.html">← センサーダッシュボードへ</a>
  </header>

  <p class="lead">
    設定した内容は、制御ツールが次に動いたとき（5 分ごと）に反映されます。この画面から直接エアコンは操作しません。
  </p>

  <p v-if="errorMessage" class="banner error" role="alert">{{ errorMessage }}</p>
  <p v-else-if="message" class="banner" role="status">{{ message }}</p>

  <p v-if="loaded && !hasAirConditioner" class="banner error">
    赤外線リモコンが 1 つも登録されていません。SwitchBot アプリでエアコンをハブの赤外線リモコンとして
    登録したうえで、収集ツール（switchBotStore）を 1 回実行してください。
  </p>

  <p v-if="loaded && rules.length === 0" class="empty">
    制御ルールがまだありません。下の「ルールを追加」から作成してください。
  </p>

  <RuleCard
    v-for="rule in rules"
    :key="rule.id"
    :rule="rule"
    :air-conditioners="devices.air_conditioners"
    :sensors="devices.sensors"
    :busy="busy"
    :logs="logsByRule[rule.id] ?? null"
    @save="onSave"
    @remove="onRemove"
    @toggle="onToggle"
    @snooze="onSnooze"
    @load-logs="onLoadLogs"
  />

  <section class="card">
    <h2>ルールを追加</h2>

    <p v-if="loaded && !canCreate" class="hint">
      エアコンと、温度を記録しているセンサーの両方が必要です。
    </p>

    <button v-else-if="!creating" type="button" :disabled="busy" @click="startCreating">
      ルールを追加
    </button>

    <form v-else @submit.prevent="onCreate">
      <RuleForm
        v-model="draft"
        :air-conditioners="devices.air_conditioners"
        :sensors="devices.sensors"
      />
      <div class="actions">
        <button type="submit" :disabled="busy">追加</button>
        <button type="button" :disabled="busy" @click="creating = false">やめる</button>
      </div>
    </form>
  </section>
</template>
