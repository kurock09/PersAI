import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  RuntimeAttachmentRef,
  RuntimeImageEditRequest,
  RuntimeImageGenerateRequest,
  RuntimeMediaJobRunRequest,
  RuntimeVideoGenerateRequest
} from "@persai/runtime-contract";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import {
  InternalRuntimeMediaJobClientService,
  type InternalRuntimeMediaJobRunOutcome
} from "./internal-runtime-media-job.client.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { AssistantMediaJobCompletionDeliveryService } from "./assistant-media-job-completion-delivery.service";
import { AssistantMediaJobCompletionTurnService } from "./assistant-media-job-completion-turn.service";
import {
  buildAssistantMediaJobFailureMessage,
  inferAssistantMediaJobFailureLocale
} from "./assistant-media-job-failure-copy.service";

type FailJobContext = {
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
};

const MEDIA_JOB_POLL_INTERVAL_MS = 5_000;
const MEDIA_JOB_BATCH_SIZE = 4;
const MEDIA_JOB_CLAIM_TTL_MS = 10 * 60 * 1000;
const MEDIA_JOB_RETRY_BASE_DELAY_MS = 30_000;
const MEDIA_JOB_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const MEDIA_JOB_LAST_ERROR_MAX_CHARS = 1_000;

type MediaJobKind = "image" | "audio" | "video";

type DirectToolExecutionPayload =
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

type MediaJobRequestPayload = {
  attachments: RuntimeAttachmentRef[];
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  directToolExecution: DirectToolExecutionPayload;
};

type ClaimedMediaJob = {
  id: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  kind: MediaJobKind;
  sourceUserMessageId: string;
  requestJson: unknown;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string;
};

function truncateLastError(message: string): string {
  if (message.length <= MEDIA_JOB_LAST_ERROR_MAX_CHARS) {
    return message;
  }
  return `${message.slice(0, MEDIA_JOB_LAST_ERROR_MAX_CHARS - 3)}...`;
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    MEDIA_JOB_RETRY_MAX_DELAY_MS,
    MEDIA_JOB_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1)
  );
}

@Injectable()
export class AssistantMediaJobSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantMediaJobSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly internalRuntimeMediaJobClientService: InternalRuntimeMediaJobClientService,
    private readonly assistantMediaJobCompletionDeliveryService: AssistantMediaJobCompletionDeliveryService,
    private readonly assistantMediaJobCompletionTurnService: AssistantMediaJobCompletionTurnService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(MEDIA_JOB_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueJobsBatch(limit = MEDIA_JOB_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimDueJobs(limit);
    for (const job of claimed) {
      await this.processClaimedJob(job);
    }
    return claimed.length;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.scheduleNext(MEDIA_JOB_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      let processed = 0;
      while (!this.stopped) {
        const [runCount, deliveryCount] = await Promise.all([
          this.processDueJobsBatch(),
          this.assistantMediaJobCompletionDeliveryService.processPendingBatch()
        ]);
        processed += runCount + deliveryCount;
        if (runCount < MEDIA_JOB_BATCH_SIZE && deliveryCount < MEDIA_JOB_BATCH_SIZE) {
          break;
        }
      }
      if (processed > 0) {
        this.logger.log(`Processed ${processed} assistant media job(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Assistant media-job scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
      this.scheduleNext(MEDIA_JOB_POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(limit: number): Promise<ClaimedMediaJob[]> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + MEDIA_JOB_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          workspaceId: string;
          chatId: string;
          surface: "web" | "telegram";
          kind: MediaJobKind;
          sourceUserMessageId: string | null;
          requestJson: unknown;
          attemptCount: number;
          maxAttempts: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id" AS "assistantId",
          "workspace_id" AS "workspaceId",
          "chat_id" AS "chatId",
          "surface"::text AS "surface",
          "kind"::text AS "kind",
          "source_user_message_id" AS "sourceUserMessageId",
          "request_json" AS "requestJson",
          "attempt_count" AS "attemptCount",
          "max_attempts" AS "maxAttempts"
        FROM "assistant_media_jobs"
        WHERE (
            "status" = 'queued'
            AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          )
          OR (
            "status" = 'running'
            AND "scheduler_claim_expires_at" IS NOT NULL
            AND "scheduler_claim_expires_at" <= NOW()
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedMediaJob[] = [];
      for (const row of rows) {
        if (typeof row.sourceUserMessageId !== "string" || row.sourceUserMessageId.length === 0) {
          continue;
        }
        const claimToken = randomUUID();
        const nextAttemptCount = row.attemptCount + 1;
        await tx.assistantMediaJob.update({
          where: { id: row.id },
          data: {
            status: "running",
            attemptCount: nextAttemptCount,
            schedulerClaimToken: claimToken,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt,
            ...(row.attemptCount === 0 ? { startedAt: now } : {}),
            completedAt: null,
            failedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        claimed.push({
          id: row.id,
          assistantId: row.assistantId,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          surface: row.surface,
          kind: row.kind,
          sourceUserMessageId: row.sourceUserMessageId,
          requestJson: row.requestJson,
          attemptCount: nextAttemptCount,
          maxAttempts: row.maxAttempts,
          claimToken
        });
      }
      return claimed;
    });
  }

  private async processClaimedJob(job: ClaimedMediaJob): Promise<void> {
    const requestPayload = this.parseRequestPayload(job.requestJson);
    if (requestPayload === null) {
      await this.failJob(
        job,
        false,
        "invalid_request_payload",
        "Media job request payload is invalid.",
        "en"
      );
      return;
    }

    const failContext: FailJobContext = {
      sourceUserMessageText: requestPayload.sourceUserMessageText,
      sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt
    };

    const assistant = await this.assistantRepository.findById(job.assistantId);
    if (assistant === null) {
      await this.failJob(
        job,
        false,
        "assistant_not_found",
        "Assistant not found.",
        inferAssistantMediaJobFailureLocale({ sourceText: requestPayload.sourceUserMessageText })
        // No LLM framing: the assistant record itself is missing, so bundle hydration would fail.
      );
      return;
    }

    const resolvedRuntimeContext =
      await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(job.assistantId);
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      await this.failJob(
        job,
        false,
        "runtime_bundle_missing",
        "Assistant runtime bundle is not materialized.",
        inferAssistantMediaJobFailureLocale({ sourceText: requestPayload.sourceUserMessageText })
        // No LLM framing: the runtime bundle isn't available, so the framing call cannot succeed.
      );
      return;
    }

    const locale = inferAssistantMediaJobFailureLocale({
      preferredLocale: this.extractPreferredLocale(spec.runtimeBundleDocument),
      sourceText: requestPayload.sourceUserMessageText
    });

    const outcome = await this.internalRuntimeMediaJobClientService.run({
      assistantId: job.assistantId,
      workspaceId: job.workspaceId,
      runtimeTier: resolvedRuntimeContext.runtimeTier,
      runtimeBundleDocument: spec.runtimeBundleDocument,
      job: {
        id: job.id,
        surface: job.surface,
        kind: job.kind,
        chatId: job.chatId,
        sourceUserMessageId: job.sourceUserMessageId,
        sourceUserMessageText: requestPayload.sourceUserMessageText,
        sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt
      },
      attachments: requestPayload.attachments,
      directToolExecution: requestPayload.directToolExecution
    } satisfies RuntimeMediaJobRunRequest);

    if (!outcome.ok) {
      await this.handleFailedExecution(job, outcome, locale, failContext);
      return;
    }

    if (outcome.result.artifacts.length === 0) {
      await this.failJob(
        job,
        false,
        "media_job_artifacts_missing",
        "Media job worker completed without any deliverable artifacts.",
        locale,
        failContext
      );
      return;
    }

    await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        status: "completion_pending",
        resultText: outcome.result.assistantText,
        artifactsJson: outcome.result.artifacts as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        nextRetryAt: null,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });
  }

  private async handleFailedExecution(
    job: ClaimedMediaJob,
    outcome: Extract<InternalRuntimeMediaJobRunOutcome, { ok: false }>,
    locale: "ru" | "en",
    context: FailJobContext
  ): Promise<void> {
    const canRetry = outcome.retryable && job.attemptCount < job.maxAttempts;
    if (canRetry) {
      const retryAfterAt = new Date(Date.now() + computeRetryBackoffMs(job.attemptCount));
      await this.prisma.assistantMediaJob.updateMany({
        where: { id: job.id, schedulerClaimToken: job.claimToken },
        data: {
          status: "queued",
          nextRetryAt: retryAfterAt,
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          lastErrorCode: outcome.code,
          lastErrorMessage: truncateLastError(outcome.message)
        }
      });
      return;
    }

    await this.failJob(job, false, outcome.code, outcome.message, locale, context);
  }

  private async failJob(
    job: ClaimedMediaJob,
    retryable: boolean,
    code: string | null,
    message: string,
    locale: "ru" | "en",
    context?: FailJobContext
  ): Promise<void> {
    const llmAuthored =
      context === undefined
        ? null
        : await this.tryLlmAuthoredFailureCopy(job, retryable, code, message, context);
    const failureMessage =
      llmAuthored ??
      buildAssistantMediaJobFailureMessage({
        kind: job.kind,
        code,
        message,
        locale
      });
    let completionAssistantMessageId: string | null = null;

    try {
      const created = await this.assistantChatRepository.createMessage({
        chatId: job.chatId,
        assistantId: job.assistantId,
        author: "assistant",
        content: failureMessage
      });
      completionAssistantMessageId = created.id;
    } catch (error) {
      this.logger.warn(
        `Failed to create terminal media-job failure message for ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        status: "failed",
        failedAt: new Date(),
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: code,
        lastErrorMessage: truncateLastError(message),
        ...(completionAssistantMessageId === null ? {} : { completionAssistantMessageId })
      }
    });
  }

  private async tryLlmAuthoredFailureCopy(
    job: ClaimedMediaJob,
    retryable: boolean,
    code: string | null,
    message: string,
    context: FailJobContext
  ): Promise<string | null> {
    try {
      return await this.assistantMediaJobCompletionTurnService.maybeFrameFailure({
        id: job.id,
        assistantId: job.assistantId,
        workspaceId: job.workspaceId,
        chatId: job.chatId,
        surface: job.surface,
        kind: job.kind,
        sourceUserMessageId: job.sourceUserMessageId,
        sourceUserMessageText: context.sourceUserMessageText,
        sourceUserMessageCreatedAt: context.sourceUserMessageCreatedAt,
        failure: {
          code,
          message,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          retryable,
          stage: "execution"
        }
      });
    } catch (error) {
      this.logger.warn(
        `LLM failure-framing threw for media job ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private extractPreferredLocale(runtimeBundleDocument: string): string | null {
    try {
      const parsed = JSON.parse(runtimeBundleDocument) as {
        userContext?: { locale?: unknown };
      };
      return typeof parsed.userContext?.locale === "string" ? parsed.userContext.locale : null;
    } catch {
      return null;
    }
  }

  private parseRequestPayload(value: unknown): MediaJobRequestPayload | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.sourceUserMessageText !== "string" ||
      row.sourceUserMessageText.trim().length === 0 ||
      typeof row.sourceUserMessageCreatedAt !== "string" ||
      !Array.isArray(row.attachments)
    ) {
      return null;
    }
    const attachments = row.attachments;
    if (!attachments.every((entry) => this.isAttachmentRef(entry))) {
      return null;
    }
    const directToolExecution = this.parseDirectToolExecution(row.directToolExecution);
    if (directToolExecution === null) {
      return null;
    }
    return {
      attachments,
      sourceUserMessageText: row.sourceUserMessageText,
      sourceUserMessageCreatedAt: row.sourceUserMessageCreatedAt,
      directToolExecution
    };
  }

  private parseDirectToolExecution(value: unknown): DirectToolExecutionPayload | null {
    if (value === undefined) {
      return null;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    if (row.toolCode === "image_generate" && this.isObject(row.request)) {
      return {
        toolCode: "image_generate",
        request: row.request as unknown as RuntimeImageGenerateRequest
      };
    }
    if (row.toolCode === "image_edit" && this.isObject(row.request)) {
      return {
        toolCode: "image_edit",
        request: row.request as unknown as RuntimeImageEditRequest
      };
    }
    if (row.toolCode === "video_generate" && this.isObject(row.request)) {
      return {
        toolCode: "video_generate",
        request: row.request as unknown as RuntimeVideoGenerateRequest
      };
    }
    return null;
  }

  private isAttachmentRef(value: unknown): value is RuntimeAttachmentRef {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const row = value as Record<string, unknown>;
    return (
      typeof row.attachmentId === "string" &&
      typeof row.kind === "string" &&
      typeof row.objectKey === "string" &&
      typeof row.mimeType === "string" &&
      (row.filename === null || typeof row.filename === "string") &&
      typeof row.sizeBytes === "number"
    );
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
