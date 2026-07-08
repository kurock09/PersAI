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
  PersaiRuntimeTodoWriteStatus,
  RuntimeFilesToolItem,
  RuntimeKnowledgeDocument,
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
  RuntimeTodoItem,
  RuntimeVideoGenerateRequest,
  LocalBrowserBridgeDispatchCommandRequest,
  LocalBrowserBridgeDispatchCommandResult,
  LocalBrowserBridgeGetCommandResultResult,
  LocalBrowserResult,
  RuntimeBrowserProfileListItem,
  RuntimeBrowserLoginResult,
  PendingBrowserLoginState,
  PersaiRuntimeBrowserProfileErrorReason
} from "@persai/runtime-contract";
import {
  PERSAI_RUNTIME_BROWSER_PROFILE_ERROR_REASONS,
  PERSAI_RUNTIME_TODO_WRITE_STATUSES
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

export type ResolveBrowserProfileOutcome =
  | {
      ok: true;
      profileId: string;
      bridgeSessionRef: string;
    }
  | {
      ok: false;
      reason: PersaiRuntimeBrowserProfileErrorReason;
      pendingBrowserLogin?: PendingBrowserLoginState;
    };

export type StartBrowserLoginOutcome = RuntimeBrowserLoginResult & {
  profileId: string;
};

export type DispatchLocalBrowserCommandOutcome =
  | LocalBrowserBridgeDispatchCommandResult
  | {
      accepted: false;
      commandId: string;
      code: string;
      message: string;
      activeBridgeDeviceIds?: string[];
      requestedBridgeDeviceId?: string | null;
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

export type InternalMemoryWriteInput = {
  assistantId: string;
  kind: PersaiRuntimeMemoryWriteKind;
  summary: string;
  layer: "long" | "short";
  confidence: number | null;
  transportSurface: "web" | "telegram";
  sourceTrust: "trusted_1to1" | "group";
  /** ADR-119 Slice 9 — provenance of this write. */
  provenance: "user_explicit" | "system_inferred" | "auto_extracted" | "legacy";
  relatedUserMessageId: string | null;
  requestId: string | null;
};

export type InternalMemoryWriteOutcome = {
  written: boolean;
  code: string | null;
  message: string | null;
  item: RuntimeMemoryWriteItem | null;
};

// ADR-125 Slice 1 — chat-todos (todo_write) internal API.

export type InternalApplyTodoWriteAction =
  | {
      kind: "add";
      items: Array<{
        content: string;
        parentId?: string | null;
        status?: PersaiRuntimeTodoWriteStatus;
      }>;
    }
  | {
      kind: "update";
      id: string;
      content?: string;
      status?: PersaiRuntimeTodoWriteStatus;
      parentId?: string | null;
    }
  | { kind: "complete"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "clear" };

export type InternalApplyTodoWriteInput = {
  assistantId: string;
  channel: "web" | "telegram";
  surfaceThreadKey: string;
  action: InternalApplyTodoWriteAction;
};

export type InternalChatPlanOutcome = {
  chatId: string;
  action: "applied" | "skipped";
  reason: string | null;
  warning: string | null;
  todos: RuntimeTodoItem[];
  windowed: boolean;
  totalCount: number;
};

export type InternalReadChatPlanWindowInput = {
  assistantId: string;
  channel: "web" | "telegram";
  surfaceThreadKey: string;
};

export type InternalChatPlanWindowOutcome = {
  chatId: string;
  todos: RuntimeTodoItem[];
  windowed: boolean;
  totalCount: number;
};

export type InternalHydratedDurableMemoryItem = {
  id: string;
  summary: string;
  chatId: string | null;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  memoryClass: "core" | "contextual";
  kind: "fact" | "preference" | "open_loop" | null;
  /**
   * ADR-119 Slice 9 — durable-memory write provenance, mirrored from the internal
   * hydration API contract. ADR-120 Slice 1 retired the `<persai_memory>` contextual
   * push that previously rendered this as an XML attribute; the field is retained as
   * part of the typed wire contract for the surviving durable-core hydration leg.
   */
  provenance: "user_explicit" | "system_inferred" | "auto_extracted" | "legacy";
  createdAt: string;
  score: number | null;
};

export type InternalHydrateMemoryForTurnInput = {
  assistantId: string;
};

// ADR-120 Slice 1 — hydration now returns ONLY the durable core leg. The
// always-on pushed contextual short-memory block was retired; cross-chat
// recall is pull-only via the `knowledge_search` `memory` source.
export type InternalHydrateMemoryForTurnOutcome = {
  core: InternalHydratedDurableMemoryItem[];
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
  runtimeSessionId: string;
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
  runtimeSessionId: string;
  // Attachments from the user turn that triggered this document tool call.
  // Mirrors the deferred media path. The API persists them on the job so the
  // runtime worker (`RuntimeDocumentProviderAdapterService`) can inline
  // text-extractable source content into the HTML generation prompt.
  attachments: RuntimeDocumentJobRunRequest["attachments"];
  directToolExecution: {
    toolCode: "document";
    descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
    path?: string | null;
    request: RuntimeDocumentJobRunRequest["directToolExecution"]["request"];
  };
};

export type RegisterChatAttachmentKind =
  | "user_upload"
  | "image_generate"
  | "image_edit"
  | "document"
  | "files.attach"
  | "tts"
  | "video_generate";

export type RegisterChatAttachmentInput = {
  assistantId: string;
  workspaceId: string;
  channel: PersaiRuntimeChannel;
  externalThreadKey: string;
  messageId?: string | null;
  storagePath: string;
  attachmentType: "image" | "document" | "audio" | "video" | "voice";
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  kind: RegisterChatAttachmentKind;
  clientTurnId?: string | null;
  clientAttachmentId?: string | null;
};

export type RegisterChatAttachmentOutcome = {
  attachmentId: string;
  storagePath: string;
};

// ADR-074 Slice M3 — opt-in explicit close of an active open-loop entry,
// driven by the model setting `closeOpenLoop: true` on `memory_write`.
export type InternalCloseMostSimilarOpenLoopInput = {
  assistantId: string;
  referenceText: string;
  /**
   * ADR-120 Slice 2 — current user message id; the API resolves its chat so the
   * close-by-similarity match is scoped to the chat the model can see.
   */
  relatedUserMessageId: string | null;
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
  /** ADR-120 Slice 2 — current canonical chat id; open-loop refs are scoped to it. */
  chatId: string | null;
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
        docId: string;
        versionId: string;
        documentType: "presentation";
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
        typeof payload.docId === "string" &&
        typeof payload.versionId === "string" &&
        payload.documentType === "presentation"
      ) {
        return {
          accepted: true,
          jobId: payload.renderJobId,
          docId: payload.docId,
          versionId: payload.versionId,
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

  async registerChatAttachment(
    input: RegisterChatAttachmentInput
  ): Promise<RegisterChatAttachmentOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/files/chat-attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const error = this.extractError(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          error.message ?? "PersAI internal API register-chat-attachment failed."
        );
      }
      throw new BadRequestException(error.message ?? "register-chat-attachment rejected.");
    }
    const payload = this.asObject(response.body);
    if (
      payload === null ||
      typeof payload.attachmentId !== "string" ||
      typeof payload.storagePath !== "string"
    ) {
      throw new BadGatewayException("Invalid register-chat-attachment response.");
    }
    return {
      attachmentId: payload.attachmentId,
      storagePath: payload.storagePath
    };
  }

  /**
   * ADR-128 Slice 2 — list persisted workspace files from `workspace_file_metadata`
   * for a `/workspace/...` prefix. The manifest is the authoritative file index;
   * the runtime calls this instead of a sandbox `find` for `files.list`.
   * Returns one-level-deep entries; directories are derived from path
   * components.
   */
  async listWorkspaceFilesFromManifest(input: {
    workspaceId: string;
    pathPrefix: string;
    assistantId: string;
    scope: "chat" | "assistant" | "workspace";
    currentChatId: string | null;
    currentAssistantId: string;
  }): Promise<{ items: RuntimeFilesToolItem[] }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const url =
      `/api/v1/internal/workspaces/${encodeURIComponent(input.workspaceId)}/files/list` +
      `?pathPrefix=${encodeURIComponent(input.pathPrefix)}` +
      `&assistantId=${encodeURIComponent(input.assistantId)}` +
      `&scope=${encodeURIComponent(input.scope)}` +
      `&currentAssistantId=${encodeURIComponent(input.currentAssistantId)}` +
      (input.currentChatId === null
        ? ""
        : `&currentChatId=${encodeURIComponent(input.currentChatId)}`);
    const response = await this.fetchJson(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
      }
    });
    if (!response.ok) {
      const error = this.extractError(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          error.message ?? "PersAI internal API workspace files list request failed."
        );
      }
      throw new BadRequestException(
        error.message ?? "PersAI internal API rejected the workspace files list request."
      );
    }
    const payload = this.asObject(response.body);
    const items = payload?.items;
    if (!Array.isArray(items)) {
      throw new BadGatewayException(
        "PersAI internal API returned an invalid workspace files list response."
      );
    }
    const validated: RuntimeFilesToolItem[] = [];
    for (const entry of items) {
      const row = this.asObject(entry);
      if (row === null) continue;
      if (
        typeof row.path !== "string" ||
        (row.type !== "file" && row.type !== "directory") ||
        typeof row.sizeBytes !== "number" ||
        (row.mimeType !== null && typeof row.mimeType !== "string") ||
        (row.modifiedAt !== null && typeof row.modifiedAt !== "string")
      ) {
        continue;
      }
      const item: RuntimeFilesToolItem = {
        path: row.path,
        type: row.type,
        sizeBytes: row.sizeBytes,
        mimeType: row.mimeType,
        modifiedAt: row.modifiedAt
      };
      if (typeof row.shortDescription === "string") {
        item.shortDescription = row.shortDescription;
      } else if (row.shortDescription === null) {
        item.shortDescription = null;
      }
      validated.push(item);
    }
    return { items: validated };
  }

  async sumWorkspaceFileStorageBytes(input: { workspaceId: string }): Promise<number> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const url =
      `/api/v1/internal/workspaces/${encodeURIComponent(input.workspaceId)}/files/storage-bytes-used` +
      `?pathPrefix=${encodeURIComponent("/workspace")}`;
    const response = await this.fetchJson(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
      }
    });
    if (!response.ok) {
      const error = this.extractError(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          error.message ?? "PersAI internal API workspace storage bytes request failed."
        );
      }
      throw new BadRequestException(
        error.message ?? "PersAI internal API rejected the workspace storage bytes request."
      );
    }
    const payload = this.asObject(response.body);
    const usedBytes = payload?.usedBytes;
    if (typeof usedBytes !== "number" || !Number.isFinite(usedBytes) || usedBytes < 0) {
      throw new BadGatewayException(
        "PersAI internal API returned invalid workspace storage bytes payload."
      );
    }
    return usedBytes;
  }

  async getWorkspaceFileMetadata(input: { workspaceId: string; path: string }): Promise<{
    path: string;
    mimeType: string;
    sizeBytes: number;
    originChatId: string | null;
    originAssistantId: string | null;
    updatedAt: string;
  } | null> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const url =
      `/api/v1/internal/workspaces/${encodeURIComponent(input.workspaceId)}/files/metadata` +
      `?path=${encodeURIComponent(input.path)}`;
    const response = await this.fetchJson(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
      }
    });
    if (!response.ok) {
      const error = this.extractError(response.body);
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          error.message ?? "PersAI internal API workspace file metadata request failed."
        );
      }
      throw new BadRequestException(
        error.message ?? "PersAI internal API rejected the workspace file metadata request."
      );
    }
    const payload = this.asObject(response.body);
    const file = this.asObject(payload?.file);
    if (file === null) {
      return null;
    }
    if (
      typeof file.path !== "string" ||
      typeof file.mimeType !== "string" ||
      typeof file.sizeBytes !== "number" ||
      (file.originChatId !== null && typeof file.originChatId !== "string") ||
      (file.originAssistantId !== null && typeof file.originAssistantId !== "string") ||
      typeof file.updatedAt !== "string"
    ) {
      throw new BadGatewayException(
        "PersAI internal API returned invalid workspace file metadata."
      );
    }
    return {
      path: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      originChatId: file.originChatId,
      originAssistantId: file.originAssistantId,
      updatedAt: file.updatedAt
    };
  }

  async inspectDocumentInWorkspace(input: {
    assistantId: string;
    workspaceId: string;
    path: string;
    depth: "quick" | "standard" | "deep";
    outputPath: string | null;
  }): Promise<
    | {
        accepted: true;
        sourcePath: string;
        inspectPath: string;
        format: "pdf" | "xlsx" | "docx";
        editMethod: "shell_native" | "render_from_markdown";
        siblingMarkdownPath: string | null;
        extractedMdPath: string | null;
        counts: {
          pageCount: number | null;
          sheetCount: number | null;
          formulaCount: number | null;
          blankSheetCount: number | null;
          paragraphCount: number | null;
          headingCount: number | null;
          tableCount: number | null;
          textCharCount: number | null;
        };
        warnings: string[];
        suggestedReadPaths: string[];
      }
    | {
        accepted: false;
        code: string;
        message: string;
      }
  > {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/document-inspect", {
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
        typeof payload.sourcePath === "string" &&
        typeof payload.inspectPath === "string" &&
        (payload.format === "pdf" || payload.format === "xlsx" || payload.format === "docx")
      ) {
        const counts = this.asObject(payload.counts);
        return {
          accepted: true,
          sourcePath: payload.sourcePath,
          inspectPath: payload.inspectPath,
          format: payload.format,
          editMethod:
            payload.editMethod === "render_from_markdown" ? "render_from_markdown" : "shell_native",
          siblingMarkdownPath:
            typeof payload.siblingMarkdownPath === "string" ? payload.siblingMarkdownPath : null,
          extractedMdPath:
            typeof payload.extractedMdPath === "string" ? payload.extractedMdPath : null,
          counts: {
            pageCount: typeof counts?.pageCount === "number" ? counts.pageCount : null,
            sheetCount: typeof counts?.sheetCount === "number" ? counts.sheetCount : null,
            formulaCount: typeof counts?.formulaCount === "number" ? counts.formulaCount : null,
            blankSheetCount:
              typeof counts?.blankSheetCount === "number" ? counts.blankSheetCount : null,
            paragraphCount:
              typeof counts?.paragraphCount === "number" ? counts.paragraphCount : null,
            headingCount: typeof counts?.headingCount === "number" ? counts.headingCount : null,
            tableCount: typeof counts?.tableCount === "number" ? counts.tableCount : null,
            textCharCount: typeof counts?.textCharCount === "number" ? counts.textCharCount : null
          },
          warnings: Array.isArray(payload.warnings)
            ? payload.warnings.filter((entry): entry is string => typeof entry === "string")
            : [],
          suggestedReadPaths: Array.isArray(payload.suggestedReadPaths)
            ? payload.suggestedReadPaths.filter(
                (entry): entry is string => typeof entry === "string"
              )
            : []
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
          message: payload.message
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid document inspect response."
      );
    }
    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API document inspect request failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the document inspect request."
    );
  }

  /**
   * ADR-128 Slice 2 — upsert a `workspace_file_metadata` row after a successful
   * runtime `files.write` on a persisted `/workspace/...` path. The API is the only writer of
   * the manifest; the runtime is the only caller of this endpoint.
   */
  async upsertWorkspaceFileMetadata(input: {
    workspaceId: string;
    path: string;
    mimeType: string;
    sizeBytes: number;
    contentHash?: string | null;
    replace?: boolean;
    shortDescription?: string | null;
    originChatId?: string | null;
    originAssistantId?: string | null;
    sourceUserMessageText?: string | null;
    sourceUserMessageCreatedAt?: string | null;
  }): Promise<{
    documentRegistration: {
      registered: boolean;
      versionNumber: number | null;
      bumped: boolean;
      isOverwrite: boolean;
      contentChanged: boolean;
    } | null;
  }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const url = `/api/v1/internal/workspaces/${encodeURIComponent(input.workspaceId)}/files/metadata`;
    const response = await this.fetchJson(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: input.path,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        ...(input.contentHash === undefined || input.contentHash === null
          ? {}
          : { contentHash: input.contentHash }),
        ...(input.replace === undefined ? {} : { replace: input.replace }),
        ...(input.shortDescription === undefined || input.shortDescription === null
          ? {}
          : { shortDescription: input.shortDescription }),
        ...(input.originChatId === undefined || input.originChatId === null
          ? {}
          : { originChatId: input.originChatId }),
        ...(input.originAssistantId === undefined || input.originAssistantId === null
          ? {}
          : { originAssistantId: input.originAssistantId }),
        ...(input.sourceUserMessageText === undefined || input.sourceUserMessageText === null
          ? {}
          : { sourceUserMessageText: input.sourceUserMessageText }),
        ...(input.sourceUserMessageCreatedAt === undefined ||
        input.sourceUserMessageCreatedAt === null
          ? {}
          : { sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt })
      })
    });
    if (response.status === 204) {
      return { documentRegistration: null };
    }
    if (response.ok) {
      const body =
        response.body !== null && typeof response.body === "object" && !Array.isArray(response.body)
          ? (response.body as {
              documentRegistration?: {
                registered: boolean;
                versionNumber: number | null;
                bumped: boolean;
                isOverwrite: boolean;
                contentChanged: boolean;
              } | null;
            })
          : null;
      return {
        documentRegistration: body?.documentRegistration ?? null
      };
    }
    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API workspace file metadata upsert failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the workspace file metadata upsert."
    );
  }

  async deleteWorkspaceFileFromManifest(input: {
    workspaceId: string;
    path: string;
  }): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const url =
      `/api/v1/internal/workspaces/${encodeURIComponent(input.workspaceId)}/files/metadata` +
      `?path=${encodeURIComponent(input.path)}`;
    const response = await this.fetchJson(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
      }
    });
    if (response.status === 204 || response.ok || response.status === 404) {
      return;
    }
    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API workspace file metadata delete failed."
      );
    }
    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the workspace file metadata delete."
    );
  }

  /**
   * ADR-126 v3 — batch join `workspace_file_metadata.shortDescription`
   * by pod-absolute path. Returns `{path, shortDescription | null}[]` for the
   * runtime `files.list` enrichment.
   */
  async listWorkspaceFileShortDescriptions(input: {
    workspaceId: string;
    paths: readonly string[];
  }): Promise<
    Array<{
      path: string;
      shortDescription: string | null;
      documentVersionNumber: number | null;
    }>
  > {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    if (input.paths.length === 0) {
      return [];
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/files/short-descriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ workspaceId: input.workspaceId, paths: [...input.paths] })
    });
    if (!response.ok) {
      if (response.status >= 500) {
        throw new ServiceUnavailableException(
          "PersAI internal API short-descriptions request failed."
        );
      }
      return input.paths.map((path) => ({
        path,
        shortDescription: null,
        documentVersionNumber: null
      }));
    }
    const payload = this.asObject(response.body);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    return rows
      .filter(
        (
          entry
        ): entry is { path: unknown; shortDescription: unknown; documentVersionNumber: unknown } =>
          entry !== null && typeof entry === "object"
      )
      .map((entry) => ({
        path: typeof entry.path === "string" ? entry.path : "",
        shortDescription:
          typeof entry.shortDescription === "string" && entry.shortDescription.length > 0
            ? entry.shortDescription
            : null,
        documentVersionNumber:
          typeof entry.documentVersionNumber === "number" &&
          Number.isFinite(entry.documentVersionNumber) &&
          entry.documentVersionNumber > 0
            ? Math.floor(entry.documentVersionNumber)
            : null
      }))
      .filter((row) => row.path.length > 0);
  }

  async searchWorkspaceFiles(input: {
    workspaceId: string;
    assistantId: string;
    sessionId: string;
    query: string;
    pathPrefix?: string | null;
  }): Promise<
    Array<{
      path: string;
      mimeType: string;
      sizeBytes: number;
      shortDescription: string | null;
      matchedTokenCount: number;
    }>
  > {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/files/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        sessionId: input.sessionId,
        query: input.query,
        ...(input.pathPrefix === undefined || input.pathPrefix === null
          ? {}
          : { pathPrefix: input.pathPrefix })
      })
    });
    if (!response.ok) {
      if (response.status >= 500) {
        throw new ServiceUnavailableException("PersAI internal API files search request failed.");
      }
      return [];
    }
    const payload = this.asObject(response.body);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items
      .filter(
        (entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object"
      )
      .map((entry) => ({
        path: typeof entry.path === "string" ? entry.path : "",
        mimeType: typeof entry.mimeType === "string" ? entry.mimeType : "application/octet-stream",
        sizeBytes: typeof entry.sizeBytes === "number" ? entry.sizeBytes : 0,
        shortDescription:
          typeof entry.shortDescription === "string" && entry.shortDescription.length > 0
            ? entry.shortDescription
            : null,
        matchedTokenCount: typeof entry.matchedTokenCount === "number" ? entry.matchedTokenCount : 0
      }))
      .filter((row) => row.path.length > 0);
  }

  async grepWorkspaceFiles(input: {
    workspaceId: string;
    assistantId: string;
    sessionId: string;
    pattern: string;
    path?: string | null;
    glob?: string | null;
    type?: string | null;
    caseInsensitive?: boolean;
  }): Promise<{
    matches: Array<{ file: string; line: number; text: string }>;
    truncated: boolean;
    reason: string | null;
    warning: string | null;
  }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/files/grep", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      if (response.status >= 500) {
        throw new ServiceUnavailableException("PersAI internal API files grep request failed.");
      }
      return { matches: [], truncated: false, reason: "grep_failed", warning: null };
    }
    const payload = this.asObject(response.body);
    const matches = Array.isArray(payload?.matches) ? payload.matches : [];
    return {
      matches: matches
        .filter(
          (entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object"
        )
        .map((entry) => ({
          file: typeof entry.file === "string" ? entry.file : "",
          line: typeof entry.line === "number" ? entry.line : 0,
          text: typeof entry.text === "string" ? entry.text : ""
        }))
        .filter((row) => row.file.length > 0 && row.line > 0),
      truncated: payload?.truncated === true,
      reason: typeof payload?.reason === "string" ? payload.reason : null,
      warning: typeof payload?.warning === "string" ? payload.warning : null
    };
  }

  async globWorkspaceFiles(input: {
    workspaceId: string;
    assistantId: string;
    sessionId: string;
    pattern: string;
    path?: string | null;
  }): Promise<{
    paths: string[];
    truncated: boolean;
    reason: string | null;
    warning: string | null;
  }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    const response = await this.fetchJson("/api/v1/internal/runtime/files/glob", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      if (response.status >= 500) {
        throw new ServiceUnavailableException("PersAI internal API files glob request failed.");
      }
      return { paths: [], truncated: false, reason: "glob_failed", warning: null };
    }
    const payload = this.asObject(response.body);
    const paths = Array.isArray(payload?.paths) ? payload.paths : [];
    return {
      paths: paths.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0
      ),
      truncated: payload?.truncated === true,
      reason: typeof payload?.reason === "string" ? payload.reason : null,
      warning: typeof payload?.warning === "string" ? payload.warning : null
    };
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
        assistantId: input.assistantId
      })
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const core = payload?.core;
      if (
        payload?.ok === true &&
        Array.isArray(core) &&
        core.every((item) => this.isHydratedDurableMemoryItem(item))
      ) {
        return {
          core: core as InternalHydratedDurableMemoryItem[]
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

  // ADR-118 Slice 2: skill tool internal API call.
  async updateSkillState(input: {
    assistantId: string;
    channel: string;
    surfaceThreadKey: string;
    action: "engage" | "release";
    skillId: string | null;
    scenarioKey: string | null;
  }): Promise<{
    skillId: string;
    skillDisplayName: string;
    previousSkillId: string | null;
  }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/skill/state", {
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
        return {
          skillId: typeof payload.skillId === "string" ? payload.skillId : "",
          skillDisplayName:
            typeof payload.skillDisplayName === "string" ? payload.skillDisplayName : "",
          previousSkillId:
            typeof payload.previousSkillId === "string" ? payload.previousSkillId : null
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid skill state response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API skill state request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the skill state request."
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

  /**
   * ADR-109 Slice 7 — fetch a workspace video persona by id for the talking-avatar
   * runtime execution path. Read-only (invariant #14 — no writes from runtime).
   *
   * Returns null when:
   *  - The persona does not exist in the given workspace.
   *  - The persona is archived.
   *  - The internal API returns 404.
   *
   * Throws `ServiceUnavailableException` on 5xx / network / timeout errors so
   * the calling tool-service can surface `talking_avatar_persona_unavailable`
   * honestly instead of silently swallowing failures.
   */
  async fetchWorkspaceVideoPersona(input: { workspaceId: string; personaId: string }): Promise<{
    id: string;
    displayName: string;
    heygenAvatarId: string;
    heygenVoiceId: string;
    heygenVoiceLabel: string;
    videoFormat: "16:9" | "9:16" | "1:1";
    clonedVoiceId: string | null;
    linkedClonedVoiceDisplayName: string | null;
    linkedClonedVoiceProviderId: string | null;
    portraitImageStorageKey: string;
  } | null> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const urlPath = `/api/v1/internal/runtime/workspaces/${encodeURIComponent(input.workspaceId)}/video-personas/${encodeURIComponent(input.personaId)}`;
    const response = await this.fetchJson(urlPath, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
      }
    });

    if (response.status === 404) {
      return null;
    }

    if (response.ok) {
      const payload = this.asObject(response.body);
      const persona = this.asObject(payload?.persona);
      if (
        payload?.schema === "persai.internalRuntimeWorkspaceVideoPersonaResponse.v1" &&
        persona !== null &&
        typeof persona.id === "string" &&
        typeof persona.displayName === "string" &&
        typeof persona.heygenAvatarId === "string" &&
        typeof persona.heygenVoiceId === "string" &&
        typeof persona.heygenVoiceLabel === "string" &&
        (persona.videoFormat === "16:9" ||
          persona.videoFormat === "9:16" ||
          persona.videoFormat === "1:1") &&
        (persona.clonedVoiceId === null || typeof persona.clonedVoiceId === "string") &&
        (persona.linkedClonedVoiceDisplayName === null ||
          typeof persona.linkedClonedVoiceDisplayName === "string") &&
        (persona.linkedClonedVoiceProviderId === null ||
          typeof persona.linkedClonedVoiceProviderId === "string") &&
        typeof persona.portraitImageStorageKey === "string"
      ) {
        return {
          id: persona.id,
          displayName: persona.displayName,
          heygenAvatarId: persona.heygenAvatarId,
          heygenVoiceId: persona.heygenVoiceId,
          heygenVoiceLabel: persona.heygenVoiceLabel,
          videoFormat: persona.videoFormat,
          clonedVoiceId: persona.clonedVoiceId ?? null,
          linkedClonedVoiceDisplayName: persona.linkedClonedVoiceDisplayName ?? null,
          linkedClonedVoiceProviderId: persona.linkedClonedVoiceProviderId ?? null,
          portraitImageStorageKey: persona.portraitImageStorageKey
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid workspace video persona response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API workspace video persona request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the workspace video persona request."
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

  private isHydratedDurableMemoryItem(value: unknown): value is InternalHydratedDurableMemoryItem {
    const row = this.asObject(value);
    return (
      row !== null &&
      typeof row.id === "string" &&
      typeof row.summary === "string" &&
      (row.chatId === null || typeof row.chatId === "string") &&
      (row.sourceType === "web_chat" || row.sourceType === "memory_write") &&
      (row.sourceLabel === null || typeof row.sourceLabel === "string") &&
      (row.memoryClass === "core" || row.memoryClass === "contextual") &&
      (row.kind === null ||
        row.kind === "fact" ||
        row.kind === "preference" ||
        row.kind === "open_loop") &&
      (row.provenance === "user_explicit" ||
        row.provenance === "system_inferred" ||
        row.provenance === "auto_extracted" ||
        row.provenance === "legacy") &&
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
      (row.layer === null || row.layer === "long" || row.layer === "short") &&
      (row.confidence === null ||
        (typeof row.confidence === "number" &&
          Number.isFinite(row.confidence) &&
          row.confidence >= 0 &&
          row.confidence <= 1)) &&
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
        row.toolCode === "video_generate" ||
        row.toolCode === "document") &&
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
        row.toolCode === "video_generate" ||
        row.toolCode === "document") &&
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
    if (row === null) return false;
    // ADR-108 Slice 7: discriminated union — route validation by `kind`.
    if (row.kind === "vcoin") {
      // vcoin variant: video_generate only.
      return (
        row.toolCode === "video_generate" &&
        typeof row.displayName === "string" &&
        this.isNonNegativeInteger(row.balanceVc) &&
        this.isNonNegativeInteger(row.monthlyGrantVc) &&
        (row.typicalVideoCostVc === null || this.isNonNegativeInteger(row.typicalVideoCostVc)) &&
        (row.typicalVideoSeconds === null ||
          (typeof row.typicalVideoSeconds === "number" &&
            Number.isFinite(row.typicalVideoSeconds) &&
            row.typicalVideoSeconds >= 0)) &&
        typeof row.typicalCostFromPlatformFallback === "boolean" &&
        (row.status === "ok" || row.status === "balance_exhausted")
      );
    }
    // units variant (kind: "units" or legacy rows without kind field).
    return (
      (row.toolCode === "image_generate" ||
        row.toolCode === "image_edit" ||
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

  // ADR-125 Slice 1 — todo_write internal API surface.
  async applyTodoWriteAction(input: InternalApplyTodoWriteInput): Promise<InternalChatPlanOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/chat-todos/apply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const outcome = this.parseChatPlanApplyOutcome(response.body);
      if (outcome !== null) {
        return outcome;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid chat-todos apply response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API chat-todos apply request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the chat-todos apply request."
    );
  }

  async readChatPlanWindow(
    input: InternalReadChatPlanWindowInput
  ): Promise<InternalChatPlanWindowOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }
    if (input.assistantId.trim().length === 0 || input.surfaceThreadKey.trim().length === 0) {
      throw new BadRequestException(
        "assistantId and surfaceThreadKey are required for chat-plan window."
      );
    }

    const url =
      "/api/v1/internal/runtime/chat-todos/window" +
      `?assistantId=${encodeURIComponent(input.assistantId)}` +
      `&channel=${encodeURIComponent(input.channel)}` +
      `&surfaceThreadKey=${encodeURIComponent(input.surfaceThreadKey)}`;

    const response = await this.fetchJson(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
      }
    });

    if (response.ok) {
      const outcome = this.parseChatPlanWindowOutcome(response.body);
      if (outcome !== null) {
        return outcome;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid chat-todos window response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API chat-todos window request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the chat-todos window request."
    );
  }

  async listBrowserProfiles(input: {
    assistantId: string;
  }): Promise<RuntimeBrowserProfileListItem[]> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/browser-profiles/list", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      if (payload?.ok === true && Array.isArray(payload.profiles)) {
        const profiles: RuntimeBrowserProfileListItem[] = [];
        for (const entry of payload.profiles) {
          const row = this.asObject(entry);
          if (
            row === null ||
            typeof row.profileKey !== "string" ||
            typeof row.displayName !== "string" ||
            typeof row.status !== "string" ||
            typeof row.originHost !== "string" ||
            (row.lastUsedAt !== null && typeof row.lastUsedAt !== "string")
          ) {
            continue;
          }
          profiles.push({
            profileKey: row.profileKey,
            displayName: row.displayName,
            status: row.status as RuntimeBrowserProfileListItem["status"],
            originHost: row.originHost,
            lastUsedAt: row.lastUsedAt as string | null
          });
        }
        return profiles;
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid browser-profiles list response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API browser-profiles list request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the browser-profiles list request."
    );
  }

  async resolveBrowserProfile(input: {
    assistantId: string;
    profileKey: string;
  }): Promise<ResolveBrowserProfileOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/browser-profiles/resolve", {
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
        if (typeof payload.profileId !== "string" || typeof payload.bridgeSessionRef !== "string") {
          throw new BadGatewayException(
            "PersAI internal API returned an invalid browser-profiles resolve response."
          );
        }
        return {
          ok: true,
          profileId: payload.profileId,
          bridgeSessionRef: payload.bridgeSessionRef
        };
      }
      if (
        payload?.ok === false &&
        typeof payload.reason === "string" &&
        (PERSAI_RUNTIME_BROWSER_PROFILE_ERROR_REASONS as readonly string[]).includes(payload.reason)
      ) {
        const pendingBrowserLogin = this.parsePendingBrowserLoginState(payload.pendingBrowserLogin);
        return {
          ok: false,
          reason: payload.reason as PersaiRuntimeBrowserProfileErrorReason,
          ...(pendingBrowserLogin === null ? {} : { pendingBrowserLogin })
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid browser-profiles resolve response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API browser-profiles resolve request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the browser-profiles resolve request."
    );
  }

  private parsePendingBrowserLoginState(input: unknown): PendingBrowserLoginState | null {
    const row = this.asObject(input);
    const bridgeClientKind =
      row?.bridgeClientKind === "extension" || row?.bridgeClientKind === "capacitor"
        ? row.bridgeClientKind
        : null;
    if (
      typeof row?.profileId !== "string" ||
      typeof row?.profileKey !== "string" ||
      typeof row?.displayName !== "string" ||
      typeof row?.loginUrl !== "string" ||
      bridgeClientKind === null
    ) {
      return null;
    }
    const completionMode =
      row.completionMode === "assist" || row.completionMode === "login"
        ? row.completionMode
        : undefined;
    return {
      profileId: row.profileId,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      bridgeClientKind,
      ...(completionMode === undefined ? {} : { completionMode })
    };
  }

  async startBrowserLogin(input: {
    assistantId: string;
    workspaceId: string;
    displayName: string;
    loginUrl: string;
    browserCredentialSecretId?: string;
    originatingChatId?: string | null;
  }): Promise<StartBrowserLoginOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/browser-profiles/start-login", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (response.ok) {
      const payload = this.asObject(response.body);
      const bridgeClientKind =
        payload?.bridgeClientKind === "extension" || payload?.bridgeClientKind === "capacitor"
          ? payload.bridgeClientKind
          : null;
      if (
        payload?.ok === true &&
        typeof payload.profileId === "string" &&
        typeof payload.profileKey === "string" &&
        typeof payload.displayName === "string" &&
        typeof payload.loginUrl === "string" &&
        bridgeClientKind !== null &&
        typeof payload.status === "string"
      ) {
        return {
          profileId: payload.profileId,
          profileKey: payload.profileKey,
          displayName: payload.displayName,
          loginUrl: payload.loginUrl,
          bridgeClientKind,
          status: payload.status as RuntimeBrowserLoginResult["status"]
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid browser-profiles start-login response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API browser-profiles start-login request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the browser-profiles start-login request."
    );
  }

  async dispatchLocalBrowserCommand(
    input: LocalBrowserBridgeDispatchCommandRequest
  ): Promise<DispatchLocalBrowserCommandOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/browser-bridge/dispatch", {
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
        payload?.accepted === true &&
        typeof payload.commandId === "string" &&
        typeof payload.bridgeDeviceId === "string"
      ) {
        return {
          accepted: true,
          commandId: payload.commandId,
          bridgeDeviceId: payload.bridgeDeviceId
        };
      }
      if (
        payload?.accepted === false &&
        typeof payload.commandId === "string" &&
        typeof payload.code === "string" &&
        typeof payload.message === "string"
      ) {
        return {
          accepted: false,
          commandId: payload.commandId,
          code: payload.code,
          message: payload.message,
          ...(Array.isArray(payload.activeBridgeDeviceIds)
            ? {
                activeBridgeDeviceIds: payload.activeBridgeDeviceIds.filter(
                  (entry): entry is string => typeof entry === "string"
                )
              }
            : {}),
          ...(payload.requestedBridgeDeviceId === null ||
          typeof payload.requestedBridgeDeviceId === "string"
            ? { requestedBridgeDeviceId: payload.requestedBridgeDeviceId }
            : {})
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid browser-bridge dispatch response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API browser-bridge dispatch request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the browser-bridge dispatch request."
    );
  }

  async getLocalBrowserCommandResult(
    commandId: string
  ): Promise<LocalBrowserBridgeGetCommandResultResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson(
      `/api/v1/internal/runtime/browser-bridge/result/${encodeURIComponent(commandId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.PERSAI_INTERNAL_API_TOKEN}`
        }
      }
    );

    if (response.ok) {
      const payload = this.asObject(response.body);
      if (payload?.status === "pending") {
        return { status: "pending" };
      }
      if (payload?.status === "completed") {
        return {
          status: "completed",
          ...(payload.result === undefined
            ? {}
            : { result: this.parseLocalBrowserResult(payload.result) })
        };
      }
      throw new BadGatewayException(
        "PersAI internal API returned an invalid browser-bridge result response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API browser-bridge result request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the browser-bridge result request."
    );
  }

  async touchBrowserProfile(input: {
    assistantId: string;
    workspaceId: string;
    profileKey: string;
  }): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("PersAI internal API base URL is not configured.");
    }

    const response = await this.fetchJson("/api/v1/internal/runtime/browser-profiles/touch", {
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
        "PersAI internal API returned an invalid browser-profiles touch response."
      );
    }

    const error = this.extractError(response.body);
    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        error.message ?? "PersAI internal API browser-profiles touch request failed."
      );
    }

    throw new BadRequestException(
      error.message ?? "PersAI internal API rejected the browser-profiles touch request."
    );
  }

  private parseLocalBrowserResult(input: unknown): LocalBrowserResult | null {
    const row = this.asObject(input);
    if (row === null || typeof row.commandId !== "string" || typeof row.ok !== "boolean") {
      return null;
    }
    const result: LocalBrowserResult = {
      commandId: row.commandId,
      ok: row.ok
    };
    if (typeof row.finalUrl === "string" || row.finalUrl === null) {
      result.finalUrl = row.finalUrl;
    }
    if (typeof row.title === "string" || row.title === null) {
      result.title = row.title;
    }
    if (typeof row.content === "string" || row.content === null) {
      result.content = row.content;
    }
    if (typeof row.truncated === "boolean" || row.truncated === null) {
      result.truncated = row.truncated;
    }
    if (Array.isArray(row.elements)) {
      result.elements = row.elements as NonNullable<LocalBrowserResult["elements"]>;
    }
    if (Array.isArray(row.extracted)) {
      result.extracted = row.extracted as NonNullable<LocalBrowserResult["extracted"]>;
    }
    if (typeof row.warning === "string" || row.warning === null) {
      result.warning = row.warning;
    }
    const artifact = this.asObject(row.artifact);
    if (
      artifact !== null &&
      typeof artifact.mimeType === "string" &&
      typeof artifact.base64 === "string"
    ) {
      result.artifact = {
        mimeType: artifact.mimeType,
        base64: artifact.base64
      };
    }
    if (typeof row.errorReason === "string" || row.errorReason === null) {
      result.errorReason = row.errorReason;
    }
    return result;
  }

  private parseChatPlanApplyOutcome(value: unknown): InternalChatPlanOutcome | null {
    const payload = this.asObject(value);
    if (payload === null || payload.ok !== true) return null;
    const todos = this.parseRuntimeTodoItemArray(payload.todos);
    if (todos === null) return null;
    if (
      typeof payload.chatId !== "string" ||
      typeof payload.windowed !== "boolean" ||
      !this.isNonNegativeInteger(payload.totalCount) ||
      (payload.action !== "applied" && payload.action !== "skipped") ||
      (payload.reason !== null && typeof payload.reason !== "string") ||
      (payload.warning !== null && typeof payload.warning !== "string")
    ) {
      return null;
    }
    return {
      chatId: payload.chatId,
      action: payload.action,
      reason: payload.reason as string | null,
      warning: payload.warning as string | null,
      todos,
      windowed: payload.windowed,
      totalCount: payload.totalCount
    };
  }

  private parseChatPlanWindowOutcome(value: unknown): InternalChatPlanWindowOutcome | null {
    const payload = this.asObject(value);
    if (payload === null || payload.ok !== true) return null;
    const todos = this.parseRuntimeTodoItemArray(payload.todos);
    if (todos === null) return null;
    if (
      typeof payload.chatId !== "string" ||
      typeof payload.windowed !== "boolean" ||
      !this.isNonNegativeInteger(payload.totalCount)
    ) {
      return null;
    }
    return {
      chatId: payload.chatId,
      todos,
      windowed: payload.windowed,
      totalCount: payload.totalCount
    };
  }

  private parseRuntimeTodoItemArray(value: unknown): RuntimeTodoItem[] | null {
    if (!Array.isArray(value)) return null;
    const items: RuntimeTodoItem[] = [];
    for (const entry of value) {
      const row = this.asObject(entry);
      if (row === null) return null;
      if (
        typeof row.id !== "string" ||
        (row.parentId !== null && typeof row.parentId !== "string") ||
        typeof row.content !== "string" ||
        typeof row.status !== "string" ||
        !PERSAI_RUNTIME_TODO_WRITE_STATUSES.includes(row.status as PersaiRuntimeTodoWriteStatus)
      ) {
        return null;
      }
      items.push({
        id: row.id,
        parentId: row.parentId as string | null,
        content: row.content,
        status: row.status as PersaiRuntimeTodoWriteStatus
      });
    }
    return items;
  }
}
