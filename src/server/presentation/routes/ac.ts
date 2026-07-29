// エアコン自動制御の設定 API。
//
// 入力の検査は shared/ac-contract.ts の zod スキーマ 1 箇所に任せる。
// ここは HTTP の作法（パラメータの取り出し・状態コード・応答の形）だけを担う。

import { Router } from 'express';
import createHttpError from 'http-errors';
import { z } from 'zod';
import {
  AcEnabledUpdateRequestSchema,
  AcRuleInputSchema,
  AcSnoozeRequestSchema,
  type AcCommandLogListResponse,
  type AcEnabledUpdateResponse,
  type AcRuleIdResponse,
  type AcRuleListResponse,
  type AcSnoozeResponse,
} from '../../../shared/ac-contract.js';
import { AC_LIMITS } from '../../../shared/air-conditioner.js';
import type { makeGetAcCommandLogs, makeListAcDevices } from '../../application/get-ac-command-logs.js';
import type { makeGetAcRules } from '../../application/get-ac-rules.js';
import type {
  makeCreateAcRule,
  makeDeleteAcRule,
  makeUpdateAcRule,
} from '../../application/save-ac-rule.js';
import type {
  makeSetAcRuleEnabled,
  makeSnoozeAcRule,
} from '../../application/set-ac-rule-state.js';
import { toAcCommandLogDto, toAcDevicesDto, toAcRuleDto } from '../ac-dto.js';

const ParamsSchema = z.object({ id: z.coerce.number().int() });

const LogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(AC_LIMITS.logLimitMax).default(AC_LIMITS.logLimitDefault),
});

export interface AcRouterDeps {
  readonly getAcRules: ReturnType<typeof makeGetAcRules>;
  readonly createAcRule: ReturnType<typeof makeCreateAcRule>;
  readonly updateAcRule: ReturnType<typeof makeUpdateAcRule>;
  readonly deleteAcRule: ReturnType<typeof makeDeleteAcRule>;
  readonly setAcRuleEnabled: ReturnType<typeof makeSetAcRuleEnabled>;
  readonly snoozeAcRule: ReturnType<typeof makeSnoozeAcRule>;
  readonly getAcCommandLogs: ReturnType<typeof makeGetAcCommandLogs>;
  readonly listAcDevices: ReturnType<typeof makeListAcDevices>;
}

/** パスパラメータの id を取り出す。整数でなければ 400 で止める。 */
function parseId(raw: unknown): number {
  const params = ParamsSchema.safeParse(raw);
  if (!params.success) {
    throw createHttpError(400, 'id は整数が必要です');
  }
  return params.data.id;
}

/** 検証エラーを、どの項目が悪いか分かる 1 行にまとめる。 */
function toBadRequest(error: z.ZodError): createHttpError.HttpError {
  const details = error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join(' / ');
  return createHttpError(400, `入力内容が不正です（${details}）`);
}

export function acRouter(deps: AcRouterDeps): Router {
  const router = Router();

  router.get('/ac/rules', async (_req, res) => {
    const views = await deps.getAcRules();
    const response: AcRuleListResponse = views.map(toAcRuleDto);
    res.json(response);
  });

  router.get('/ac/devices', async (_req, res) => {
    res.json(toAcDevicesDto(await deps.listAcDevices()));
  });

  router.post('/ac/rules', async (req, res) => {
    const body = AcRuleInputSchema.safeParse(req.body);
    if (!body.success) throw toBadRequest(body.error);

    const id = await deps.createAcRule(body.data);
    const response: AcRuleIdResponse = { id };
    res.status(201).json(response);
  });

  router.put('/ac/rules/:id', async (req, res) => {
    const id = parseId(req.params);
    const body = AcRuleInputSchema.safeParse(req.body);
    if (!body.success) throw toBadRequest(body.error);

    if (!(await deps.updateAcRule(id, body.data))) {
      throw createHttpError(404, '指定されたルールが見つかりません');
    }
    const response: AcRuleIdResponse = { id };
    res.json(response);
  });

  router.delete('/ac/rules/:id', async (req, res) => {
    const id = parseId(req.params);

    if (!(await deps.deleteAcRule(id))) {
      throw createHttpError(404, '指定されたルールが見つかりません');
    }
    const response: AcRuleIdResponse = { id };
    res.json(response);
  });

  router.put('/ac/rules/:id/enabled', async (req, res) => {
    const id = parseId(req.params);
    const body = AcEnabledUpdateRequestSchema.safeParse(req.body);
    if (!body.success) throw createHttpError(400, 'enabled は真偽値が必要です');

    if (!(await deps.setAcRuleEnabled(id, body.data.enabled))) {
      throw createHttpError(404, '指定されたルールが見つかりません');
    }
    const response: AcEnabledUpdateResponse = { id, enabled: body.data.enabled };
    res.json(response);
  });

  router.put('/ac/rules/:id/snooze', async (req, res) => {
    const id = parseId(req.params);
    const body = AcSnoozeRequestSchema.safeParse(req.body);
    if (!body.success) {
      throw createHttpError(400, `hours は 0〜${AC_LIMITS.snoozeHoursMax} の数値が必要です`);
    }

    const result = await deps.snoozeAcRule(id, body.data.hours);
    if (!result.found) {
      throw createHttpError(404, '指定されたルールが見つかりません');
    }
    const response: AcSnoozeResponse = {
      id,
      snooze_until: result.snoozeUntil ? result.snoozeUntil.toISOString() : null,
    };
    res.json(response);
  });

  router.get('/ac/rules/:id/logs', async (req, res) => {
    const id = parseId(req.params);
    // 未知・範囲外の limit は既定値に丸める（既存の sensor-data と同じ方針）。
    const query = LogQuerySchema.safeParse(req.query);
    const limit = query.success ? query.data.limit : AC_LIMITS.logLimitDefault;

    const logs = await deps.getAcCommandLogs(id, limit);
    const response: AcCommandLogListResponse = logs.map(toAcCommandLogDto);
    res.json(response);
  });

  return router;
}
