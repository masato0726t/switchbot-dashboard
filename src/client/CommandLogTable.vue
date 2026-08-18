<script setup lang="ts">
// 送信履歴。実際に送ったコマンドだけが残る（見送った回は記録されない）。
import type { AcCommandLogDto } from '../shared/ac-contract.js';
import { commandLabel, formatDateTime, readingLabel } from './format.js';

defineProps<{ logs: AcCommandLogDto[] }>();
</script>

<template>
  <p v-if="logs.length === 0" class="empty">送信履歴はまだありません。</p>

  <div v-else class="log-scroll">
    <table class="log-table">
      <thead>
        <tr>
          <th>日時</th>
          <th>送った内容</th>
          <th>室温 / 湿度</th>
          <th>外気温</th>
          <th>理由</th>
          <th>結果</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in logs" :key="log.id" :class="{ failure: log.result === 'failure' }">
          <td>{{ formatDateTime(log.executed_at) }}</td>
          <td>{{ commandLabel(log) }}</td>
          <td>{{ readingLabel(log.sensor_temp, log.sensor_humidity) }}</td>
          <td>{{ log.outdoor_temp === null ? '-' : `${log.outdoor_temp.toFixed(1)}℃` }}</td>
          <td>{{ log.reason }}</td>
          <td>
            <template v-if="log.result === 'success'">成功</template>
            <template v-else>失敗: {{ log.error_message }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
