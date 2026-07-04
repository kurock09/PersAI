import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type WorkspaceFileMicroDescriptionJob } from "@prisma/client";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { WorkspaceFileMicroDescriptionService } from "./workspace-file-micro-description.service";

const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const LAST_ERROR_MAX_CHARS = 1_000;

export type WorkspaceFileMicroDescriptionSourceKind = "user_upload" | "generated" | "inbound";

function truncateLastError(message: string): string {
  if (message.length <= LAST_ERROR_MAX_CHARS) {
    return message;
  }
  return `${message.slice(0, LAST_ERROR_MAX_CHARS - 3)}...`;
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1));
}

function hasNonEmptySummary(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

@Injectable()
export class WorkspaceFileMicroDescriptionJobService {
  private readonly logger = new Logger(WorkspaceFileMicroDescriptionJobService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly workspaceFileMicroDescriptionService: WorkspaceFileMicroDescriptionService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService
  ) {}

  async enqueueIfNeeded(input: {
    workspaceId: string;
    path: string;
    assistantId: string;
    sourceKind: WorkspaceFileMicroDescriptionSourceKind;
    sourceChatId?: string | null;
    chatMode?: string | null;
    forceRefresh?: boolean;
  }): Promise<{ accepted: boolean; reason: string }> {
    const metadata = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: input.path
    });
    if (
      input.forceRefresh !== true &&
      metadata !== null &&
      hasNonEmptySummary(metadata.shortDescription)
    ) {
      return { accepted: false, reason: "summary_exists" };
    }
    const existingJob = await this.prisma.workspaceFileMicroDescriptionJob.findUnique({
      where: {
        workspaceId_path: {
          workspaceId: input.workspaceId,
          path: input.path
        }
      }
    });
    if (existingJob !== null && input.forceRefresh !== true) {
      if (
        existingJob.status === "completed" ||
        existingJob.status === "processing" ||
        existingJob.status === "pending"
      ) {
        return { accepted: false, reason: `job_${existingJob.status}` };
      }
    }
    if (!(await this.shouldEnqueueForPolicy(input.sourceKind, input.chatMode))) {
      return { accepted: false, reason: "policy_disabled" };
    }
    await this.prisma.workspaceFileMicroDescriptionJob.upsert({
      where: {
        workspaceId_path: {
          workspaceId: input.workspaceId,
          path: input.path
        }
      },
      create: {
        workspaceId: input.workspaceId,
        path: input.path,
        status: "pending",
        sourceKind: input.sourceKind,
        sourceChatId: input.sourceChatId ?? null,
        sourceAssistantId: input.assistantId,
        chatMode: input.chatMode ?? null,
        attemptCount: 0,
        maxAttempts: 5
      },
      update: {
        status: "pending",
        sourceKind: input.sourceKind,
        sourceChatId: input.sourceChatId ?? null,
        sourceAssistantId: input.assistantId,
        chatMode: input.chatMode ?? null,
        attemptCount: 0,
        failedAt: null,
        completedAt: null,
        lastErrorMessage: null,
        nextRetryAt: null,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
    return { accepted: true, reason: "enqueued" };
  }

  async processClaimedJob(
    job: Pick<
      WorkspaceFileMicroDescriptionJob,
      | "id"
      | "workspaceId"
      | "path"
      | "sourceAssistantId"
      | "attemptCount"
      | "maxAttempts"
      | "schedulerClaimToken"
    >
  ): Promise<void> {
    const metadata = await this.workspaceFileMetadataService.get({
      workspaceId: job.workspaceId,
      path: job.path
    });
    if (metadata !== null && hasNonEmptySummary(metadata.shortDescription)) {
      await this.markCompleted(job.id, job.schedulerClaimToken);
      return;
    }
    const assistantId = job.sourceAssistantId ?? metadata?.originAssistantId ?? null;
    if (assistantId === null) {
      await this.markCompleted(job.id, job.schedulerClaimToken);
      return;
    }
    const generated = await this.workspaceFileMicroDescriptionService.describeWorkspaceFile({
      assistantId,
      workspaceId: job.workspaceId,
      path: job.path
    });
    if (generated === null) {
      await this.markCompleted(job.id, job.schedulerClaimToken);
      return;
    }
    const usageOccurredAt = new Date(generated.respondedAt);
    const usageOccurredAtValue = Number.isNaN(usageOccurredAt.getTime()) ? null : usageOccurredAt;
    await this.prisma.$transaction(async (tx) => {
      if (hasNonEmptySummary(generated.summary)) {
        await tx.workspaceFileMetadata.upsert({
          where: {
            workspaceId_path: {
              workspaceId: job.workspaceId,
              path: job.path
            }
          },
          create: {
            workspaceId: job.workspaceId,
            path: job.path,
            mimeType: metadata?.mimeType ?? "application/octet-stream",
            sizeBytes: metadata?.sizeBytes ?? BigInt(0),
            shortDescription: generated.summary,
            originChatId: metadata?.originChatId ?? null,
            originAssistantId: metadata?.originAssistantId ?? assistantId
          },
          update: {
            shortDescription: generated.summary
          }
        });
      }
      await tx.workspaceFileMicroDescriptionJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.schedulerClaimToken
        },
        data: {
          status: "completed",
          completedAt: new Date(),
          failedAt: null,
          usageJson:
            generated.usage === null
              ? Prisma.DbNull
              : (generated.usage as unknown as Prisma.InputJsonValue),
          usageOccurredAt: usageOccurredAtValue,
          lastErrorMessage: null,
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null
        }
      });
    });
    if (generated.usage === null || usageOccurredAtValue === null) {
      return;
    }
    const assistant = await this.assistantRepository.findById(assistantId);
    if (assistant === null) {
      return;
    }
    try {
      await this.recordModelCostLedgerService.recordToolHelperEvent({
        workspaceId: job.workspaceId,
        assistantId,
        userId: assistant.userId,
        surface: "background",
        occurredAt: usageOccurredAtValue.toISOString(),
        sourceEventId: `workspace_file_micro_description_job:${job.id}`,
        source: "upload_micro_description",
        usage: generated.usage
      });
    } catch (error) {
      this.logger.warn(
        `workspace_file_micro_description_ledger_append_failed jobId=${job.id} message=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async markFailed(
    job: Pick<
      WorkspaceFileMicroDescriptionJob,
      "id" | "attemptCount" | "maxAttempts" | "schedulerClaimToken"
    >,
    error: unknown
  ): Promise<void> {
    const message = truncateLastError(error instanceof Error ? error.message : String(error));
    const nextAttempt = job.attemptCount + 1;
    if (nextAttempt >= job.maxAttempts) {
      await this.prisma.workspaceFileMicroDescriptionJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.schedulerClaimToken
        },
        data: {
          status: "failed",
          attemptCount: nextAttempt,
          failedAt: new Date(),
          lastErrorMessage: message,
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null
        }
      });
      return;
    }
    const nextRetryAt = new Date(Date.now() + computeRetryBackoffMs(nextAttempt));
    await this.prisma.workspaceFileMicroDescriptionJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.schedulerClaimToken
      },
      data: {
        status: "pending",
        attemptCount: nextAttempt,
        nextRetryAt,
        lastErrorMessage: message,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async markCompleted(jobId: string, claimToken: string | null): Promise<void> {
    await this.prisma.workspaceFileMicroDescriptionJob.updateMany({
      where: {
        id: jobId,
        ...(claimToken === null ? {} : { schedulerClaimToken: claimToken })
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        failedAt: null,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async shouldEnqueueForPolicy(
    sourceKind: WorkspaceFileMicroDescriptionSourceKind,
    chatMode: string | null | undefined
  ): Promise<boolean> {
    if (sourceKind === "generated") {
      return true;
    }
    if (chatMode === "project") {
      return true;
    }
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    return settings.routerPolicy.analyzeUploadsOnB2cUpload === true;
  }
}
