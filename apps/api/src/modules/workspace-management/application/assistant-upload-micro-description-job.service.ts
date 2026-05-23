import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type AssistantUploadMicroDescriptionJob } from "@prisma/client";
import { AssistantFileRegistryService } from "./assistant-file-registry.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  normalizeStoredAttachmentSemanticSummary,
  readStoredAttachmentSemanticSummary,
  readStoredAttachmentSemanticSummarySource,
  withStoredAttachmentSemanticSummary,
  type AttachmentSemanticSummarySource
} from "./media/media.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AssistantUploadMicroDescriptionService } from "./assistant-upload-micro-description.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";

const UPLOAD_MICRO_DESCRIPTION_RETRY_BASE_DELAY_MS = 30_000;
const UPLOAD_MICRO_DESCRIPTION_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const UPLOAD_MICRO_DESCRIPTION_LAST_ERROR_MAX_CHARS = 1_000;
const UPLOAD_MICRO_DESCRIPTION_SOURCE: AttachmentSemanticSummarySource = "upload_micro_description";

function asMetadataObject(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function readFileSemanticSummary(
  metadata: Record<string, unknown> | null | undefined
): { semanticSummary: string; semanticSummarySource: AttachmentSemanticSummarySource } | null {
  const semanticSummary = normalizeStoredAttachmentSemanticSummary(
    typeof metadata?.semanticSummary === "string" ? metadata.semanticSummary : null
  );
  const semanticSummarySource = readStoredAttachmentSemanticSummarySource(metadata);
  return semanticSummary !== null && semanticSummarySource !== null
    ? { semanticSummary, semanticSummarySource }
    : null;
}

function withFileSemanticSummary(input: {
  metadata: Record<string, unknown> | null | undefined;
  semanticSummary: string;
  semanticSummarySource: AttachmentSemanticSummarySource;
}): Record<string, unknown> {
  return {
    ...asMetadataObject(input.metadata),
    semanticSummary: input.semanticSummary,
    semanticSummarySource: input.semanticSummarySource
  };
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    UPLOAD_MICRO_DESCRIPTION_RETRY_MAX_DELAY_MS,
    UPLOAD_MICRO_DESCRIPTION_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1)
  );
}

@Injectable()
export class AssistantUploadMicroDescriptionJobService {
  private readonly logger = new Logger(AssistantUploadMicroDescriptionJobService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly assistantFileRegistryService: AssistantFileRegistryService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly assistantUploadMicroDescriptionService: AssistantUploadMicroDescriptionService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService
  ) {}

  async enqueueIfNeeded(input: {
    assistantId: string;
    workspaceId: string;
    chatMode: string | null | undefined;
    attachmentId: string;
    assistantFileId: string | null | undefined;
  }): Promise<{ accepted: boolean; reason: string }> {
    if (!(await this.shouldAnalyzeForChatMode(input.chatMode))) {
      return { accepted: false, reason: "policy_disabled" };
    }
    return this.enqueueCanonicalFileIfNeeded({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      assistantFileId: input.assistantFileId,
      sourceAttachmentId: input.attachmentId
    });
  }

  async enqueueGeneratedFileIfNeeded(input: {
    assistantId: string;
    workspaceId: string;
    assistantFileId: string | null | undefined;
    attachmentId: string | null | undefined;
  }): Promise<{ accepted: boolean; reason: string }> {
    return this.enqueueCanonicalFileIfNeeded({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      assistantFileId: input.assistantFileId,
      sourceAttachmentId: input.attachmentId ?? null
    });
  }

  async processClaimedJob(
    job: Pick<
      AssistantUploadMicroDescriptionJob,
      "id" | "assistantId" | "workspaceId" | "assistantFileId" | "sourceAttachmentId"
    >
  ): Promise<void> {
    const file = await this.assistantFileRegistryService.findAssistantFile({
      assistantId: job.assistantId,
      workspaceId: job.workspaceId,
      fileRef: job.assistantFileId
    });
    if (file === null) {
      await this.markCompleted(job.id);
      return;
    }
    const existingSummary = readFileSemanticSummary(file.metadata);
    if (existingSummary !== null) {
      if (job.sourceAttachmentId !== null) {
        await this.mirrorSummaryToAttachment({
          attachmentId: job.sourceAttachmentId,
          semanticSummary: existingSummary.semanticSummary,
          semanticSummarySource: existingSummary.semanticSummarySource
        });
      }
      await this.markCompleted(job.id);
      return;
    }
    const generated = await this.assistantUploadMicroDescriptionService.describeCanonicalFile({
      assistantId: job.assistantId,
      workspaceId: job.workspaceId,
      assistantFileId: job.assistantFileId
    });
    if (generated === null) {
      await this.markCompleted(job.id);
      return;
    }
    const usageOccurredAt = new Date(generated.respondedAt);
    const usageOccurredAtValue = Number.isNaN(usageOccurredAt.getTime()) ? null : usageOccurredAt;
    await this.prisma.$transaction(async (tx) => {
      const currentFile = await tx.assistantFile.findUnique({
        where: { id: job.assistantFileId },
        select: { metadata: true }
      });
      if (currentFile === null) {
        await tx.assistantUploadMicroDescriptionJob.update({
          where: { id: job.id },
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
        return;
      }
      const currentSummary = readFileSemanticSummary(
        currentFile.metadata as Record<string, unknown> | null
      );
      const semanticSummary = currentSummary?.semanticSummary ?? generated.summary;
      const semanticSummarySource =
        currentSummary?.semanticSummarySource ??
        (generated.summary === null ? null : UPLOAD_MICRO_DESCRIPTION_SOURCE);
      if (semanticSummary !== null && semanticSummarySource !== null) {
        await tx.assistantFile.update({
          where: { id: job.assistantFileId },
          data: {
            metadata: withFileSemanticSummary({
              metadata: currentFile.metadata as Record<string, unknown> | null,
              semanticSummary,
              semanticSummarySource
            }) as Prisma.InputJsonValue
          }
        });
        if (job.sourceAttachmentId !== null) {
          const attachment = await tx.assistantChatMessageAttachment.findUnique({
            where: { id: job.sourceAttachmentId },
            select: { metadata: true }
          });
          if (attachment !== null) {
            await tx.assistantChatMessageAttachment.update({
              where: { id: job.sourceAttachmentId },
              data: {
                metadata: withStoredAttachmentSemanticSummary({
                  metadata: attachment.metadata as Record<string, unknown> | null,
                  semanticSummary,
                  semanticSummarySource
                }) as Prisma.InputJsonValue
              }
            });
          }
        }
      }
      await tx.assistantUploadMicroDescriptionJob.update({
        where: { id: job.id },
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
    const assistant = await this.assistantRepository.findById(job.assistantId);
    if (assistant === null) {
      return;
    }
    try {
      await this.recordModelCostLedgerService.recordToolHelperEvent({
        workspaceId: job.workspaceId,
        assistantId: job.assistantId,
        userId: assistant.userId,
        surface: "background",
        occurredAt: usageOccurredAtValue.toISOString(),
        sourceEventId: `upload_micro_description_job:${job.id}`,
        source: "upload_micro_description",
        usage: generated.usage
      });
    } catch (error) {
      this.logger.warn(
        `upload_micro_description_ledger_append_failed jobId=${job.id} message=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async markFailed(
    job: Pick<AssistantUploadMicroDescriptionJob, "id" | "attemptCount" | "maxAttempts">,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attemptCount = job.attemptCount + 1;
    const terminal = attemptCount >= job.maxAttempts;
    await this.prisma.assistantUploadMicroDescriptionJob.update({
      where: { id: job.id },
      data: {
        status: terminal ? "failed" : "queued",
        attemptCount,
        nextRetryAt: terminal ? null : new Date(Date.now() + computeRetryBackoffMs(attemptCount)),
        failedAt: terminal ? new Date() : null,
        lastErrorMessage: message.slice(0, UPLOAD_MICRO_DESCRIPTION_LAST_ERROR_MAX_CHARS),
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  async markRunning(jobId: string): Promise<void> {
    await this.prisma.assistantUploadMicroDescriptionJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        startedAt: new Date(),
        lastErrorMessage: null
      }
    });
  }

  private async markCompleted(jobId: string): Promise<void> {
    await this.prisma.assistantUploadMicroDescriptionJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        completedAt: new Date(),
        failedAt: null,
        lastErrorMessage: null,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async shouldAnalyzeForChatMode(chatMode: string | null | undefined): Promise<boolean> {
    if (chatMode === "project") {
      return true;
    }
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    return settings.routerPolicy.analyzeUploadsOnB2cUpload;
  }

  private async mirrorSummaryToAttachment(input: {
    attachmentId: string;
    semanticSummary: string;
    semanticSummarySource: AttachmentSemanticSummarySource;
  }): Promise<void> {
    const attachment = await this.prisma.assistantChatMessageAttachment.findUnique({
      where: { id: input.attachmentId },
      select: { metadata: true }
    });
    if (attachment === null) {
      return;
    }
    const currentSummary = readStoredAttachmentSemanticSummary(
      attachment.metadata as Record<string, unknown> | null
    );
    const currentSource = readStoredAttachmentSemanticSummarySource(
      attachment.metadata as Record<string, unknown> | null
    );
    if (currentSummary === input.semanticSummary && currentSource === input.semanticSummarySource) {
      return;
    }
    await this.prisma.assistantChatMessageAttachment.update({
      where: { id: input.attachmentId },
      data: {
        metadata: withStoredAttachmentSemanticSummary({
          metadata: attachment.metadata as Record<string, unknown> | null,
          semanticSummary: input.semanticSummary,
          semanticSummarySource: input.semanticSummarySource
        }) as Prisma.InputJsonValue
      }
    });
  }

  private async enqueueCanonicalFileIfNeeded(input: {
    assistantId: string;
    workspaceId: string;
    assistantFileId: string | null | undefined;
    sourceAttachmentId: string | null;
  }): Promise<{ accepted: boolean; reason: string }> {
    if (!input.assistantFileId) {
      return { accepted: false, reason: "missing_file_ref" };
    }
    const file = await this.assistantFileRegistryService.findAssistantFile({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      fileRef: input.assistantFileId
    });
    if (file === null) {
      return { accepted: false, reason: "missing_file" };
    }
    const existingSummary = readFileSemanticSummary(file.metadata);
    if (existingSummary !== null) {
      if (input.sourceAttachmentId !== null) {
        await this.mirrorSummaryToAttachment({
          attachmentId: input.sourceAttachmentId,
          semanticSummary: existingSummary.semanticSummary,
          semanticSummarySource: existingSummary.semanticSummarySource
        });
      }
      return { accepted: false, reason: "already_summarized" };
    }
    const existingJob = await this.prisma.assistantUploadMicroDescriptionJob.findUnique({
      where: { assistantFileId: input.assistantFileId }
    });
    if (existingJob !== null) {
      if (
        input.sourceAttachmentId !== null &&
        existingJob.sourceAttachmentId !== input.sourceAttachmentId
      ) {
        await this.prisma.assistantUploadMicroDescriptionJob.update({
          where: { id: existingJob.id },
          data: { sourceAttachmentId: input.sourceAttachmentId }
        });
      }
      return { accepted: false, reason: "already_enqueued" };
    }
    await this.prisma.assistantUploadMicroDescriptionJob.create({
      data: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        assistantFileId: input.assistantFileId,
        sourceAttachmentId: input.sourceAttachmentId
      }
    });
    return { accepted: true, reason: "queued" };
  }
}
