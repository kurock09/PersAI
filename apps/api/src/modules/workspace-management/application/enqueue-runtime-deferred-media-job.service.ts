import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  RuntimeAttachmentRef,
  RuntimeImageEditRequest,
  RuntimeImageGenerateRequest,
  RuntimeVideoGenerateRequest
} from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  AssistantMediaJobService,
  type AssistantMediaJobRequestPayload
} from "./assistant-media-job.service";
import { QuotaGroundedLimitCopyService } from "./quota-grounded-limit-copy.service";
import { ReadInternalRuntimeQuotaStatusService } from "./read-internal-runtime-quota-status.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";

const MAX_OPEN_MEDIA_JOBS_PER_CHAT = 2;

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

export type EnqueueRuntimeDeferredMediaJobInput = {
  assistantId: string;
  sourceUserMessageId: string;
  sourceUserMessageText: string;
  attachments: RuntimeAttachmentRef[];
  directToolExecution: DirectToolExecutionPayload;
};

@Injectable()
export class EnqueueRuntimeDeferredMediaJobService {
  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly quotaGroundedLimitCopyService: QuotaGroundedLimitCopyService,
    private readonly readInternalRuntimeQuotaStatusService: ReadInternalRuntimeQuotaStatusService,
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService
  ) {}

  parseInput(payload: unknown): EnqueueRuntimeDeferredMediaJobInput {
    const row = this.objectValue(payload, "payload");
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      sourceUserMessageId: this.requiredString(row.sourceUserMessageId, "sourceUserMessageId"),
      sourceUserMessageText: this.requiredString(
        row.sourceUserMessageText,
        "sourceUserMessageText"
      ),
      attachments: this.attachments(row.attachments),
      directToolExecution: this.directToolExecution(row.directToolExecution)
    };
  }

  async execute(input: EnqueueRuntimeDeferredMediaJobInput): Promise<
    | {
        accepted: true;
        jobId: string;
        kind: "image" | "video";
      }
    | {
        accepted: false;
        code: string;
        message: string;
        guidance?: string | null;
      }
  > {
    const sourceMessage = await this.assistantChatRepository.findMessageByIdForAssistant(
      input.sourceUserMessageId,
      input.assistantId
    );
    if (sourceMessage === null || sourceMessage.author !== "user") {
      throw new NotFoundException("Source user message was not found for deferred media enqueue.");
    }
    const chat = await this.assistantChatRepository.findChatById(sourceMessage.chatId);
    if (chat === null || chat.assistantId !== input.assistantId) {
      throw new NotFoundException("Chat was not found for deferred media enqueue.");
    }

    const openJobCount = await this.assistantMediaJobService.countOpenJobsForChat({
      assistantId: input.assistantId,
      chatId: chat.id
    });
    if (openJobCount >= MAX_OPEN_MEDIA_JOBS_PER_CHAT) {
      return {
        accepted: false,
        code: "media_job_queue_full",
        message: "There are already active background media jobs for this chat.",
        guidance: null
      };
    }

    const admission = await this.precheckToolAvailabilityAndQuota(
      input.assistantId,
      input.directToolExecution.toolCode
    );
    if (admission.allowed !== true) {
      return {
        accepted: false,
        code: admission.code,
        message: admission.message,
        guidance: admission.guidance
      };
    }

    const kind = this.kindForToolCode(input.directToolExecution.toolCode);
    const request: AssistantMediaJobRequestPayload = {
      attachments: input.attachments,
      sourceUserMessageText: input.sourceUserMessageText,
      sourceUserMessageCreatedAt: sourceMessage.createdAt.toISOString(),
      directToolExecution: input.directToolExecution
    };
    const created = await this.assistantMediaJobService.enqueue({
      assistantId: input.assistantId,
      userId: chat.userId,
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      surface: chat.surface,
      kind,
      sourceUserMessageId: sourceMessage.id,
      request
    });
    return {
      accepted: true,
      jobId: created.id,
      kind
    };
  }

  private async precheckToolAvailabilityAndQuota(
    assistantId: string,
    toolCode: DirectToolExecutionPayload["toolCode"]
  ): Promise<
    | {
        allowed: true;
      }
    | {
        allowed: false;
        code: string;
        message: string;
        guidance: string | null;
      }
  > {
    try {
      const policy = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
        assistantId,
        toolCode
      });
      const effectiveTool = policy.tools[0];
      if (effectiveTool === undefined || effectiveTool.activationStatus !== "active") {
        return {
          allowed: false,
          code: "plan_feature_unavailable",
          message: "This media tool is not active for the current plan or configuration.",
          guidance: null
        };
      }
    } catch {
      return {
        allowed: false,
        code: "plan_feature_unavailable",
        message: "This media tool is not active for the current plan or configuration.",
        guidance: null
      };
    }

    const status = await this.readInternalRuntimeQuotaStatusService.execute({ assistantId });
    const quotaRow =
      status.monthlyMediaQuotas === null
        ? null
        : (status.monthlyMediaQuotas.tools.find((entry) => entry.toolCode === toolCode) ?? null);
    if (quotaRow?.status === "limit_reached" || quotaRow?.remainingUnits === 0) {
      const copy = await this.quotaGroundedLimitCopyService.build({
        assistantId,
        code: "monthly_media_quota_exceeded",
        details: {
          toolCode,
          currentUsedUnits: quotaRow.usedUnits,
          limitUnits:
            typeof quotaRow.effectiveLimitUnits === "number"
              ? quotaRow.effectiveLimitUnits
              : quotaRow.limitUnits,
          requestedUnits: 1,
          periodStartedAt: status.monthlyMediaQuotas?.periodStartedAt ?? null,
          periodEndsAt: status.monthlyMediaQuotas?.periodEndsAt ?? null,
          periodSource: status.monthlyMediaQuotas?.periodSource ?? null
        }
      });
      return {
        allowed: false,
        code: "monthly_media_quota_exceeded",
        message: copy?.message ?? "The monthly media quota for this tool has been exhausted.",
        guidance: copy?.guidance ?? null
      };
    }
    if (quotaRow?.status === "usage_unavailable" || quotaRow === null) {
      return {
        allowed: false,
        code: "runtime_degraded",
        message: "Media quota status is temporarily unavailable.",
        guidance: null
      };
    }
    return { allowed: true };
  }

  private directToolExecution(value: unknown): DirectToolExecutionPayload {
    const row = this.objectValue(value, "directToolExecution");
    const request = this.objectValue(row.request, "directToolExecution.request");
    if (row.toolCode === "image_generate") {
      return {
        toolCode: "image_generate",
        request: request as unknown as RuntimeImageGenerateRequest
      };
    }
    if (row.toolCode === "image_edit") {
      return {
        toolCode: "image_edit",
        request: request as unknown as RuntimeImageEditRequest
      };
    }
    if (row.toolCode === "video_generate") {
      return {
        toolCode: "video_generate",
        request: request as unknown as RuntimeVideoGenerateRequest
      };
    }
    throw new BadRequestException(
      "directToolExecution.toolCode must be image_generate, image_edit, or video_generate."
    );
  }

  private attachments(value: unknown): RuntimeAttachmentRef[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("attachments must be an array.");
    }
    if (!value.every((entry) => this.isAttachmentRef(entry))) {
      throw new BadRequestException("attachments must contain valid runtime attachment refs.");
    }
    return value;
  }

  private kindForToolCode(toolCode: DirectToolExecutionPayload["toolCode"]): "image" | "video" {
    return toolCode === "video_generate" ? "video" : "image";
  }

  private requiredString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

  private objectValue(value: unknown, fieldName: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
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
}
