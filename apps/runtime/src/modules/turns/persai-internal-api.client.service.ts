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
  RuntimeDocumentJobRunRequest,
  PersaiRuntimeKnowledgeFetchMode,
  PersaiRuntimeMemoryWriteKind,
  PersaiRuntimeKnowledgeSource,
  PersaiRuntimeTier,
  RuntimeKnowledgeDocument,
  RuntimeRetrievedKnowledgeContext,
  RuntimeRetrievalPlan,
  RuntimeKnowledgeSearchHit,
  RuntimeMemoryWriteItem,
  RuntimeMonthlyToolQuotaStatus,
  RuntimeQuotaAdvisoryCandidate,
  RuntimeQuotaStatusAdvisories,
  RuntimeQuotaStatusSubscriptionUpdate,
  RuntimeQuotaStatusCheckout,
  RuntimeQuotaStatusBucket,
  RuntimeQuotaStatusCurrentPlan,
  RuntimeQuotaStatusPackageOffer,
  RuntimeQuotaStatusPackageOffers,
  RuntimeQuotaStatusPackageToolOffers,
  RuntimeQuotaStatusToolRow,
  RuntimeAttachmentRef,
  RuntimeImageEditRequest,
  RuntimeImageGenerateRequest,
  RuntimeVideoGenerateRequest
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
      guidance: string | null;
    };

export type InternalQuotaStatusOutcome = {
  planCode: string | null;
  currentPlan: RuntimeQuotaStatusCurrentPlan;
  visiblePlans: Array<{
    code: string;
    displayName: string;
    description: string | null;
    highlighted: boolean;
    isCurrent: boolean;
    amountMinor: number | null;
    amountMajor: number | null;
    currency: string | null;
    billingPeriod: "month" | "year" | null;
    priceLabel: {
      ru: string | null;
      en: string | null;
    };
    enabledToolCodes: string[];
    title: {
      ru: string | null;
      en: string | null;
    };
    subtitle: {
      ru: string | null;
      en: string | null;
    };
    notes: {
      ru: string | null;
      en: string | null;
    };
    badge: {
      ru: string | null;
      en: string | null;
    };
    ctaLabel: {
      ru: string | null;
      en: string | null;
    };
    highlightItems: {
      ru: string[];
      en: string[];
    };
    limits: {
      tokenBudgetLimit: number | null;
      activeWebChatsLimit: number | null;
      messagesPerChat: number | null;
      imageGenerateMonthlyUnitsLimit: number | null;
      imageEditMonthlyUnitsLimit: number | null;
      videoGenerateMonthlyUnitsLimit: number | null;
      documentMonthlyUnitsLimit: number | null;
    };
  }>;
  advisories: RuntimeQuotaStatusAdvisories;
  advisoryCandidates: RuntimeQuotaAdvisoryCandidate[];
  tools: RuntimeQuotaStatusToolRow[];
  buckets: RuntimeQuotaStatusBucket[];
  monthlyToolQuotas: RuntimeMonthlyToolQuotaStatus | null;
  packagesAvailableByTool: Record<string, boolean>;
  packageOffers: RuntimeQuotaStatusPackageOffers;
};

export type InternalQuotaCheckoutOutcome =
  | {
      action: "checkout_created";
      checkout: RuntimeQuotaStatusCheckout;
      subscriptionUpdate: null;
    }
  | {
      action: "subscription_updated";
      checkout: null;
      subscriptionUpdate: RuntimeQuotaStatusSubscriptionUpdate;
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
  /** ADR-094 — required at this layer; runtime tool default is "section". */
  mode: PersaiRuntimeKnowledgeFetchMode;
  radius: number | null;
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

export type InternalEnqueueDeferredMediaJobInput = {
  assistantId: string;
  sourceUserMessageId: string;
  sourceUserMessageText: string;
  attachments: RuntimeAttachmentRef[];
  directToolExecution:
    | {
        toolCode: "image_generate";
        request: RuntimeImageGenerateRequest;
      }
    | {
        toolCode: "image_edit";
        request: RuntimeImageEditRequest;
      }
    | {
        toolCode: "video_generate";
        request: RuntimeVideoGenerateRequest;
      };
};

export type InternalEnqueueDeferredDocumentJobInput = {
  assistantId: string;
  sourceUserMessageId: string;
  sourceUserMessageText: string;
  // Attachments from the user turn that triggered this document tool call.
  // Mirrors the deferred media path. The API persists them on the job so the
  // runtime worker (`RuntimeDocumentProviderAdapterService`) can inline
  // text-extractable source content into the HTML generation prompt.
  attachments: RuntimeDocumentJobRunRequest["attachments"];
  directToolExecution: {
    toolCode: "document";
    descriptorMode:
      | "create_pdf_document"
      | "create_presentation"
      | "revise_document"
      | "export_or_redeliver";
    request: RuntimeDocumentJobRunRequest["directToolExecution"]["request"];
  };
};

export type InternalRuntimeFileExtractionOutcome =
  | {
      extracted: true;
      file: {
        fileRef: string;
        displayName: string | null;
        relativePath: string;
        mimeType: string;
        sizeBytes: number;
      };
      text: string;
      markdown: string | null;
      note: string | null;
      provider: unknown;
      quality: unknown;
    }
  | {
      extracted: false;
      file: {
        fileRef: string;
        displayName: string | null;
        relativePath: string;
        mimeType: string;
        sizeBytes: number;
      } | null;
      text: null;
      markdown: null;
      note: string;
      provider: null;
      quality: null;
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
  reason: "matched" | "no_active_open_loop_matched" | "cooldown_active";
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
  reason: "closed" | "already_closed" | "cooldown_active" | "not_open_loop" | "not_found";
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

export type InternalListActiveOpenLoopRefsInput = {
  assistantId: string;
  requestId: string | null;
};

export type InternalListActiveOpenLoopRefsOutcome = {
  unresolvedOpenLoops: InternalCrossSessionCarryOverOpenLoop[];
  totalUnresolvedOpenLoops: number;
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

  async enqueueDeferredMediaJob(input: InternalEnqueueDeferredMediaJobInput): Promise<
    | {
        accepted: true;
        jobId: string;
        kind: "image" | "video";
      }
    | {
        accepted: false;
        code: string;
        message: string;
        guidance: string | null;
      }
  > {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/media-jobs/enqueue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    const payload = this.asObject(response.body);
    if (response.ok) {
      if (payload?.ok === true && payload.accepted === true && typeof payload.jobId === "string") {
        return {
          accepted: true,
          jobId: payload.jobId,
          kind: payload.kind === "video" ? "video" : "image"
        };
      }
      if (
        payload?.ok === true &&
        payload.accepted === false &&
        typeof payload.code === "string" &&
        typeof payload.message === "string"
      ) {
        return {
          accepted: false,
          code: payload.code,
          message: payload.message,
          guidance: typeof payload.guidance === "string" ? payload.guidance : null
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid deferred media enqueue response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API deferred media enqueue failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected deferred media enqueue."
    );
  }

  async enqueueDeferredDocumentJob(input: InternalEnqueueDeferredDocumentJobInput): Promise<
    | {
        accepted: true;
        jobId: string;
        documentType: "pdf_document" | "presentation";
      }
    | {
        accepted: false;
        code: string;
        message: string;
        guidance: string | null;
      }
  > {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/document-jobs/enqueue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    const payload = this.asObject(response.body);
    if (response.ok) {
      if (
        payload?.ok === true &&
        payload.accepted === true &&
        typeof payload.renderJobId === "string" &&
        (payload.documentType === "pdf_document" || payload.documentType === "presentation")
      ) {
        return {
          accepted: true,
          jobId: payload.renderJobId,
          documentType: payload.documentType
        };
      }
      if (
        payload?.ok === true &&
        payload.accepted === false &&
        typeof payload.code === "string" &&
        typeof payload.message === "string"
      ) {
        return {
          accepted: false,
          code: payload.code,
          message: payload.message,
          guidance: typeof payload.guidance === "string" ? payload.guidance : null
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid deferred document enqueue response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API deferred document enqueue failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected deferred document enqueue."
    );
  }

  async extractAssistantFileText(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<InternalRuntimeFileExtractionOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/files/extract", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    const payload = this.asObject(response.body);
    if (response.ok) {
      const parsed = this.parseRuntimeFileExtractionOutcome(payload);
      if (parsed !== null) {
        return parsed;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid runtime file extraction response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API runtime file extraction failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected runtime file extraction."
    );
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
          `PersAI internal API rejected monthly media quota reserve for "${input.toolCode}".`,
        guidance: error.guidance
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
    channel?: PersaiRuntimeChannel | null;
    externalThreadKey?: string | null;
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
          : {}),
        ...(typeof input.channel === "string" ? { channel: input.channel } : {}),
        ...(typeof input.externalThreadKey === "string" && input.externalThreadKey.trim().length > 0
          ? { externalThreadKey: input.externalThreadKey.trim() }
          : {})
      })
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const tools = payload?.tools;
      const buckets = payload?.buckets;
      const monthlyToolQuotas = payload?.monthlyToolQuotas;
      const packagesAvailableByTool = payload?.packagesAvailableByTool;
      const packageOffers = payload?.packageOffers;
      const visiblePlans = payload?.visiblePlans;
      const advisories = payload?.advisories;
      const advisoryCandidates = payload?.advisoryCandidates;
      if (
        payload?.ok === true &&
        (payload.planCode === null || typeof payload.planCode === "string") &&
        this.isQuotaStatusCurrentPlan(payload.currentPlan) &&
        Array.isArray(visiblePlans) &&
        visiblePlans.every((plan) => this.isQuotaStatusVisiblePlan(plan)) &&
        this.isQuotaStatusAdvisories(advisories) &&
        Array.isArray(advisoryCandidates) &&
        advisoryCandidates.every((candidate) => this.isQuotaStatusAdvisoryCandidate(candidate)) &&
        Array.isArray(tools) &&
        tools.every((tool) => this.isQuotaStatusToolRow(tool)) &&
        Array.isArray(buckets) &&
        buckets.every((bucket) => this.isQuotaStatusBucket(bucket)) &&
        (monthlyToolQuotas === null || this.isMonthlyToolQuotaStatus(monthlyToolQuotas)) &&
        this.isPackagesAvailableByTool(packagesAvailableByTool) &&
        this.isQuotaStatusPackageOffers(packageOffers)
      ) {
        return {
          planCode: (payload.planCode as string | null) ?? null,
          currentPlan: payload.currentPlan as RuntimeQuotaStatusCurrentPlan,
          visiblePlans: visiblePlans as InternalQuotaStatusOutcome["visiblePlans"],
          advisories: advisories as RuntimeQuotaStatusAdvisories,
          advisoryCandidates: advisoryCandidates as RuntimeQuotaAdvisoryCandidate[],
          tools: tools as RuntimeQuotaStatusToolRow[],
          buckets: buckets as RuntimeQuotaStatusBucket[],
          monthlyToolQuotas: (monthlyToolQuotas as RuntimeMonthlyToolQuotaStatus | null) ?? null,
          packagesAvailableByTool: packagesAvailableByTool as Record<string, boolean>,
          packageOffers: packageOffers as RuntimeQuotaStatusPackageOffers
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

  async createQuotaCheckout(input: {
    assistantId: string;
    requestId: string;
    targetPlanCode: string;
    paymentMethodClass: "card" | "sbp_qr";
    confirmed: boolean;
  }): Promise<InternalQuotaCheckoutOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/tools/quota-status/checkout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      if (this.isQuotaStatusCheckoutOutcome(payload)) {
        return payload;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid quota checkout response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API quota checkout request failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the quota checkout request."
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
        (reason === "matched" ||
          reason === "no_active_open_loop_matched" ||
          reason === "cooldown_active")
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
        (reason === "closed" || reason === "already_closed" || reason === "cooldown_active")
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

  async listActiveOpenLoopRefs(
    input: InternalListActiveOpenLoopRefsInput
  ): Promise<InternalListActiveOpenLoopRefsOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/memory/open-loop-refs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const openLoops = payload?.unresolvedOpenLoops;
      if (
        payload?.ok === true &&
        Array.isArray(openLoops) &&
        typeof payload.totalUnresolvedOpenLoops === "number" &&
        openLoops.every((row) => this.isCrossSessionOpenLoop(row))
      ) {
        return {
          unresolvedOpenLoops: openLoops as InternalCrossSessionCarryOverOpenLoop[],
          totalUnresolvedOpenLoops: payload.totalUnresolvedOpenLoops
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid open-loop-refs response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API open-loop-refs request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the open-loop-refs request."
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

  private parseRuntimeFileExtractionOutcome(
    payload: Record<string, unknown> | null
  ): InternalRuntimeFileExtractionOutcome | null {
    if (payload?.ok !== true || typeof payload.extracted !== "boolean") {
      return null;
    }
    const file = this.asObject(payload.file);
    const fileSummary =
      file !== null &&
      typeof file.fileRef === "string" &&
      (typeof file.displayName === "string" || file.displayName === null) &&
      typeof file.relativePath === "string" &&
      typeof file.mimeType === "string" &&
      typeof file.sizeBytes === "number"
        ? {
            fileRef: file.fileRef,
            displayName: file.displayName,
            relativePath: file.relativePath,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes
          }
        : null;
    if (payload.extracted === false) {
      return typeof payload.note === "string"
        ? {
            extracted: false,
            file: fileSummary,
            text: null,
            markdown: null,
            note: payload.note,
            provider: null,
            quality: null
          }
        : null;
    }
    if (fileSummary === null || typeof payload.text !== "string") {
      return null;
    }
    return {
      extracted: true,
      file: fileSummary,
      text: payload.text,
      markdown: typeof payload.markdown === "string" ? payload.markdown : null,
      note: typeof payload.note === "string" ? payload.note : null,
      provider: payload.provider,
      quality: payload.quality
    };
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
      typeof row.displayName === "string" &&
      typeof row.activationStatus === "string" &&
      (row.dailyCallLimit === null ||
        (typeof row.dailyCallLimit === "number" &&
          Number.isInteger(row.dailyCallLimit) &&
          row.dailyCallLimit >= 0)) &&
      typeof row.currentCount === "number" &&
      Number.isInteger(row.currentCount) &&
      row.currentCount >= 0 &&
      (row.percent === null ||
        (typeof row.percent === "number" &&
          Number.isFinite(row.percent) &&
          row.percent >= 0 &&
          row.percent <= 100)) &&
      typeof row.finiteLimit === "boolean" &&
      (row.warningThresholdPercent === null ||
        (typeof row.warningThresholdPercent === "number" &&
          Number.isFinite(row.warningThresholdPercent) &&
          row.warningThresholdPercent >= 0 &&
          row.warningThresholdPercent <= 100)) &&
      typeof row.warningThresholdReached === "boolean" &&
      (row.periodStartedAt === null || typeof row.periodStartedAt === "string") &&
      (row.periodEndsAt === null || typeof row.periodEndsAt === "string") &&
      (row.periodSource === null || row.periodSource === "utc_day") &&
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
      typeof row.finiteLimit === "boolean" &&
      typeof row.usageAvailable === "boolean" &&
      (row.warningThresholdPercent === null ||
        (typeof row.warningThresholdPercent === "number" &&
          Number.isFinite(row.warningThresholdPercent) &&
          row.warningThresholdPercent >= 0 &&
          row.warningThresholdPercent <= 100)) &&
      typeof row.warningThresholdReached === "boolean" &&
      (row.status === "ok" || row.status === "limit_reached" || row.status === "usage_unavailable")
    );
  }

  private isQuotaStatusAdvisories(value: unknown): value is RuntimeQuotaStatusAdvisories {
    const row = this.asObject(value);
    const tokenBudget = this.asObject(row?.tokenBudget);
    return (
      row !== null &&
      this.isNonNegativeInteger(row.warningThresholdPercent) &&
      row.warningThresholdPercent <= 100 &&
      typeof row.isFreePlan === "boolean" &&
      typeof row.higherPaidPlanAvailable === "boolean" &&
      (row.highestVisiblePaidPlanCode === null ||
        typeof row.highestVisiblePaidPlanCode === "string") &&
      tokenBudget !== null &&
      (tokenBudget.periodStartedAt === null || typeof tokenBudget.periodStartedAt === "string") &&
      (tokenBudget.periodEndsAt === null || typeof tokenBudget.periodEndsAt === "string") &&
      (tokenBudget.periodSource === null ||
        tokenBudget.periodSource === "subscription_period" ||
        tokenBudget.periodSource === "calendar_month_fallback") &&
      typeof tokenBudget.paidLightModeEligible === "boolean" &&
      typeof tokenBudget.paidLightModeActive === "boolean" &&
      (tokenBudget.paidLightModeReason === null ||
        tokenBudget.paidLightModeReason === "token_budget_limit_reached")
    );
  }

  private isQuotaStatusAdvisoryCandidate(value: unknown): value is RuntimeQuotaAdvisoryCandidate {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.dedupeKey === null || typeof row.dedupeKey === "string") &&
      typeof row.limitCode === "string" &&
      typeof row.displayName === "string" &&
      row.thresholdCode === "warning_90_percent" &&
      this.isNonNegativeInteger(row.warningThresholdPercent) &&
      row.warningThresholdPercent <= 100 &&
      this.isNonNegativeInteger(row.currentPercent) &&
      row.currentPercent <= 100 &&
      typeof row.finiteLimit === "boolean" &&
      (row.periodStartedAt === null || typeof row.periodStartedAt === "string") &&
      (row.periodEndsAt === null || typeof row.periodEndsAt === "string") &&
      (row.periodSource === null ||
        row.periodSource === "subscription_period" ||
        row.periodSource === "calendar_month_fallback" ||
        row.periodSource === "utc_day") &&
      (row.deliveryState === "eligible" || row.deliveryState === "already_sent") &&
      (row.deliveredAt === null || typeof row.deliveredAt === "string")
    );
  }

  private isQuotaStatusCurrentPlan(value: unknown): value is RuntimeQuotaStatusCurrentPlan {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.code === null || typeof row.code === "string") &&
      (row.displayName === null || typeof row.displayName === "string")
    );
  }

  private isQuotaStatusPackageOffers(value: unknown): value is RuntimeQuotaStatusPackageOffers {
    const row = this.asObject(value);
    const purchase = this.asObject(row?.packagesPurchase);
    return (
      row !== null &&
      (row.packagesPurchase === null ||
        (purchase !== null &&
          typeof purchase.path === "string" &&
          (purchase.url === null || typeof purchase.url === "string") &&
          Array.isArray(purchase.paymentMethodClasses) &&
          purchase.paymentMethodClasses.every((item) => item === "card" || item === "sbp_qr"))) &&
      Array.isArray(row.tools) &&
      row.tools.every((tool) => this.isQuotaStatusPackageToolOffers(tool))
    );
  }

  private isQuotaStatusPackageToolOffers(
    value: unknown
  ): value is RuntimeQuotaStatusPackageToolOffers {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.toolCode === "image_generate" ||
        row.toolCode === "image_edit" ||
        row.toolCode === "video_generate") &&
      typeof row.available === "boolean" &&
      typeof row.offerableNow === "boolean" &&
      (row.offerReason === "available" ||
        row.offerReason === "no_public_packages" ||
        row.offerReason === "tool_not_enabled_on_current_plan") &&
      (row.preferredOfferKind === "none" ||
        row.preferredOfferKind === "package_only" ||
        row.preferredOfferKind === "plan_upgrade_only" ||
        row.preferredOfferKind === "plan_upgrade_or_package") &&
      Array.isArray(row.preferredPackageIds) &&
      row.preferredPackageIds.every((item) => typeof item === "string") &&
      (row.preferredUpgradePlanCode === null || typeof row.preferredUpgradePlanCode === "string") &&
      Array.isArray(row.upgradePlanCodes) &&
      row.upgradePlanCodes.every((item) => typeof item === "string") &&
      Array.isArray(row.offers) &&
      row.offers.every((offer) => this.isQuotaStatusPackageOffer(offer))
    );
  }

  private isQuotaStatusPackageOffer(value: unknown): value is RuntimeQuotaStatusPackageOffer {
    const row = this.asObject(value);
    const title = this.asObject(row?.title);
    const subtitle = this.asObject(row?.subtitle);
    const ctaLabel = this.asObject(row?.ctaLabel);
    return (
      row !== null &&
      typeof row.id === "string" &&
      (row.toolCode === "image_generate" ||
        row.toolCode === "image_edit" ||
        row.toolCode === "video_generate") &&
      this.isNonNegativeInteger(row.units) &&
      this.isNonNegativeInteger(row.amountMinor) &&
      typeof row.currency === "string" &&
      this.isNonNegativeInteger(row.displayOrder) &&
      typeof row.highlighted === "boolean" &&
      title !== null &&
      (title.ru === null || typeof title.ru === "string") &&
      (title.en === null || typeof title.en === "string") &&
      subtitle !== null &&
      (subtitle.ru === null || typeof subtitle.ru === "string") &&
      (subtitle.en === null || typeof subtitle.en === "string") &&
      ctaLabel !== null &&
      (ctaLabel.ru === null || typeof ctaLabel.ru === "string") &&
      (ctaLabel.en === null || typeof ctaLabel.en === "string")
    );
  }

  private isQuotaStatusVisiblePlan(
    value: unknown
  ): value is InternalQuotaStatusOutcome["visiblePlans"][number] {
    const row = this.asObject(value);
    const title = this.asObject(row?.title);
    const subtitle = this.asObject(row?.subtitle);
    const notes = this.asObject(row?.notes);
    const badge = this.asObject(row?.badge);
    const ctaLabel = this.asObject(row?.ctaLabel);
    const priceLabel = this.asObject(row?.priceLabel);
    const highlightItems = this.asObject(row?.highlightItems);
    const limits = this.asObject(row?.limits);
    return (
      row !== null &&
      typeof row.code === "string" &&
      typeof row.displayName === "string" &&
      (row.description === null || typeof row.description === "string") &&
      typeof row.highlighted === "boolean" &&
      typeof row.isCurrent === "boolean" &&
      (row.amountMinor === null || this.isNonNegativeInteger(row.amountMinor)) &&
      (row.amountMajor === null ||
        (typeof row.amountMajor === "number" &&
          Number.isFinite(row.amountMajor) &&
          row.amountMajor >= 0)) &&
      (row.currency === null || typeof row.currency === "string") &&
      (row.billingPeriod === null ||
        row.billingPeriod === "month" ||
        row.billingPeriod === "year") &&
      priceLabel !== null &&
      (priceLabel.ru === null || typeof priceLabel.ru === "string") &&
      (priceLabel.en === null || typeof priceLabel.en === "string") &&
      Array.isArray(row.enabledToolCodes) &&
      row.enabledToolCodes.every((item) => typeof item === "string") &&
      title !== null &&
      (title.ru === null || typeof title.ru === "string") &&
      (title.en === null || typeof title.en === "string") &&
      subtitle !== null &&
      (subtitle.ru === null || typeof subtitle.ru === "string") &&
      (subtitle.en === null || typeof subtitle.en === "string") &&
      notes !== null &&
      (notes.ru === null || typeof notes.ru === "string") &&
      (notes.en === null || typeof notes.en === "string") &&
      badge !== null &&
      (badge.ru === null || typeof badge.ru === "string") &&
      (badge.en === null || typeof badge.en === "string") &&
      ctaLabel !== null &&
      (ctaLabel.ru === null || typeof ctaLabel.ru === "string") &&
      (ctaLabel.en === null || typeof ctaLabel.en === "string") &&
      highlightItems !== null &&
      Array.isArray(highlightItems.ru) &&
      highlightItems.ru.every((item) => typeof item === "string") &&
      Array.isArray(highlightItems.en) &&
      highlightItems.en.every((item) => typeof item === "string") &&
      limits !== null &&
      (limits.tokenBudgetLimit === null || this.isNonNegativeInteger(limits.tokenBudgetLimit)) &&
      (limits.activeWebChatsLimit === null ||
        this.isNonNegativeInteger(limits.activeWebChatsLimit)) &&
      (limits.messagesPerChat === null || this.isNonNegativeInteger(limits.messagesPerChat)) &&
      (limits.imageGenerateMonthlyUnitsLimit === null ||
        this.isNonNegativeInteger(limits.imageGenerateMonthlyUnitsLimit)) &&
      (limits.imageEditMonthlyUnitsLimit === null ||
        this.isNonNegativeInteger(limits.imageEditMonthlyUnitsLimit)) &&
      (limits.videoGenerateMonthlyUnitsLimit === null ||
        this.isNonNegativeInteger(limits.videoGenerateMonthlyUnitsLimit)) &&
      (limits.documentMonthlyUnitsLimit === null ||
        this.isNonNegativeInteger(limits.documentMonthlyUnitsLimit))
    );
  }

  private isMonthlyToolQuotaStatus(value: unknown): value is RuntimeMonthlyToolQuotaStatus {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.planCode === null || typeof row.planCode === "string") &&
      typeof row.periodStartedAt === "string" &&
      typeof row.periodEndsAt === "string" &&
      (row.periodSource === "subscription_period" ||
        row.periodSource === "calendar_month_fallback") &&
      Array.isArray(row.tools) &&
      row.tools.every((tool) => this.isMonthlyToolQuotaStatusTool(tool))
    );
  }

  private isMonthlyToolQuotaStatusTool(
    value: unknown
  ): value is RuntimeMonthlyToolQuotaStatus["tools"][number] {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.toolCode === "image_generate" ||
        row.toolCode === "image_edit" ||
        row.toolCode === "video_generate" ||
        row.toolCode === "document") &&
      typeof row.displayName === "string" &&
      this.isNonNegativeInteger(row.usedUnits) &&
      this.isNonNegativeInteger(row.reservedUnits) &&
      this.isNonNegativeInteger(row.settledUnits) &&
      this.isNonNegativeInteger(row.releasedUnits) &&
      this.isNonNegativeInteger(row.reconciliationRequiredUnits) &&
      (row.limitUnits === null || this.isNonNegativeInteger(row.limitUnits)) &&
      (row.remainingUnits === null || this.isNonNegativeInteger(row.remainingUnits)) &&
      (row.percent === null ||
        (typeof row.percent === "number" &&
          Number.isFinite(row.percent) &&
          row.percent >= 0 &&
          row.percent <= 100)) &&
      typeof row.finiteLimit === "boolean" &&
      typeof row.usageAvailable === "boolean" &&
      (row.warningThresholdPercent === null ||
        (typeof row.warningThresholdPercent === "number" &&
          Number.isFinite(row.warningThresholdPercent) &&
          row.warningThresholdPercent >= 0 &&
          row.warningThresholdPercent <= 100)) &&
      typeof row.warningThresholdReached === "boolean" &&
      (row.status === "ok" || row.status === "limit_reached" || row.status === "usage_unavailable")
    );
  }

  private isQuotaStatusCheckout(value: unknown): value is RuntimeQuotaStatusCheckout {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.paymentIntentId === "string" &&
      typeof row.targetPlanCode === "string" &&
      (row.paymentMethodClass === "card" || row.paymentMethodClass === "sbp_qr") &&
      (row.checkoutMode === null ||
        row.checkoutMode === "embedded" ||
        row.checkoutMode === "redirect" ||
        row.checkoutMode === "payment_link" ||
        row.checkoutMode === "qr_code" ||
        row.checkoutMode === "manual_test") &&
      (row.recurringCheckoutKind === "one_time" ||
        row.recurringCheckoutKind === "recurring_start") &&
      typeof row.recurringSupportedBySelectedMethod === "boolean" &&
      (row.recurringUnsupportedReason === null ||
        typeof row.recurringUnsupportedReason === "string") &&
      typeof row.checkoutPagePath === "string" &&
      (row.checkoutPageUrl === null || typeof row.checkoutPageUrl === "string") &&
      (row.checkoutSignInUrl === null || typeof row.checkoutSignInUrl === "string")
    );
  }

  private isQuotaStatusSubscriptionUpdate(
    value: unknown
  ): value is RuntimeQuotaStatusSubscriptionUpdate {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.targetPlanCode === "string" &&
      (row.targetPlanDisplayName === null || typeof row.targetPlanDisplayName === "string") &&
      (row.effectiveAt === null || typeof row.effectiveAt === "string") &&
      (row.nextChargeAt === null || typeof row.nextChargeAt === "string") &&
      (row.changeKind === null || row.changeKind === "free" || row.changeKind === "downgrade")
    );
  }

  private isQuotaStatusCheckoutOutcome(value: unknown): value is InternalQuotaCheckoutOutcome {
    const row = this.asObject(value);
    return (
      row !== null &&
      row.ok === true &&
      ((row.action === "checkout_created" &&
        this.isQuotaStatusCheckout(row.checkout) &&
        row.subscriptionUpdate === null) ||
        (row.action === "subscription_updated" &&
          row.checkout === null &&
          this.isQuotaStatusSubscriptionUpdate(row.subscriptionUpdate)))
    );
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }

  private extractError(body: unknown): {
    code: string | null;
    message: string | null;
    guidance: string | null;
  } {
    if (typeof body === "string" && body.trim().length > 0) {
      return {
        code: null,
        message: body.trim(),
        guidance: null
      };
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    const details = this.asObject(error?.details);
    if (error) {
      return {
        code: typeof error.code === "string" ? error.code : null,
        message: typeof error.message === "string" ? error.message : null,
        guidance:
          typeof details?.userFacingGuidance === "string" ? details.userFacingGuidance : null
      };
    }
    return {
      code: null,
      message: null,
      guidance: null
    };
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private isPackagesAvailableByTool(value: unknown): value is Record<string, boolean> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    return Object.values(value).every((entry) => typeof entry === "boolean");
  }
}
