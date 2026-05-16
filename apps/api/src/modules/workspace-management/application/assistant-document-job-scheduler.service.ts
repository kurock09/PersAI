import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  PersaiRuntimePresentationImagePolicy,
  PersaiRuntimePresentationVisualDensity,
  PersaiRuntimePresentationVisualStyle,
  RuntimeDocumentJobRunRequest
} from "@persai/runtime-contract";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { InternalRuntimeDocumentJobClientService } from "./internal-runtime-document-job.client.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { AssistantDocumentJobDeliveryService } from "./assistant-document-job-delivery.service";

const DOCUMENT_JOB_POLL_INTERVAL_MS = 5_000;
const DOCUMENT_JOB_BATCH_SIZE = 4;
const DOCUMENT_JOB_CLAIM_TTL_MS = 10 * 60 * 1000;
const DOCUMENT_JOB_RETRY_BASE_DELAY_MS = 30_000;
const DOCUMENT_JOB_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const DOCUMENT_JOB_LAST_ERROR_MAX_CHARS = 1_000;
const DOCUMENT_JOB_SCHEDULER_KEY = "document_job";

type DocumentJobRequestPayload = {
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  descriptorMode:
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver";
  sourceJson: {
    prompt: string;
    instructions?: string | null;
    outputFormat?: "pdf" | "pptx" | null;
    docId?: string | null;
    requestedName?: string | null;
    visualStyle?: PersaiRuntimePresentationVisualStyle | null;
    imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
    visualDensity?: PersaiRuntimePresentationVisualDensity | null;
    outline?: unknown;
    metadata?: Record<string, unknown> | null;
  };
};

type ClaimedDocumentJob = {
  id: string;
  docId: string;
  versionId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  provider: "pdfmonkey" | "gamma";
  outputFormat: "pdf" | "pptx";
  sourceUserMessageId: string;
  requestJson: unknown;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string;
};

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    DOCUMENT_JOB_RETRY_MAX_DELAY_MS,
    DOCUMENT_JOB_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1)
  );
}

@Injectable()
export class AssistantDocumentJobSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantDocumentJobSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly internalRuntimeDocumentJobClientService: InternalRuntimeDocumentJobClientService,
    private readonly assistantDocumentJobDeliveryService: AssistantDocumentJobDeliveryService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(DOCUMENT_JOB_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      this.scheduleNext(DOCUMENT_JOB_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    this.leaseLost = false;
    const startedAt = Date.now();
    let processed = 0;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseToken: string | null = null;
    let leaseLostReported = false;
    const markLeaseLost = (reason: string): void => {
      if (leaseLostReported) {
        return;
      }
      leaseLostReported = true;
      this.leaseLost = true;
      this.backgroundSchedulerMetricsService.recordLeaseLost(DOCUMENT_JOB_SCHEDULER_KEY);
      this.logger.warn(`Assistant document-job scheduler lease lost: ${reason}`);
    };
    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(
        DOCUMENT_JOB_SCHEDULER_KEY
      );
      const lease = await this.schedulerLeaseService.acquire(DOCUMENT_JOB_SCHEDULER_KEY);
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(DOCUMENT_JOB_SCHEDULER_KEY);
        return;
      }
      leaseToken = lease.token;
      if (
        previousLease !== null &&
        previousLease.holderId !== "" &&
        previousLease.expiresAt.getTime() <= startedAt
      ) {
        this.backgroundSchedulerMetricsService.recordLeaseExpiredRecovered(
          DOCUMENT_JOB_SCHEDULER_KEY
        );
      }
      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(DOCUMENT_JOB_SCHEDULER_KEY, lease.token)
          .then((stillLeader) => {
            if (!stillLeader) {
              markLeaseLost("heartbeat token no longer matched active leader");
            }
          })
          .catch((error) => {
            markLeaseLost(error instanceof Error ? error.message : String(error));
          });
      }, LEASE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

      while (!this.stopped && !this.leaseLost) {
        const claimed = await this.claimDueJobs(DOCUMENT_JOB_BATCH_SIZE);
        if (claimed.length === 0) {
          break;
        }
        for (const job of claimed) {
          if (this.leaseLost) {
            break;
          }
          if (job.status === "ready_for_delivery") {
            await this.assistantDocumentJobDeliveryService.deliverReadyJob({
              id: job.id,
              docId: job.docId,
              versionId: job.versionId,
              assistantId: job.assistantId,
              workspaceId: job.workspaceId,
              chatId: job.chatId,
              surface: job.surface,
              schedulerClaimToken: job.claimToken,
              providerStatusJson: job.providerStatusJson
            });
            processed += 1;
            continue;
          }
          await this.processQueuedJob(job);
          processed += 1;
        }
        if (claimed.length < DOCUMENT_JOB_BATCH_SIZE) {
          break;
        }
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        DOCUMENT_JOB_SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      this.logger.error(
        `Assistant document-job scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(DOCUMENT_JOB_SCHEDULER_KEY, leaseToken);
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(DOCUMENT_JOB_POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(limit: number): Promise<
    Array<
      ClaimedDocumentJob & {
        status: "queued" | "running" | "ready_for_delivery";
        providerStatusJson: unknown;
      }
    >
  > {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + DOCUMENT_JOB_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          docId: string;
          versionId: string;
          assistantId: string;
          workspaceId: string;
          chatId: string;
          surface: "web" | "telegram";
          provider: "pdfmonkey" | "gamma";
          outputFormat: "pdf" | "pptx";
          status: "queued" | "running" | "ready_for_delivery";
          sourceUserMessageId: string | null;
          requestJson: unknown;
          providerStatusJson: unknown;
          attemptCount: number;
          maxAttempts: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "doc_id" AS "docId",
          "version_id" AS "versionId",
          "assistant_id" AS "assistantId",
          "workspace_id" AS "workspaceId",
          "chat_id" AS "chatId",
          "surface"::text AS "surface",
          "provider"::text AS "provider",
          "output_format"::text AS "outputFormat",
          "status"::text AS "status",
          "source_user_message_id" AS "sourceUserMessageId",
          "request_json" AS "requestJson",
          "provider_status_json" AS "providerStatusJson",
          "attempt_count" AS "attemptCount",
          "max_attempts" AS "maxAttempts"
        FROM "assistant_document_render_jobs"
        WHERE (
            "status" = 'queued'
            AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          )
          OR (
            "status" = 'running'
            AND "scheduler_claim_expires_at" IS NOT NULL
            AND "scheduler_claim_expires_at" <= NOW()
          )
          OR (
            "status" = 'ready_for_delivery'
            AND (
              "scheduler_claim_expires_at" IS NULL
              OR "scheduler_claim_expires_at" <= NOW()
            )
            AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: Array<
        ClaimedDocumentJob & {
          status: "queued" | "running" | "ready_for_delivery";
          providerStatusJson: unknown;
        }
      > = [];
      for (const row of rows) {
        if (typeof row.sourceUserMessageId !== "string" || row.sourceUserMessageId.length === 0) {
          continue;
        }
        const claimToken = randomUUID();
        const nextAttemptCount =
          row.status === "ready_for_delivery" ? row.attemptCount : row.attemptCount + 1;
        await tx.assistantDocumentRenderJob.update({
          where: { id: row.id },
          data: {
            ...(row.status === "ready_for_delivery"
              ? {}
              : {
                  status: "running",
                  attemptCount: nextAttemptCount,
                  ...(row.attemptCount === 0 ? { startedAt: now } : {}),
                  completedAt: null,
                  failedAt: null,
                  lastErrorCode: null,
                  lastErrorMessage: null
                }),
            schedulerClaimToken: claimToken,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt
          }
        });
        claimed.push({
          id: row.id,
          docId: row.docId,
          versionId: row.versionId,
          assistantId: row.assistantId,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          surface: row.surface,
          provider: row.provider,
          outputFormat: row.outputFormat,
          status: row.status,
          sourceUserMessageId: row.sourceUserMessageId,
          requestJson: row.requestJson,
          providerStatusJson: row.providerStatusJson,
          attemptCount: nextAttemptCount,
          maxAttempts: row.maxAttempts,
          claimToken
        });
      }
      return claimed;
    });
  }

  private async processQueuedJob(job: ClaimedDocumentJob): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.prisma.assistantDocumentRenderJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.claimToken
        },
        data: {
          schedulerClaimExpiresAt: new Date(Date.now() + DOCUMENT_JOB_CLAIM_TTL_MS)
        }
      });
    }, LEASE_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
    try {
      const requestPayload = this.parseRequestPayload(job.requestJson);
      if (requestPayload === null) {
        await this.failJob(
          job,
          "invalid_request_payload",
          "Document job request payload is invalid."
        );
        return;
      }

      const assistant = await this.assistantRepository.findById(job.assistantId);
      if (assistant === null) {
        await this.failJob(job, "assistant_not_found", "Assistant not found.");
        return;
      }
      const resolvedRuntimeContext =
        await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
          job.assistantId
        );
      const spec =
        await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
      if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
        await this.failJob(
          job,
          "runtime_bundle_missing",
          "Assistant runtime bundle is not materialized."
        );
        return;
      }

      const outcome = await this.internalRuntimeDocumentJobClientService.run({
        assistantId: job.assistantId,
        workspaceId: job.workspaceId,
        runtimeTier: resolvedRuntimeContext.runtimeTier,
        runtimeBundleDocument: spec.runtimeBundleDocument,
        job: {
          id: job.id,
          docId: job.docId,
          versionId: job.versionId,
          surface: job.surface,
          chatId: job.chatId,
          provider: job.provider,
          outputFormat: job.outputFormat,
          sourceUserMessageId: job.sourceUserMessageId,
          sourceUserMessageText: requestPayload.sourceUserMessageText,
          sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode:
            requestPayload.descriptorMode ??
            (job.provider === "pdfmonkey" ? "create_pdf_document" : "create_presentation"),
          request: {
            ...requestPayload.sourceJson
          }
        }
      } satisfies RuntimeDocumentJobRunRequest);

      if (!outcome.ok) {
        const canRetry = outcome.retryable && job.attemptCount < job.maxAttempts;
        if (canRetry) {
          await this.requeueJob(
            job,
            outcome.code ?? "document_execution_failed",
            outcome.message,
            outcome.providerStatus
          );
          return;
        }
        await this.failJob(
          job,
          outcome.code ?? "document_execution_failed",
          outcome.message,
          outcome.providerStatus
        );
        return;
      }

      if (outcome.result.artifacts.length === 0) {
        const providerRetryable =
          this.readProviderRetryable(outcome.result.providerStatus) === true &&
          job.attemptCount < job.maxAttempts;
        if (providerRetryable) {
          await this.requeueJob(
            job,
            this.readProviderErrorCode(outcome.result.providerStatus) ??
              "document_provider_retryable",
            this.readProviderMessage(outcome.result.providerStatus) ??
              "Document provider execution failed transiently.",
            outcome.result.providerStatus ?? null
          );
          return;
        }
        const providerState = this.readProviderState(outcome.result.providerStatus);
        if (providerState === "not_implemented") {
          await this.failJob(
            job,
            "document_provider_not_implemented",
            `Document provider "${job.provider}" execution boundary is wired but not yet implemented.`
          );
          return;
        }
        if (providerState === "template_not_configured") {
          await this.failJob(
            job,
            "document_template_not_configured",
            'Document provider "pdfmonkey" requires an operator-configured template id.',
            outcome.result.providerStatus ?? null
          );
          return;
        }
        await this.failJob(
          job,
          "document_artifacts_missing",
          "Document job worker completed without deliverable artifacts.",
          outcome.result.providerStatus ?? null
        );
        return;
      }

      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.assistantDocumentRenderJob.updateMany({
          where: { id: job.id, schedulerClaimToken: job.claimToken },
          data: {
            status: "ready_for_delivery",
            completedAt: new Date(),
            schedulerClaimToken: null,
            schedulerClaimedAt: null,
            schedulerClaimExpiresAt: null,
            providerStatusJson: {
              descriptorMode:
                requestPayload.descriptorMode ??
                (job.provider === "pdfmonkey" ? "create_pdf_document" : "create_presentation"),
              outputFormat: job.outputFormat,
              sourceUserMessageId: job.sourceUserMessageId,
              sourceUserMessageText: requestPayload.sourceUserMessageText,
              sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt,
              artifacts: outcome.result.artifacts,
              assistantText: outcome.result.assistantText,
              providerStatus: outcome.result.providerStatus ?? null
            } as unknown as Prisma.InputJsonValue,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        if (claimed.count === 0) {
          return;
        }
        await tx.assistantDocumentVersion.update({
          where: { id: job.versionId },
          data: {
            status: "rendering"
          }
        });
        await this.upsertProviderMapping(tx, job, {
          latestProviderStatus:
            typeof outcome.result.providerStatus?.state === "string"
              ? outcome.result.providerStatus.state
              : "completed",
          providerMetadataJson: (outcome.result.providerStatus ?? {}) as Prisma.InputJsonValue
        });
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async failJob(
    job: ClaimedDocumentJob,
    code: string,
    message: string,
    providerStatus: Record<string, unknown> | null = null
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assistantDocumentRenderJob.updateMany({
        where: { id: job.id, schedulerClaimToken: job.claimToken },
        data: {
          status: "failed",
          failedAt: new Date(),
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          lastErrorCode: code,
          lastErrorMessage: this.truncateLastError(message),
          providerStatusJson:
            providerStatus === null
              ? Prisma.JsonNull
              : ({
                  providerStatus
                } as Prisma.InputJsonValue)
        }
      });
      if (claimed.count === 0) {
        return;
      }
      await tx.assistantDocumentVersion.update({
        where: { id: job.versionId },
        data: { status: "failed" }
      });
      const currentDocument = await tx.assistantDocument.findUnique({
        where: { id: job.docId },
        select: { currentVersionId: true }
      });
      await tx.assistantDocument.update({
        where: { id: job.docId },
        data: {
          status: currentDocument?.currentVersionId === job.versionId ? "failed" : "ready"
        }
      });
      await this.upsertProviderMapping(tx, job, {
        latestProviderStatus:
          this.readProviderState(providerStatus) ??
          this.readProviderOperationalStatus(providerStatus) ??
          "failed",
        providerMetadataJson: this.buildFailureProviderMetadata(code, message, providerStatus)
      });
    });
  }

  private async requeueJob(
    job: ClaimedDocumentJob,
    code: string,
    message: string,
    providerStatus: Record<string, unknown> | null = null
  ): Promise<void> {
    await this.prisma.assistantDocumentRenderJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken, status: "running" },
      data: {
        status: "queued",
        nextRetryAt: new Date(Date.now() + computeRetryBackoffMs(job.attemptCount)),
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: code,
        lastErrorMessage: this.truncateLastError(message),
        providerStatusJson:
          providerStatus === null ? Prisma.JsonNull : (providerStatus as Prisma.InputJsonValue)
      }
    });
  }

  private parseRequestPayload(value: unknown): DocumentJobRequestPayload | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const sourceJson =
      row.sourceJson !== null &&
      typeof row.sourceJson === "object" &&
      !Array.isArray(row.sourceJson)
        ? (row.sourceJson as Record<string, unknown>)
        : null;
    if (
      typeof row.sourceUserMessageText !== "string" ||
      typeof row.sourceUserMessageCreatedAt !== "string" ||
      sourceJson === null ||
      typeof sourceJson.prompt !== "string"
    ) {
      return null;
    }
    return {
      sourceUserMessageText: row.sourceUserMessageText,
      sourceUserMessageCreatedAt: row.sourceUserMessageCreatedAt,
      descriptorMode:
        row.descriptorMode === "create_pdf_document" ||
        row.descriptorMode === "create_presentation" ||
        row.descriptorMode === "revise_document" ||
        row.descriptorMode === "export_or_redeliver"
          ? row.descriptorMode
          : "create_pdf_document",
      sourceJson: {
        prompt: sourceJson.prompt,
        instructions: typeof sourceJson.instructions === "string" ? sourceJson.instructions : null,
        outputFormat:
          sourceJson.outputFormat === "pdf" || sourceJson.outputFormat === "pptx"
            ? sourceJson.outputFormat
            : null,
        docId: typeof sourceJson.docId === "string" ? sourceJson.docId : null,
        requestedName:
          typeof sourceJson.requestedName === "string" ? sourceJson.requestedName : null,
        visualStyle:
          sourceJson.visualStyle === "professional_modern" ||
          sourceJson.visualStyle === "bold_editorial" ||
          sourceJson.visualStyle === "minimal_clean" ||
          sourceJson.visualStyle === "illustrated_storytelling"
            ? sourceJson.visualStyle
            : null,
        imagePolicy:
          sourceJson.imagePolicy === "ai_generated" ||
          sourceJson.imagePolicy === "web_free_to_use" ||
          sourceJson.imagePolicy === "pictographic" ||
          sourceJson.imagePolicy === "text_only"
            ? sourceJson.imagePolicy
            : null,
        visualDensity:
          sourceJson.visualDensity === "balanced" ||
          sourceJson.visualDensity === "visual_heavy" ||
          sourceJson.visualDensity === "text_heavy"
            ? sourceJson.visualDensity
            : null,
        outline: sourceJson.outline,
        metadata:
          sourceJson.metadata !== null &&
          typeof sourceJson.metadata === "object" &&
          !Array.isArray(sourceJson.metadata)
            ? (sourceJson.metadata as Record<string, unknown>)
            : null
      }
    };
  }

  private readProviderState(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    return typeof row.state === "string" ? row.state : null;
  }

  private readProviderRetryable(value: unknown): boolean | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    return typeof row.retryable === "boolean" ? row.retryable : null;
  }

  private readProviderErrorCode(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    return typeof row.errorCode === "string" ? row.errorCode : null;
  }

  private readProviderMessage(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    return typeof row.message === "string" ? row.message : null;
  }

  private readProviderOperationalStatus(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    return typeof row.status === "string" ? row.status : null;
  }

  private buildFailureProviderMetadata(
    code: string,
    message: string,
    providerStatus: Record<string, unknown> | null
  ): Prisma.InputJsonValue {
    if (providerStatus === null) {
      return {
        errorCode: code,
        errorMessage: message
      } as Prisma.InputJsonValue;
    }
    return {
      ...providerStatus,
      errorCode: code,
      errorMessage: message
    } as Prisma.InputJsonValue;
  }

  private truncateLastError(message: string): string {
    if (message.length <= DOCUMENT_JOB_LAST_ERROR_MAX_CHARS) {
      return message;
    }
    return `${message.slice(0, DOCUMENT_JOB_LAST_ERROR_MAX_CHARS - 3)}...`;
  }

  private async upsertProviderMapping(
    tx: Prisma.TransactionClient,
    job: Pick<ClaimedDocumentJob, "docId" | "versionId" | "workspaceId" | "provider">,
    input: {
      latestProviderStatus: string;
      providerMetadataJson: Prisma.InputJsonValue;
    }
  ): Promise<void> {
    const existing = await tx.assistantDocumentProviderMapping.findFirst({
      where: {
        versionId: job.versionId,
        provider: job.provider
      },
      select: { id: true }
    });
    if (existing === null) {
      await tx.assistantDocumentProviderMapping.create({
        data: {
          docId: job.docId,
          versionId: job.versionId,
          workspaceId: job.workspaceId,
          provider: job.provider,
          latestProviderStatus: input.latestProviderStatus,
          providerMetadataJson: input.providerMetadataJson
        }
      });
      return;
    }
    await tx.assistantDocumentProviderMapping.update({
      where: { id: existing.id },
      data: {
        latestProviderStatus: input.latestProviderStatus,
        providerMetadataJson: input.providerMetadataJson
      }
    });
  }
}
