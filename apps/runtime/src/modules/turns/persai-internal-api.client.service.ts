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
  RuntimeKnowledgeSearchHit,
  RuntimeMemoryWriteItem,
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

export type ConsumeToolDailyLimitOutcome =
  | {
      allowed: true;
      currentCount: number;
      limit: number;
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

export type InternalScheduledActionConversationContext = {
  channel: string;
  externalThreadKey: string;
};

export type InternalScheduledActionControlInput =
  | {
      assistantId: string;
      action: "create";
      audience: "user" | "assistant";
      title: string;
      reminderText: string;
      actionType?: string;
      actionPayload?: Record<string, unknown>;
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
    dailyCallLimit: number;
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
      if (
        payload?.ok === true &&
        Number.isInteger(payload.currentCount) &&
        Number.isInteger(payload.limit)
      ) {
        return {
          allowed: true,
          currentCount: Number(payload.currentCount),
          limit: Number(payload.limit)
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
      if (
        payload?.ok === true &&
        (payload.planCode === null || typeof payload.planCode === "string") &&
        Array.isArray(tools) &&
        tools.every((tool) => this.isQuotaStatusToolRow(tool)) &&
        Array.isArray(buckets) &&
        buckets.every((bucket) => this.isQuotaStatusBucket(bucket))
      ) {
        return {
          planCode: (payload.planCode as string | null) ?? null,
          tools: tools as RuntimeQuotaStatusToolRow[],
          buckets: buckets as RuntimeQuotaStatusBucket[]
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
