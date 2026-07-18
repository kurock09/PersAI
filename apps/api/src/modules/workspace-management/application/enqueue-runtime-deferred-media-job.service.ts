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
} from "./workspace-media-job.service";
import { QuotaGroundedLimitCopyService } from "./quota-grounded-limit-copy.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { WorkspaceMonthlyToolQuotaToolCode } from "../domain/workspace-quota-accounting.repository";
import {
  WORKSPACE_VCOIN_BALANCE_REPOSITORY,
  type WorkspaceVcoinBalanceRepository
} from "../domain/workspace-vcoin-balance.repository";

const MAX_OPEN_MEDIA_JOBS_PER_CHAT = 8;

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
  sourceClientTurnId?: string;
  sourceUserMessageText: string;
  runtimeSessionId: string;
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
    | "runtime_degraded"
    /**
     * ADR-108 Slice 2 — workspace VC wallet is empty (`balance_vc <= 0`)
     * and this is a `video_generate` enqueue. The pre-check rejects
     * BEFORE the existing monthly-unit-counter reservation runs, so a
     * workspace with zero VC never starts the provider job. Image /
     * image-edit / TTS / STT branches never produce this rejection.
     */
    | "vcoin_balance_exhausted";
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
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    // ADR-108 Slice 2 — VC wallet repository for the advisory pre-check
    // on `video_generate` enqueue. Image / image-edit / TTS / STT
    // enqueues never read the wallet and never produce the
    // `vcoin_balance_exhausted` rejection.
    @Inject(WORKSPACE_VCOIN_BALANCE_REPOSITORY)
    private readonly workspaceVcoinBalanceRepository: WorkspaceVcoinBalanceRepository
  ) {}

  parseInput(payload: unknown): EnqueueRuntimeDeferredMediaJobInput {
    const row = this.objectValue(payload, "payload");
    const sourceUserMessageId = this.requiredString(row.sourceUserMessageId, "sourceUserMessageId");
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      sourceUserMessageId,
      sourceClientTurnId:
        row.sourceClientTurnId === undefined
          ? sourceUserMessageId
          : this.requiredString(row.sourceClientTurnId, "sourceClientTurnId"),
      sourceUserMessageText: this.requiredString(
        row.sourceUserMessageText,
        "sourceUserMessageText"
      ),
      runtimeSessionId: this.requiredString(row.runtimeSessionId, "runtimeSessionId"),
      attachments: this.attachments(row.attachments),
      directToolExecution: this.directToolExecution(row.directToolExecution)
    };
  }

  async execute(input: EnqueueRuntimeDeferredMediaJobInput): Promise<
    | {
        accepted: true;
        jobId: string;
        jobRef: string;
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

    // 2b) ADR-108 Slice 2 — advisory VC wallet pre-check for
    //     `video_generate` only. The wallet lifecycle (ADR-108) allows
    //     `balance_vc` to dip just-below-zero on a single in-flight
    //     settle, then the next enqueue with `balance_vc <= 0` is
    //     rejected here. The check is presence-only — NOT unit-count
    //     based (cost can only be known after the provider returns
    //     billing facts; ADR-108 explicitly chooses settle-only debit
    //     over reserve-then-refund). Image / image-edit / TTS / STT
    //     branches skip this entirely.
    //
    // ADR-108 Slice 8 — the legacy `videoGenerateMonthlyUnitsLimit`
    // monthly counter is no longer consulted for `video_generate`. The
    // VC wallet pre-check above is the SOLE gating mechanism for
    // video. The monthly_media_quota reservation below runs ONLY for
    // image_generate / image_edit; video bypasses it entirely so a
    // residual non-zero `limit_units` in `workspace_media_monthly_quota_counters`
    // (left over from pre-Slice-8 settles) cannot reject a video
    // enqueue while the wallet has VC available.
    if (toolCode === "video_generate") {
      const wallet = await this.workspaceVcoinBalanceRepository.getOrCreate(assistant.workspaceId);
      if (wallet.balanceVc <= 0) {
        return {
          accepted: false,
          code: "vcoin_balance_exhausted",
          limitKind: "vcoin_balance_exhausted",
          message:
            "Your Vcoin balance is empty. Top up via the Packages page or wait for your monthly plan grant before generating another video.",
          requestedUnits,
          guidance: null
        };
      }
    }

    // 3) Durable monthly media reservation at the enqueue seam (ADR-105 §7).
    //    Only `image_generate` / `image_edit` (and other unit-priced
    //    monthly tools) pass through this seam. `video_generate` is
    //    VC-priced after Slice 8 and never reserves units.
    if (toolCode !== "video_generate") {
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
    }

    // 4) Persist the durable job. If the insert fails after a successful
    //    reservation, release the reserved units (compensating release) so we
    //    never leave an orphaned reservation without a job.
    const kind = this.kindForToolCode(toolCode);
    const request: AssistantMediaJobRequestPayload = {
      attachments: input.attachments,
      sourceUserMessageText: input.sourceUserMessageText,
      sourceUserMessageCreatedAt: sourceMessage.createdAt.toISOString(),
      runtimeSessionId: input.runtimeSessionId,
      directToolExecution: input.directToolExecution
    };
    let created: { id: string; jobRef: string };
    try {
      created = await this.assistantMediaJobService.enqueue({
        assistantId: input.assistantId,
        userId: chat.userId,
        workspaceId: chat.workspaceId,
        chatId: chat.id,
        surface: chat.surface,
        kind,
        sourceUserMessageId: sourceMessage.id,
        sourceClientTurnId: input.sourceClientTurnId ?? sourceMessage.id,
        request
      });
    } catch (error) {
      // ADR-108 Slice 8 — video_generate never reserves monthly media
      // units, so there is nothing to release on failed enqueue. Only
      // unit-priced tools (image/image_edit) need the compensating
      // release here.
      if (toolCode !== "video_generate") {
        await this.releaseReservationBestEffort(assistant, toolCode, requestedUnits);
      }
      throw error;
    }
    return {
      accepted: true,
      jobId: created.id,
      jobRef: created.jobRef,
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
      if (
        directToolExecution.request.outputMode === "series" &&
        Array.isArray(directToolExecution.request.seriesItems)
      ) {
        return directToolExecution.request.seriesItems.length;
      }
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
      const validatedRequest = this.validateImageSeriesShape(
        {
          ...(request as unknown as RuntimeImageGenerateRequest),
          count
        },
        "image_generate"
      );
      return {
        toolCode: "image_generate",
        request: validatedRequest
      };
    }
    if (row.toolCode === "image_edit") {
      const count = this.validateMediaCount(
        request.count,
        MIN_RUNTIME_IMAGE_EDIT_COUNT,
        MAX_RUNTIME_IMAGE_EDIT_COUNT,
        "image_edit"
      );
      const validatedRequest = this.validateImageSeriesShape(
        {
          ...(request as unknown as RuntimeImageEditRequest),
          count
        },
        "image_edit"
      );
      return {
        toolCode: "image_edit",
        request: validatedRequest
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

  private validateImageSeriesShape<T extends RuntimeImageGenerateRequest | RuntimeImageEditRequest>(
    request: T,
    toolCode: "image_generate" | "image_edit"
  ): T {
    const outputMode = request.outputMode ?? null;
    if (outputMode !== null && outputMode !== "variants" && outputMode !== "series") {
      throw new BadRequestException(
        `directToolExecution.request.outputMode for ${toolCode} must be "variants", "series", or null.`
      );
    }
    const seriesItems = request.seriesItems ?? null;
    if (outputMode === "series") {
      if (!Array.isArray(seriesItems) || seriesItems.length === 0) {
        throw new BadRequestException(
          `directToolExecution.request.seriesItems for ${toolCode} must be a non-empty array when outputMode="series".`
        );
      }
      const normalizedItems = seriesItems.map((item, index) => {
        if (typeof item !== "string" || item.trim().length === 0) {
          throw new BadRequestException(
            `directToolExecution.request.seriesItems[${String(index)}] for ${toolCode} must be a non-empty string.`
          );
        }
        return item.trim();
      });
      if (normalizedItems.length !== request.count) {
        throw new BadRequestException(
          `directToolExecution.request.seriesItems for ${toolCode} must contain exactly ${String(request.count)} item(s) when outputMode="series".`
        );
      }
      return {
        ...request,
        outputMode: "series",
        seriesItems: normalizedItems
      };
    }
    if (seriesItems !== null) {
      throw new BadRequestException(
        `directToolExecution.request.seriesItems for ${toolCode} can only be provided when outputMode="series".`
      );
    }
    return {
      ...request,
      ...(outputMode === null ? { outputMode: null } : { outputMode }),
      seriesItems: null
    };
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
    if (typeof row.storagePath !== "string" || row.storagePath.trim().length === 0) {
      return false;
    }
    const displayNameOk =
      row.displayName === null ||
      typeof row.displayName === "string" ||
      row.filename === null ||
      typeof row.filename === "string" ||
      row.displayName === undefined;
    return (
      typeof row.attachmentId === "string" &&
      typeof row.kind === "string" &&
      typeof row.mimeType === "string" &&
      displayNameOk &&
      typeof row.sizeBytes === "number"
    );
  }
}
