// エアコン設定 API の呼び出し。
//
// 応答は shared/ac-contract.ts のスキーマで検証してから返す。サーバーと同じ
// スキーマを使うので、契約から外れた応答はここで気付ける（型が合っているのに
// 実際の形が違う、という取り違えを防ぐ）。

import {
  AcCommandLogListResponseSchema,
  AcDevicesResponseSchema,
  AcEnabledUpdateResponseSchema,
  AcRuleIdResponseSchema,
  AcRuleListResponseSchema,
  AcSnoozeResponseSchema,
  type AcCommandLogDto,
  type AcDevicesResponse,
  type AcRuleDto,
  type AcRuleInput,
} from '../shared/ac-contract.js';
import type { z } from 'zod';

/** サーバーが返すエラー本文。error-handler.ts が { error } の形で返す。 */
interface ErrorBody {
  error?: string;
}

async function request<T extends z.ZodTypeAny>(
  schema: T,
  url: string,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body.error ?? `リクエストに失敗しました (${res.status})`);
  }

  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error('サーバーの応答が想定した形ではありません');
  }
  return parsed.data;
}

const json = (body: unknown): RequestInit['body'] => JSON.stringify(body);

export const fetchRules = (): Promise<AcRuleDto[]> =>
  request(AcRuleListResponseSchema, '/api/ac/rules');

export const fetchDevices = (): Promise<AcDevicesResponse> =>
  request(AcDevicesResponseSchema, '/api/ac/devices');

export const createRule = (input: AcRuleInput) =>
  request(AcRuleIdResponseSchema, '/api/ac/rules', { method: 'POST', body: json(input) });

export const updateRule = (id: number, input: AcRuleInput) =>
  request(AcRuleIdResponseSchema, `/api/ac/rules/${id}`, { method: 'PUT', body: json(input) });

export const deleteRule = (id: number) =>
  request(AcRuleIdResponseSchema, `/api/ac/rules/${id}`, { method: 'DELETE' });

export const setEnabled = (id: number, enabled: boolean) =>
  request(AcEnabledUpdateResponseSchema, `/api/ac/rules/${id}/enabled`, {
    method: 'PUT',
    body: json({ enabled }),
  });

export const snooze = (id: number, hours: number) =>
  request(AcSnoozeResponseSchema, `/api/ac/rules/${id}/snooze`, {
    method: 'PUT',
    body: json({ hours }),
  });

export const fetchLogs = (id: number, limit = 50): Promise<AcCommandLogDto[]> =>
  request(AcCommandLogListResponseSchema, `/api/ac/rules/${id}/logs?limit=${limit}`);
