import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type {
  PersaiRuntimeChannel,
  PersaiRuntimeMemoryWriteKind,
  PersaiRuntimeKnowledgeSource,
  PersaiRuntimeTier,
  RuntimeKnowledgeDocument,
  RuntimeRetrievedKnowledgeContext,
  RuntimeRetrievalPlan,
  RuntimeKnowledgeSearchHit,
  RuntimeMemoryWriteItem,
  RuntimeMonthlyMediaQuotaStatus,
  RuntimeQuotaStatusBucket,
  RuntimeQuotaStatusToolRow
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../runtime-config";

const INTERNAL_API_TIMEOUT_MS = 10_000;

type JsonResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

/**
 * ADR-074 L1.1 — `limit` is now nullable on the success branch. The API
 * counts every cost-tool call for observability even when the plan does
 * not configure a daily cap, returning `limit: null` to signal "counted,
 * no enforcement". This lets the founder dashboard show traffic for
 * unlimited tools that were previously biller-visible but
 * counter-invisible.
 */
export type ConsumeToolDailyLimitOutcome =
  | {
      allowed: true;
      currentCount: number;
      limit: number | null;
    }
  | {
      allowed: false;
      code: string;
      message: string;
    };

export type ReserveMonthlyMediaQuotaOutcome =
  | {
      allowed: true;
      currentUsedUnits: number;
      limitUnits: number | null;
      periodStartedAt: string;
      periodEndsAt: string;
      periodSource: "subscription_period" | "calendar_month_fallback";
    }
  | {
      allowed: false;
      code: string;
      message: string;
    };

export type InternalQuotaStatusOutcome = {
  planCode: string | null;
  tools: RuntimeQuotaStatusToolRow[];
  buckets: RuntimeQuotaStatusBucket[];
  monthlyMediaQuotas: RuntimeMonthlyMediaQuotaStatus | null;
};

export type InternalScheduledActionItem = {
  id: string;
  title: string;
  audience: "user" | "assistant";
  actionType: string | null;
  controlStatus: "active" | "disabled";
  nextRunAt: string | null;
  externalRef: string | null;
};

export type InternalBackgroundTaskRunItem = {
  id: string;
  status: "running" | "no_push" | "pushed" | "completed" | "failed" | "skipped";
  scheduledRunAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pushText: string | null;
  deliveryTarget: string | null;
  errorMessage: string | null;
};

export type InternalBackgroundTaskItem = {
  id: string;
  title: string;
  brief: string;
  mode: "llm_evaluate";
  status: "active" | "disabled" | "completed" | "failed" | "cancelled";
  nextRunAt: string | null;
  externalRef: string | null;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: InternalBackgroundTaskRunItem["status"] | null;
  lastPushAt: string | null;
  lastErrorMessage: string | null;
  recentRuns: InternalBackgroundTaskRunItem[];
};

export type InternalBackgroundTaskControlInput =
  | {
      assistantId: string;
      action: "create";
      title: string;
      brief: string;
      runAt?: string;
      delayMs?: number;
      everyMs?: number;
      anchorAt?: string;
      cronExpr?: string;
      timezone?: string;
      pushPolicy?: Record<string, unknown>;
    }
  | {
      assistantId: string;
      action: "pause" | "resume" | "cancel";
      taskId: string;
    };

export type InternalScheduledActionConversationContext = {
  channel: string;
  externalThreadKey: string;
};

export type InternalScheduledActionControlInput =
  | {
      assistantId: string;
      action: "create";
      kind: "user_reminder";
      title: string;
      reminderText: string;
      contextSessionKey?: string;
      runAt?: string;
      delayMs?: number;
      everyMs?: number;
      anchorAt?: string;
      cronExpr?: string;
      timezone?: string;
      contextMessages?: number;
      conversationContext?: InternalScheduledActionConversationContext;
    }
  | {
      assistantId: string;
      action: "pause" | "resume" | "cancel";
      taskId: string;
    };

export type InternalKnowledgeSearchInput = {
  assistantId: string;
  source: PersaiRuntimeKnowledgeSource;
  query: string;
  maxResults: number | null;
};

export type InternalKnowledgeFetchInput = {
  assistantId: string;
  source: PersaiRuntimeKnowledgeSource;
  referenceId: string;
};

export type InternalOrchestrateRetrievalInput = {
  assistantId: string;
  query: string;
  locale: string | null;
  retrievalPlan: RuntimeRetrievalPlan;
  sourcePolicy?: {
    mode: "default" | "active_skill";
    state:
      | "default"
      | "skill_only"
      | "escalated_to_user"
      | "escalated_to_web"
      | "escalated_to_product";
    allowedKnowledgeSearchSources: PersaiRuntimeKnowledgeSource[];
    allowedKnowledgeFetchSources: PersaiRuntimeKnowledgeSource[];
  } | null;
  conversation?: {
    channel: string;
    surfaceThreadKey: string;
  } | null;
};

export type InternalMemoryWriteInput = {
  assistantId: string;
  kind: PersaiRuntimeMemoryWriteKind;
  summary: string;
  transportSurface: "web" | "telegram";
  sourceTrust: "trusted_1to1" | "group";
  relatedUserMessageId: string | null;
  requestId: string | null;
};

export type InternalMemoryWriteOutcome = {
  written: boolean;
  code: string | null;
  message: string | null;
  item: RuntimeMemoryWriteItem | null;
};

export type InternalHydratedDurableMemoryItem = {
  id: string;
  summary: string;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  memoryClass: "core" | "contextual";
  kind: "fact" | "preference" | "open_loop" | null;
  createdAt: string;
  score: number | null;
};

export type InternalHydrateMemoryForTurnInput = {
  assistantId: string;
  userQuery: string;
  contextualLimit: number | null;
};

export type InternalHydrateMemoryForTurnOutcome = {
  core: InternalHydratedDurableMemoryItem[];
  contextual: InternalHydratedDurableMemoryItem[];
};

export type InternalFreshRuntimeSpec = {
  generation: number;
  assistantId: string;
  materializedSpecId: string;
  publishedVersionId: string;
  contentHash: string;
  bundleHash: string;
  bundleDocument: string;
};

export type InternalEnqueueBackgroundCompactionInput = {
  assistantId: string;
  workspaceId: string;
  channel: PersaiRuntimeChannel;
  externalThreadKey: string;
  externalUserKey: string | null;
  runtimeTier: PersaiRuntimeTier;
  trigger: "post_turn" | "manual";
  enqueuedRequestId: string | null;
};

// ADR-074 Slice M3 — opt-in explicit close of an active open-loop entry,
// driven by the model setting `closeOpenLoop: true` on `memory_write`.
export type InternalCloseMostSimilarOpenLoopInput = {
  assistantId: string;
  referenceText: string;
  requestId: string | null;
};

export type InternalCloseMostSimilarOpenLoopOutcome = {
  closed: boolean;
  closedItemId: string | null;
  reason: "matched" | "no_active_open_loop_matched";
};

// ADR-074 Slice M3.1 — deterministic close-by-ref for the model's structured
// `memory_write({ action: "close", ref })` action. The `itemId` here is the
// opaque ref the carry-over renderer surfaced to the model in the previous
// turn(s); the API verifies ownership and kind before flipping resolved_at.
export type InternalCloseAssistantMemoryByRefInput = {
  assistantId: string;
  itemId: string;
  requestId: string | null;
};

export type InternalCloseAssistantMemoryByRefOutcome = {
  closed: boolean;
  closedItemId: string | null;
  reason: "closed" | "already_closed" | "not_open_loop" | "not_found";
};

// ADR-074 Slice M3 — turn-0 cross-session continuity carry-over fetch.
export type InternalFindCrossSessionCarryOverInput = {
  assistantId: string;
  ttlDays: number;
  excludeRuntimeSessionId: string | null;
  requestId: string | null;
};

export type InternalCrossSessionCarryOverSynopsis = {
  runtimeSessionId: string;
  channel: string;
  synopsisUpdatedAt: string;
  summaryPayload: unknown;
};

export type InternalCrossSessionCarryOverOpenLoop = {
  id: string;
  summary: string;
  createdAt: string;
};

export type InternalFindCrossSessionCarryOverOutcome = {
  recentSynopses: InternalCrossSessionCarryOverSynopsis[];
  unresolvedOpenLoops: InternalCrossSessionCarryOverOpenLoop[];
};

// ADR-074 Slice M3.2 — fire-and-forget bookkeeping bump after a non-empty
// cross-session carry-over render. The runtime treats failures as soft
// (logs a WARN and continues) so that a transient bookkeeping issue cannot
// fail the whole turn over a missed cooldown write.
export type InternalMarkCrossSessionCarryOverFiredInput = {
  assistantChatId: string;
  firedAt: string;
  requestId: string | null;
};

export type InternalMarkCrossSessionCarryOverFiredOutcome = {
  outcome: "advanced" | "noop_already_newer";
};

@Injectable()
export class PersaiInternalApiClientService {
  private readonly logger = new Logger(PersaiInternalApiClientService.name);

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.PERSAI_API_BASE_URL?.trim() && this.config.PERSAI_INTERNAL_API_TOKEN
    );
  }

  // ADR-074 Slice M2 — fire-and-forget enqueue from the runtime to apps/api's
  // background-compaction scheduler. Failures are LOGGED, never thrown: the
  // user-perceived turn must remain successful even if the queue is down.
  // The API endpoint is idempotent on (assistantId, channel, externalThreadKey)
  // via a partial unique index on `pending_dedupe_key`, so rapid follow-up
  // turns coalesce into a single pending job.
  async enqueueBackgroundCompaction(
    input: InternalEnqueueBackgroundCompactionInput
  ): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(
        "[bg-compaction] Skipping enqueue: PERSAI_API_BASE_URL or PERSAI_INTERNAL_API_TOKEN is not configured."
      );
      return;
    }
    try {
      const response = await this.fetchJson("/api/v1/internal/runtime/compaction/enqueue", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const error = this.extractError(response.body);
        this.logger.warn(
          `[bg-compaction] Enqueue failed for ${input.channel}:${input.externalThreadKey}: HTTP ${response.status} ${error.message ?? ""}`
        );
      }
    } catch (error) {
      this.logger.warn(
        `[bg-compaction] Enqueue threw for ${input.channel}:${input.externalThreadKey}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async consumeToolDailyLimit(input: {
    assistantId: string;
    toolCode: string;
    /**
     * The daily-call-limit observed in the local runtime bundle when this
     * call was scheduled. May be `null` for tools that the operator has
     * not capped on the plan — the API still counts the call for
     * observability (ADR-074 L1.1 always-count anchor) and returns
     * `limit: null` to signal "counted, no enforcement".
     */
    dailyCallLimit: number | null;
    /**
     * Optional artifact-weight for cost tools that legitimately produce
     * N artifacts per single tool call (canonical case:
     * `image_generate({ count: N })`). Defaults to 1 server-side when
     * absent, so older runtime workers that have not been upgraded
     * remain wire-compatible.
     */
    units?: number;
  }): Promise<ConsumeToolDailyLimitOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/tools/consume", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const limitValue = payload?.limit;
      const limitParsed =
        limitValue === null ? null : Number.isInteger(limitValue) ? Number(limitValue) : undefined;
      if (
        payload?.ok === true &&
        Number.isInteger(payload.currentCount) &&
        limitParsed !== undefined
      ) {
        return {
          allowed: true,
          currentCount: Number(payload.currentCount),
          limit: limitParsed
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid tool quota consume response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status === 400 || response.status === 409) {
      return {
        allowed: false,
        code: error.code ?? "tool_quota_rejected",
        message:
          error.message ??
          `PersAI internal API rejected tool quota consume for "${input.toolCode}".`
      };
    }

    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API tool quota consume request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the tool quota consume request."
    );
  }

  async reserveMonthlyMediaQuota(input: {
    assistantId: string;
    toolCode: "image_generate" | "image_edit" | "video_generate";
    units: number;
  }): Promise<ReserveMonthlyMediaQuotaOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/tools/media-monthly/reserve", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const limitValue = payload?.limitUnits;
      const limitParsed =
        limitValue === null ? null : Number.isInteger(limitValue) ? Number(limitValue) : undefined;
      if (
        payload?.ok === true &&
        payload.allowed === true &&
        Number.isInteger(payload.currentUsedUnits) &&
        limitParsed !== undefined &&
        typeof payload.periodStartedAt === "string" &&
        typeof payload.periodEndsAt === "string" &&
        (payload.periodSource === "subscription_period" ||
          payload.periodSource === "calendar_month_fallback")
      ) {
        return {
          allowed: true,
          currentUsedUnits: Number(payload.currentUsedUnits),
          limitUnits: limitParsed,
          periodStartedAt: payload.periodStartedAt,
          periodEndsAt: payload.periodEndsAt,
          periodSource: payload.periodSource
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid monthly media quota reserve response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status === 400 || response.status === 409) {
      return {
        allowed: false,
        code: error.code ?? "monthly_media_quota_rejected",
        message:
          error.message ??
          `PersAI internal API rejected monthly media quota reserve for "${input.toolCode}".`
      };
    }

    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API monthly media quota reserve request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the monthly media quota reserve request."
    );
  }

  async releaseMonthlyMediaQuota(input: {
    assistantId: string;
    toolCode: "image_generate" | "image_edit" | "video_generate";
    units: number;
  }): Promise<void> {
    await this.mutateMonthlyMediaQuota(
      "/api/v1/internal/runtime/tools/media-monthly/release",
      input
    );
  }

  async markMonthlyMediaQuotaReconciliationRequired(input: {
    assistantId: string;
    toolCode: "image_generate" | "image_edit" | "video_generate";
    units: number;
  }): Promise<void> {
    await this.mutateMonthlyMediaQuota(
      "/api/v1/internal/runtime/tools/media-monthly/reconcile",
      input
    );
  }

  private async mutateMonthlyMediaQuota(
    path: string,
    input: {
      assistantId: string;
      toolCode: "image_generate" | "image_edit" | "video_generate";
      units: number;
    }
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (response.ok) {
      const payload = this.asObject(response.body);
      if (payload?.ok === true) {
        return;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid monthly media quota mutation response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API monthly media quota mutation request failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the monthly media quota mutation request."
    );
  }

  async readQuotaStatus(input: {
    assistantId: string;
    toolCode?: string | null;
  }): Promise<InternalQuotaStatusOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/tools/check", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        assistantId: input.assistantId,
        ...(typeof input.toolCode === "string" && input.toolCode.trim().length > 0
          ? { toolCode: input.toolCode.trim() }
          : {})
      })
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const tools = payload?.tools;
      const buckets = payload?.buckets;
      const monthlyMediaQuotas = payload?.monthlyMediaQuotas;
      if (
        payload?.ok === true &&
        (payload.planCode === null || typeof payload.planCode === "string") &&
        Array.isArray(tools) &&
        tools.every((tool) => this.isQuotaStatusToolRow(tool)) &&
        Array.isArray(buckets) &&
        buckets.every((bucket) => this.isQuotaStatusBucket(bucket)) &&
        (monthlyMediaQuotas === null || this.isMonthlyMediaQuotaStatus(monthlyMediaQuotas))
      ) {
        return {
          planCode: (payload.planCode as string | null) ?? null,
          tools: tools as RuntimeQuotaStatusToolRow[],
          buckets: buckets as RuntimeQuotaStatusBucket[],
          monthlyMediaQuotas: (monthlyMediaQuotas as RuntimeMonthlyMediaQuotaStatus | null) ?? null
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid quota-status response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API quota-status request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the quota-status request."
    );
  }

  async listScheduledActions(assistantId: string): Promise<InternalScheduledActionItem[]> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    if (assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId is required for scheduled action list.");
    }

    const response = await this.fetchJson(
      `/api/v1/internal/runtime/tasks/items?assistantId=${encodeURIComponent(assistantId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
        }
      }
    );

    if (response.ok) {
      const payload = this.asObject(response.body);
      const items = payload?.items;
      if (
        payload?.ok === true &&
        Array.isArray(items) &&
        items.every((item) => this.isInternalScheduledActionItem(item))
      ) {
        return items;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid scheduled action list response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API scheduled action list request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the scheduled action list request."
    );
  }

  async controlScheduledAction(input: InternalScheduledActionControlInput): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/tasks/control", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      if (payload?.ok === true) {
        return response.body;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid scheduled action control response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API scheduled action control request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the scheduled action control request."
    );
  }

  async listBackgroundTasks(assistantId: string): Promise<InternalBackgroundTaskItem[]> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    if (assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId is required for background task list.");
    }

    const response = await this.fetchJson(
      `/api/v1/internal/runtime/background-tasks/items?assistantId=${encodeURIComponent(assistantId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
        }
      }
    );

    if (response.ok) {
      const payload = this.asObject(response.body);
      const items = payload?.items;
      if (
        payload?.ok === true &&
        Array.isArray(items) &&
        items.every((item) => this.isInternalBackgroundTaskItem(item))
      ) {
        return items;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid background task list response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API background task list request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the background task list request."
    );
  }

  async controlBackgroundTask(input: InternalBackgroundTaskControlInput): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/background-tasks/control", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      if (payload?.ok === true) {
        return response.body;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid background task control response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API background task control request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the background task control request."
    );
  }

  async searchKnowledge(input: InternalKnowledgeSearchInput): Promise<RuntimeKnowledgeSearchHit[]> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/knowledge/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const hits = payload?.hits;
      if (
        payload?.ok === true &&
        Array.isArray(hits) &&
        hits.every((hit) => this.isKnowledgeHit(hit))
      ) {
        return hits;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid knowledge search response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API knowledge search request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the knowledge search request."
    );
  }

  async fetchKnowledge(
    input: InternalKnowledgeFetchInput
  ): Promise<RuntimeKnowledgeDocument | null> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/knowledge/fetch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const document = payload?.document;
      if (payload?.ok === true && (document === null || this.isKnowledgeDocument(document))) {
        return document as RuntimeKnowledgeDocument | null;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid knowledge fetch response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API knowledge fetch request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the knowledge fetch request."
    );
  }

  async orchestrateRetrieval(
    input: InternalOrchestrateRetrievalInput
  ): Promise<RuntimeRetrievedKnowledgeContext> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/knowledge/orchestrate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const context = payload?.context;
      if (payload?.ok === true && this.isRetrievedKnowledgeContext(context)) {
        return context;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid orchestrated retrieval response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API orchestrated retrieval request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the orchestrated retrieval request."
    );
  }

  async writeMemory(input: InternalMemoryWriteInput): Promise<InternalMemoryWriteOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/memory/write", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const item = payload?.item;
      if (
        payload?.ok === true &&
        typeof payload.written === "boolean" &&
        (payload.code === null || typeof payload.code === "string") &&
        (payload.message === null || typeof payload.message === "string") &&
        (item === null || this.isMemoryWriteItem(item))
      ) {
        return {
          written: payload.written,
          code: payload.code as string | null,
          message: payload.message as string | null,
          item: (item as RuntimeMemoryWriteItem | null) ?? null
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid memory write response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API memory write request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the memory write request."
    );
  }

  async hydrateMemoryForTurn(
    input: InternalHydrateMemoryForTurnInput
  ): Promise<InternalHydrateMemoryForTurnOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/memory/hydrate-for-turn", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        assistantId: input.assistantId,
        userQuery: input.userQuery,
        contextualLimit: input.contextualLimit
      })
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const core = payload?.core;
      const contextual = payload?.contextual;
      if (
        payload?.ok === true &&
        Array.isArray(core) &&
        core.every((item) => this.isHydratedDurableMemoryItem(item)) &&
        Array.isArray(contextual) &&
        contextual.every((item) => this.isHydratedDurableMemoryItem(item))
      ) {
        return {
          core: core as InternalHydratedDurableMemoryItem[],
          contextual: contextual as InternalHydratedDurableMemoryItem[]
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid memory hydrate-for-turn response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API memory hydrate-for-turn request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the memory hydrate-for-turn request."
    );
  }

  async closeMostSimilarOpenLoop(
    input: InternalCloseMostSimilarOpenLoopInput
  ): Promise<InternalCloseMostSimilarOpenLoopOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson(
      "/api/v1/internal/runtime/memory/close-most-similar-open-loop",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      }
    );

    if (response.ok) {
      const payload = this.asObject(response.body);
      const reason = payload?.reason;
      if (
        payload?.ok === true &&
        typeof payload.closed === "boolean" &&
        (payload.closedItemId === null || typeof payload.closedItemId === "string") &&
        (reason === "matched" || reason === "no_active_open_loop_matched")
      ) {
        return {
          closed: payload.closed,
          closedItemId: (payload.closedItemId as string | null) ?? null,
          reason
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid close-most-similar-open-loop response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API close-most-similar-open-loop request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the close-most-similar-open-loop request."
    );
  }

  async closeAssistantMemoryByRef(
    input: InternalCloseAssistantMemoryByRefInput
  ): Promise<InternalCloseAssistantMemoryByRefOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/memory/close-by-ref", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const reason = payload?.reason;
      if (
        payload?.ok === true &&
        typeof payload.closed === "boolean" &&
        (payload.closedItemId === null || typeof payload.closedItemId === "string") &&
        (reason === "closed" || reason === "already_closed")
      ) {
        return {
          closed: payload.closed,
          closedItemId: (payload.closedItemId as string | null) ?? null,
          reason
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid close-by-ref response."
      );
    }

    const error = this.extractError(response.body);
    // 400 = item is not an open_loop kind. 404 = assistant or item missing.
    // Both are non-retryable; propagate as BadRequest so the runtime can
    // surface a `skipped` payload to the model rather than crashing the
    // turn or retrying.
    if (response.status === 404) {
      return {
        closed: false,
        closedItemId: null,
        reason: "not_found"
      };
    }
    if (response.status === 400) {
      return {
        closed: false,
        closedItemId: null,
        reason: "not_open_loop"
      };
    }

    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API close-by-ref request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the close-by-ref request."
    );
  }

  async findCrossSessionCarryOver(
    input: InternalFindCrossSessionCarryOverInput
  ): Promise<InternalFindCrossSessionCarryOverOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/cross-session/carry-over", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const synopses = payload?.recentSynopses;
      const openLoops = payload?.unresolvedOpenLoops;
      if (
        payload?.ok === true &&
        Array.isArray(synopses) &&
        synopses.every((row) => this.isCrossSessionSynopsis(row)) &&
        Array.isArray(openLoops) &&
        openLoops.every((row) => this.isCrossSessionOpenLoop(row))
      ) {
        return {
          recentSynopses: synopses as InternalCrossSessionCarryOverSynopsis[],
          unresolvedOpenLoops: openLoops as InternalCrossSessionCarryOverOpenLoop[]
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid cross-session carry-over response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API cross-session carry-over request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the cross-session carry-over request."
    );
  }

  async markCrossSessionCarryOverFired(
    input: InternalMarkCrossSessionCarryOverFiredInput
  ): Promise<InternalMarkCrossSessionCarryOverFiredOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson(
      "/api/v1/internal/runtime/cross-session/mark-carry-over-fired",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      }
    );

    if (response.ok) {
      const payload = this.asObject(response.body);
      const outcome = payload?.outcome;
      if (payload?.ok === true && (outcome === "advanced" || outcome === "noop_already_newer")) {
        return { outcome };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid mark-cross-session-carry-over-fired response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API mark-cross-session-carry-over-fired request failed."
      );
    }

    throw new BadRequestException(
      error.message ??
        "PersAI internal API rejected the mark-cross-session-carry-over-fired request."
    );
  }

  async ensureFreshSpec(input: {
    assistantId: string;
    currentConfigGeneration: number;
  }): Promise<InternalFreshRuntimeSpec | null> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/ensure-fresh-spec", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.status === 204) {
      return null;
    }

    if (response.ok) {
      const payload = this.asObject(response.body);
      if (
        typeof payload?.generation === "number" &&
        Number.isInteger(payload.generation) &&
        typeof payload.assistantId === "string" &&
        typeof payload.materializedSpecId === "string" &&
        typeof payload.publishedVersionId === "string" &&
        typeof payload.contentHash === "string" &&
        typeof payload.bundleHash === "string" &&
        typeof payload.bundleDocument === "string"
      ) {
        return {
          generation: payload.generation,
          assistantId: payload.assistantId,
          materializedSpecId: payload.materializedSpecId,
          publishedVersionId: payload.publishedVersionId,
          contentHash: payload.contentHash,
          bundleHash: payload.bundleHash,
          bundleDocument: payload.bundleDocument
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid ensure-fresh-spec response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API ensure-fresh-spec request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the ensure-fresh-spec request."
    );
  }

  private buildUrl(pathname: string): string {
    const baseUrl = this.config.PERSAI_API_BASE_URL?.trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    return new URL(pathname, baseUrl).toString();
  }

  private async fetchJson(urlPath: string, init: RequestInit): Promise<JsonResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INTERNAL_API_TIMEOUT_MS);
    try {
      const response = await fetch(this.buildUrl(urlPath), {
        ...init,
        signal: controller.signal
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await this.readBody(response)
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new ServiceUnavailableException(
          `PersAI internal API request timed out after ${INTERNAL_API_TIMEOUT_MS}ms.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    const text = await response.text();
    return text.length > 0 ? text : null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isInternalScheduledActionItem(value: unknown): value is InternalScheduledActionItem {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.id === "string" &&
      typeof row.title === "string" &&
      (row.audience === "user" || row.audience === "assistant") &&
      (row.actionType === null || typeof row.actionType === "string") &&
      (row.controlStatus === "active" || row.controlStatus === "disabled") &&
      (row.nextRunAt === null || typeof row.nextRunAt === "string") &&
      (row.externalRef === null || typeof row.externalRef === "string")
    );
  }

  private isInternalBackgroundTaskItem(value: unknown): value is InternalBackgroundTaskItem {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.id === "string" &&
      typeof row.title === "string" &&
      typeof row.brief === "string" &&
      row.mode === "llm_evaluate" &&
      (row.status === "active" ||
        row.status === "disabled" ||
        row.status === "completed" ||
        row.status === "failed" ||
        row.status === "cancelled") &&
      (row.nextRunAt === null || typeof row.nextRunAt === "string") &&
      (row.externalRef === null || typeof row.externalRef === "string") &&
      typeof row.runCount === "number" &&
      Number.isInteger(row.runCount) &&
      (row.lastRunAt === null || typeof row.lastRunAt === "string") &&
      (row.lastRunStatus === null ||
        row.lastRunStatus === "running" ||
        row.lastRunStatus === "no_push" ||
        row.lastRunStatus === "pushed" ||
        row.lastRunStatus === "completed" ||
        row.lastRunStatus === "failed" ||
        row.lastRunStatus === "skipped") &&
      (row.lastPushAt === null || typeof row.lastPushAt === "string") &&
      (row.lastErrorMessage === null || typeof row.lastErrorMessage === "string") &&
      Array.isArray(row.recentRuns) &&
      row.recentRuns.every((run) => this.isInternalBackgroundTaskRunItem(run))
    );
  }

  private isInternalBackgroundTaskRunItem(value: unknown): value is InternalBackgroundTaskRunItem {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.id === "string" &&
      (row.status === "running" ||
        row.status === "no_push" ||
        row.status === "pushed" ||
        row.status === "completed" ||
        row.status === "failed" ||
        row.status === "skipped") &&
      typeof row.scheduledRunAt === "string" &&
      (row.startedAt === null || typeof row.startedAt === "string") &&
      (row.finishedAt === null || typeof row.finishedAt === "string") &&
      (row.pushText === null || typeof row.pushText === "string") &&
      (row.deliveryTarget === null || typeof row.deliveryTarget === "string") &&
      (row.errorMessage === null || typeof row.errorMessage === "string")
    );
  }

  private isKnowledgeHit(value: unknown): value is RuntimeKnowledgeSearchHit {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.referenceId === "string" &&
      typeof row.source === "string" &&
      (row.title === null || typeof row.title === "string") &&
      (row.locator === null || typeof row.locator === "string") &&
      (row.snippet === null || typeof row.snippet === "string") &&
      (row.score === null || typeof row.score === "number") &&
      (row.metadata === null || this.asObject(row.metadata) !== null)
    );
  }

  private isKnowledgeDocument(value: unknown): value is RuntimeKnowledgeDocument {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.referenceId === "string" &&
      typeof row.source === "string" &&
      (row.title === null || typeof row.title === "string") &&
      (row.locator === null || typeof row.locator === "string") &&
      typeof row.content === "string" &&
      (row.snippet === null || typeof row.snippet === "string") &&
      (row.metadata === null || this.asObject(row.metadata) !== null)
    );
  }

  private isRetrievedKnowledgeContext(value: unknown): value is RuntimeRetrievedKnowledgeContext {
    const row = this.asObject(value);
    return (
      row !== null &&
      Array.isArray(row.items) &&
      row.items.every((item) => this.isRetrievedKnowledgeContextItem(item)) &&
      (row.renderedBlock === null || typeof row.renderedBlock === "string")
    );
  }

  private isRetrievedKnowledgeContextItem(value: unknown): boolean {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.label === "skill_reference" ||
        row.label === "user_document" ||
        row.label === "product_kb" ||
        row.label === "web_reference") &&
      typeof row.referenceId === "string" &&
      (row.title === null || typeof row.title === "string") &&
      (row.locator === null || typeof row.locator === "string") &&
      typeof row.content === "string" &&
      (row.score === null || typeof row.score === "number") &&
      (row.metadata === null || this.asObject(row.metadata) !== null)
    );
  }

  private isHydratedDurableMemoryItem(value: unknown): value is InternalHydratedDurableMemoryItem {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.id === "string" &&
      typeof row.summary === "string" &&
      (row.sourceType === "web_chat" || row.sourceType === "memory_write") &&
      (row.sourceLabel === null || typeof row.sourceLabel === "string") &&
      (row.memoryClass === "core" || row.memoryClass === "contextual") &&
      (row.kind === null ||
        row.kind === "fact" ||
        row.kind === "preference" ||
        row.kind === "open_loop") &&
      typeof row.createdAt === "string" &&
      (row.score === null || typeof row.score === "number")
    );
  }

  private isCrossSessionSynopsis(value: unknown): value is InternalCrossSessionCarryOverSynopsis {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.runtimeSessionId === "string" &&
      typeof row.channel === "string" &&
      typeof row.synopsisUpdatedAt === "string"
    );
  }

  private isCrossSessionOpenLoop(value: unknown): value is InternalCrossSessionCarryOverOpenLoop {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.id === "string" &&
      typeof row.summary === "string" &&
      typeof row.createdAt === "string"
    );
  }

  private isMemoryWriteItem(value: unknown): value is RuntimeMemoryWriteItem {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.id === "string" &&
      typeof row.summary === "string" &&
      (row.kind === "fact" || row.kind === "preference" || row.kind === "open_loop") &&
      (row.sourceLabel === null || typeof row.sourceLabel === "string") &&
      typeof row.createdAt === "string" &&
      (row.chatId === null || typeof row.chatId === "string")
    );
  }

  private isQuotaStatusToolRow(value: unknown): value is RuntimeQuotaStatusToolRow {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.toolCode === "string" &&
      typeof row.activationStatus === "string" &&
      (row.dailyCallLimit === null ||
        (typeof row.dailyCallLimit === "number" &&
          Number.isInteger(row.dailyCallLimit) &&
          row.dailyCallLimit >= 0)) &&
      typeof row.currentCount === "number" &&
      Number.isInteger(row.currentCount) &&
      row.currentCount >= 0 &&
      typeof row.allowed === "boolean"
    );
  }

  private isQuotaStatusBucket(value: unknown): value is RuntimeQuotaStatusBucket {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.bucketCode === "string" &&
      typeof row.displayName === "string" &&
      (row.unit === "tokens" || row.unit === "count" || row.unit === "bytes") &&
      (row.used === null ||
        (typeof row.used === "number" && Number.isFinite(row.used) && row.used >= 0)) &&
      (row.limit === null ||
        (typeof row.limit === "number" && Number.isFinite(row.limit) && row.limit >= 0)) &&
      (row.percent === null ||
        (typeof row.percent === "number" &&
          Number.isFinite(row.percent) &&
          row.percent >= 0 &&
          row.percent <= 100)) &&
      typeof row.usageAvailable === "boolean" &&
      (row.status === "ok" || row.status === "limit_reached" || row.status === "usage_unavailable")
    );
  }

  private isMonthlyMediaQuotaStatus(value: unknown): value is RuntimeMonthlyMediaQuotaStatus {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.planCode === null || typeof row.planCode === "string") &&
      typeof row.periodStartedAt === "string" &&
      typeof row.periodEndsAt === "string" &&
      (row.periodSource === "subscription_period" ||
        row.periodSource === "calendar_month_fallback") &&
      Array.isArray(row.tools) &&
      row.tools.every((tool) => this.isMonthlyMediaQuotaStatusTool(tool))
    );
  }

  private isMonthlyMediaQuotaStatusTool(
    value: unknown
  ): value is RuntimeMonthlyMediaQuotaStatus["tools"][number] {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.toolCode === "image_generate" ||
        row.toolCode === "image_edit" ||
        row.toolCode === "video_generate") &&
      typeof row.displayName === "string" &&
      this.isNonNegativeInteger(row.usedUnits) &&
      this.isNonNegativeInteger(row.reservedUnits) &&
      this.isNonNegativeInteger(row.settledUnits) &&
      this.isNonNegativeInteger(row.releasedUnits) &&
      this.isNonNegativeInteger(row.reconciliationRequiredUnits) &&
      (row.limitUnits === null || this.isNonNegativeInteger(row.limitUnits)) &&
      (row.remainingUnits === null || this.isNonNegativeInteger(row.remainingUnits)) &&
      typeof row.usageAvailable === "boolean" &&
      (row.status === "ok" || row.status === "limit_reached" || row.status === "usage_unavailable")
    );
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }

  private extractError(body: unknown): { code: string | null; message: string | null } {
    if (typeof body === "string" && body.trim().length > 0) {
      return {
        code: null,
        message: body.trim()
      };
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    if (error) {
      return {
        code: typeof error.code === "string" ? error.code : null,
        message: typeof error.message === "string" ? error.message : null
      };
    }
    return {
      code: null,
      message: null
    };
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
