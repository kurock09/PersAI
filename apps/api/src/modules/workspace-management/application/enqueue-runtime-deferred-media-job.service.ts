import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  MAX_RUNTIME_IMAGE_EDIT_COUNT,
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_EDIT_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  type RuntimeAttachmentRef,
  type RuntimeImageEditRequest,
  type RuntimeImageGenerateRequest,
  type RuntimeVideoGenerateRequest
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
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { WorkspaceMonthlyToolQuotaToolCode } from "../domain/workspace-quota-accounting.repository";

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

export type EnqueueRuntimeDeferredMediaJobRejection = {
  accepted: false;
  code: string;
  limitKind:
    | "media_job_concurrency"
    | "monthly_media_quota"
    | "plan_feature_unavailable"
    | "runtime_degraded";
  message: string;
  requestedUnits: number;
  activeJobs?: number;
  maxActiveJobs?: number;
  guidance?: string | null;
};

@Injectable()
export class EnqueueRuntimeDeferredMediaJobService {
  private readonly logger = new Logger(EnqueueRuntimeDeferredMediaJobService.name);

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly assistantMediaJobService: AssistantMediaJobService,
    private readonly quotaGroundedLimitCopyService: QuotaGroundedLimitCopyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
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
    | EnqueueRuntimeDeferredMediaJobRejection
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

    const toolCode = input.directToolExecution.toolCode;
    const requestedUnits = this.extractRequestedUnitCount(input.directToolExecution);

    // 1) Concurrency ceiling. Checked before any side effect so a rejected
    //    third request never reserves quota. NOTE: this count-then-insert
    //    check is not transactionally atomic with the job insert below; see
    //    the residual-race note on `countOpenJobsForChat` usage.
    const openJobCount = await this.assistantMediaJobService.countOpenJobsForChat({
      assistantId: input.assistantId,
      chatId: chat.id
    });
    if (openJobCount >= MAX_OPEN_MEDIA_JOBS_PER_CHAT) {
      return {
        accepted: false,
        code: "media_job_concurrency_limit",
        limitKind: "media_job_concurrency",
        message: `This chat already has ${openJobCount} active media job(s). The maximum is ${MAX_OPEN_MEDIA_JOBS_PER_CHAT}. Wait for an existing job to complete before starting another.`,
        requestedUnits,
        activeJobs: openJobCount,
        maxActiveJobs: MAX_OPEN_MEDIA_JOBS_PER_CHAT,
        guidance: null
      };
    }

    // 2) Tool availability on the effective plan.
    const activation = await this.resolveActiveToolAssistant(
      input.assistantId,
      toolCode,
      requestedUnits
    );
    if ("rejection" in activation) {
      return activation.rejection;
    }
    const assistant = activation.assistant;

    // 3) Durable monthly media reservation at the enqueue seam (ADR-105 §7).
    //    This is the SINGLE reservation point; the worker no longer reserves.
    //    The repository performs an atomic serializable check-and-increment,
    //    so the unit reservation itself is race-safe against concurrent
    //    enqueues for the same workspace counter.
    const reservation =
      await this.trackWorkspaceQuotaUsageService.reserveAssistantMonthlyMediaQuota({
        assistant,
        toolCode,
        units: requestedUnits
      });
    if (!reservation.allowed) {
      const copy = await this.quotaGroundedLimitCopyService.build({
        assistantId: input.assistantId,
        code: "monthly_media_quota_exceeded",
        details: {
          toolCode,
          currentUsedUnits: reservation.currentUsedUnits,
          limitUnits: reservation.limitUnits,
          requestedUnits,
          periodStartedAt: reservation.periodStartedAt,
          periodEndsAt: reservation.periodEndsAt,
          periodSource: reservation.periodSource
        }
      });
      return {
        accepted: false,
        code: "monthly_media_quota_exceeded",
        limitKind: "monthly_media_quota",
        message: copy?.message ?? "The monthly media quota for this tool has been exhausted.",
        requestedUnits,
        guidance: copy?.guidance ?? null
      };
    }

    // 4) Persist the durable job. If the insert fails after a successful
    //    reservation, release the reserved units (compensating release) so we
    //    never leave an orphaned reservation without a job.
    const kind = this.kindForToolCode(toolCode);
    const request: AssistantMediaJobRequestPayload = {
      attachments: input.attachments,
      sourceUserMessageText: input.sourceUserMessageText,
      sourceUserMessageCreatedAt: sourceMessage.createdAt.toISOString(),
      directToolExecution: input.directToolExecution
    };
    let created: { id: string };
    try {
      created = await this.assistantMediaJobService.enqueue({
        assistantId: input.assistantId,
        userId: chat.userId,
        workspaceId: chat.workspaceId,
        chatId: chat.id,
        surface: chat.surface,
        kind,
        sourceUserMessageId: sourceMessage.id,
        request
      });
    } catch (error) {
      await this.releaseReservationBestEffort(assistant, toolCode, requestedUnits);
      throw error;
    }
    return {
      accepted: true,
      jobId: created.id,
      kind
    };
  }

  private async resolveActiveToolAssistant(
    assistantId: string,
    toolCode: DirectToolExecutionPayload["toolCode"],
    requestedUnits: number
  ): Promise<
    | {
        assistant: Awaited<
          ReturnType<ResolveInternalRuntimeToolDailyPolicyService["execute"]>
        >["assistant"];
      }
    | { rejection: EnqueueRuntimeDeferredMediaJobRejection }
  > {
    try {
      const policy = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
        assistantId,
        toolCode
      });
      const effectiveTool = policy.tools[0];
      if (effectiveTool === undefined || effectiveTool.activationStatus !== "active") {
        return { rejection: this.planFeatureUnavailableRejection(requestedUnits) };
      }
      return { assistant: policy.assistant };
    } catch {
      return { rejection: this.planFeatureUnavailableRejection(requestedUnits) };
    }
  }

  private planFeatureUnavailableRejection(
    requestedUnits: number
  ): EnqueueRuntimeDeferredMediaJobRejection {
    return {
      accepted: false,
      code: "plan_feature_unavailable",
      limitKind: "plan_feature_unavailable",
      message: "This media tool is not active for the current plan or configuration.",
      requestedUnits,
      guidance: null
    };
  }

  private async releaseReservationBestEffort(
    assistant: Parameters<
      TrackWorkspaceQuotaUsageService["releaseAssistantMonthlyMediaQuota"]
    >[0]["assistant"],
    toolCode: WorkspaceMonthlyToolQuotaToolCode,
    units: number
  ): Promise<void> {
    try {
      await this.trackWorkspaceQuotaUsageService.releaseAssistantMonthlyMediaQuota({
        assistant,
        toolCode,
        units
      });
    } catch (error) {
      this.logger.error(
        `Failed to release enqueue-time monthly media reservation after job insert failure (toolCode=${toolCode}, units=${String(units)}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private extractRequestedUnitCount(directToolExecution: DirectToolExecutionPayload): number {
    if (
      directToolExecution.toolCode === "image_generate" ||
      directToolExecution.toolCode === "image_edit"
    ) {
      return directToolExecution.request.count;
    }
    return 1;
  }

  private directToolExecution(value: unknown): DirectToolExecutionPayload {
    const row = this.objectValue(value, "directToolExecution");
    const request = this.objectValue(row.request, "directToolExecution.request");
    if (row.toolCode === "image_generate") {
      const count = this.validateMediaCount(
        request.count,
        MIN_RUNTIME_IMAGE_GENERATE_COUNT,
        MAX_RUNTIME_IMAGE_GENERATE_COUNT,
        "image_generate"
      );
      return {
        toolCode: "image_generate",
        request: { ...(request as unknown as RuntimeImageGenerateRequest), count }
      };
    }
    if (row.toolCode === "image_edit") {
      const count = this.validateMediaCount(
        request.count,
        MIN_RUNTIME_IMAGE_EDIT_COUNT,
        MAX_RUNTIME_IMAGE_EDIT_COUNT,
        "image_edit"
      );
      return {
        toolCode: "image_edit",
        request: { ...(request as unknown as RuntimeImageEditRequest), count }
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

  /**
   * ADR-105 — validate the requested media result count on the enqueue parse
   * path. The reservation seam reserves exactly this many units, so an
   * out-of-range or non-integer count must be rejected with a 4xx rather than
   * silently cast through and reserved.
   */
  private validateMediaCount(value: unknown, min: number, max: number, toolCode: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(
        `directToolExecution.request.count for ${toolCode} must be an integer between ${String(min)} and ${String(max)}.`
      );
    }
    return value;
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
