import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import {
  PERSAI_RUNTIME_ATTACHMENT_KINDS,
  PERSAI_RUNTIME_TIERS,
  type PersaiRuntimeAttachmentKind,
  type PersaiRuntimeTier,
  type RuntimeAttachmentRef,
  type RuntimeImageEditRequest,
  type RuntimeImageGenerateRequest,
  type RuntimeMediaJobCompletionRequest,
  type RuntimeMediaJobCompletionResult,
  type RuntimeMediaJobRunRequest,
  type RuntimeMediaJobRunResult,
  type RuntimeVideoGenerateRequest
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../../../runtime-config";
import { RuntimeMediaJobCompletionService } from "../../runtime-media-job-completion.service";
import { RuntimeMediaJobRunService } from "../../runtime-media-job-run.service";
import {
  assertRuntimeInternalApiAuthorized,
  type RuntimeInternalRequestLike
} from "./assert-runtime-internal-auth";

@Controller("api/v1/internal/runtime/media-jobs")
export class InternalRuntimeMediaJobsController {
  constructor(
    private readonly runtimeMediaJobRunService: RuntimeMediaJobRunService,
    private readonly runtimeMediaJobCompletionService: RuntimeMediaJobCompletionService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  @HttpCode(200)
  @Post("run")
  async run(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: unknown
  ): Promise<RuntimeMediaJobRunResult> {
    this.assertAuthorized(req);
    return this.runtimeMediaJobRunService.run(this.parseInput(body));
  }

  @HttpCode(200)
  @Post("complete")
  async complete(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: unknown
  ): Promise<RuntimeMediaJobCompletionResult> {
    this.assertAuthorized(req);
    return this.runtimeMediaJobCompletionService.complete(this.parseCompletionInput(body));
  }

  private assertAuthorized(req: RuntimeInternalRequestLike): void {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for runtime internal endpoints.",
      "Internal runtime authorization failed."
    );
  }

  private parseInput(body: unknown): RuntimeMediaJobRunRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Media-job run request must be a JSON object.");
    }
    const row = body as Record<string, unknown>;
    const job = row.job;
    if (job === null || typeof job !== "object" || Array.isArray(job)) {
      throw new BadRequestException("job must be a JSON object.");
    }
    const jobRow = job as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      runtimeTier: this.runtimeTier(row.runtimeTier),
      runtimeBundleDocument: this.requiredString(
        row.runtimeBundleDocument,
        "runtimeBundleDocument"
      ),
      job: {
        id: this.requiredString(jobRow.id, "job.id"),
        surface: this.jobSurface(jobRow.surface),
        kind: this.jobKind(jobRow.kind),
        chatId: this.requiredString(jobRow.chatId, "job.chatId"),
        sourceUserMessageId: this.requiredString(
          jobRow.sourceUserMessageId,
          "job.sourceUserMessageId"
        ),
        sourceUserMessageText: this.requiredString(
          jobRow.sourceUserMessageText,
          "job.sourceUserMessageText"
        ),
        sourceUserMessageCreatedAt: this.requiredString(
          jobRow.sourceUserMessageCreatedAt,
          "job.sourceUserMessageCreatedAt"
        )
      },
      attachments: this.attachments(row.attachments),
      directToolExecution: this.directToolExecution(row.directToolExecution)
    };
  }

  private parseCompletionInput(body: unknown): RuntimeMediaJobCompletionRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Media-job completion request must be a JSON object.");
    }
    const row = body as Record<string, unknown>;
    const job = this.jobObject(row.job);
    const workerResult = this.objectField(row.workerResult, "workerResult");
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      runtimeTier: this.runtimeTier(row.runtimeTier),
      runtimeBundleDocument: this.requiredString(
        row.runtimeBundleDocument,
        "runtimeBundleDocument"
      ),
      job: {
        id: this.requiredString(job.id, "job.id"),
        surface: this.jobSurface(job.surface),
        kind: this.jobKind(job.kind),
        chatId: this.requiredString(job.chatId, "job.chatId"),
        sourceUserMessageId: this.requiredString(
          job.sourceUserMessageId,
          "job.sourceUserMessageId"
        ),
        sourceUserMessageText: this.requiredString(
          job.sourceUserMessageText,
          "job.sourceUserMessageText"
        ),
        sourceUserMessageCreatedAt: this.requiredString(
          job.sourceUserMessageCreatedAt,
          "job.sourceUserMessageCreatedAt"
        )
      },
      currentHistory: this.currentHistory(row.currentHistory),
      workerResult: {
        assistantText:
          workerResult.assistantText === null
            ? null
            : this.stringValue(workerResult.assistantText, "workerResult.assistantText"),
        artifacts: this.completionArtifacts(workerResult.artifacts)
      }
    };
  }

  private requiredString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

  private stringValue(value: unknown, fieldName: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${fieldName} must be a string.`);
    }
    return value;
  }

  private runtimeTier(value: unknown): PersaiRuntimeTier {
    if (typeof value !== "string" || !PERSAI_RUNTIME_TIERS.includes(value as PersaiRuntimeTier)) {
      throw new BadRequestException("runtimeTier must be a valid runtime tier.");
    }
    return value as PersaiRuntimeTier;
  }

  private jobKind(value: unknown): "image" | "audio" | "video" {
    if (value === "image" || value === "audio" || value === "video") {
      return value;
    }
    throw new BadRequestException("job.kind must be one of image, audio, or video.");
  }

  private jobSurface(value: unknown): "web" | "telegram" {
    if (value === "web" || value === "telegram") {
      return value;
    }
    throw new BadRequestException("job.surface must be one of web or telegram.");
  }

  private attachments(value: unknown): RuntimeAttachmentRef[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("attachments must be an array.");
    }
    return value.map((entry, index) => this.attachment(entry, index));
  }

  private directToolExecution(
    value: unknown
  ): NonNullable<RuntimeMediaJobRunRequest["directToolExecution"]> {
    const row = this.objectField(value, "directToolExecution");
    if (row.toolCode === "image_generate") {
      return {
        toolCode: "image_generate",
        request: this.objectField(
          row.request,
          "directToolExecution.request"
        ) as unknown as RuntimeImageGenerateRequest
      };
    }
    if (row.toolCode === "image_edit") {
      return {
        toolCode: "image_edit",
        request: this.objectField(
          row.request,
          "directToolExecution.request"
        ) as unknown as RuntimeImageEditRequest
      };
    }
    if (row.toolCode === "video_generate") {
      return {
        toolCode: "video_generate",
        request: this.objectField(
          row.request,
          "directToolExecution.request"
        ) as unknown as RuntimeVideoGenerateRequest
      };
    }
    throw new BadRequestException(
      "directToolExecution.toolCode must be one of image_generate, image_edit, or video_generate."
    );
  }

  private currentHistory(value: unknown): RuntimeMediaJobCompletionRequest["currentHistory"] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("currentHistory must be an array.");
    }
    return value.map((entry, index) => {
      const row = this.objectField(entry, `currentHistory[${String(index)}]`);
      const author = row.author;
      if (author !== "user" && author !== "assistant" && author !== "system") {
        throw new BadRequestException(
          `currentHistory[${String(index)}].author must be user, assistant, or system.`
        );
      }
      return {
        author,
        content: this.requiredString(row.content, `currentHistory[${String(index)}].content`),
        createdAt: this.requiredString(row.createdAt, `currentHistory[${String(index)}].createdAt`)
      };
    });
  }

  private completionArtifacts(
    value: unknown
  ): RuntimeMediaJobCompletionRequest["workerResult"]["artifacts"] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("workerResult.artifacts must be an array.");
    }
    return value.map((entry, index) => {
      const row = this.objectField(entry, `workerResult.artifacts[${String(index)}]`);
      const type = row.type;
      if (type !== "image" && type !== "audio" && type !== "video" && type !== "file") {
        throw new BadRequestException(
          `workerResult.artifacts[${String(index)}].type must be image, audio, video, or file.`
        );
      }
      return {
        type,
        filename:
          row.filename === null
            ? null
            : this.requiredString(
                row.filename,
                `workerResult.artifacts[${String(index)}].filename`
              ),
        fileRef:
          row.fileRef === null
            ? null
            : this.requiredString(row.fileRef, `workerResult.artifacts[${String(index)}].fileRef`)
      };
    });
  }

  private jobObject(value: unknown): Record<string, unknown> {
    return this.objectField(value, "job");
  }

  private objectField(value: unknown, fieldName: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
  }

  private attachment(value: unknown, index: number): RuntimeAttachmentRef {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`attachments[${String(index)}] must be an object.`);
    }
    const row = value as Record<string, unknown>;
    const kind = row.kind;
    if (
      typeof kind !== "string" ||
      !PERSAI_RUNTIME_ATTACHMENT_KINDS.includes(kind as PersaiRuntimeAttachmentKind)
    ) {
      throw new BadRequestException(`attachments[${String(index)}].kind must be valid.`);
    }
    const sizeBytes = row.sizeBytes;
    if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new BadRequestException(`attachments[${String(index)}].sizeBytes must be valid.`);
    }
    return {
      attachmentId: this.requiredString(
        row.attachmentId,
        `attachments[${String(index)}].attachmentId`
      ),
      kind: kind as PersaiRuntimeAttachmentKind,
      objectKey: this.requiredString(row.objectKey, `attachments[${String(index)}].objectKey`),
      mimeType: this.requiredString(row.mimeType, `attachments[${String(index)}].mimeType`),
      filename:
        row.filename === null
          ? null
          : this.requiredString(row.filename, `attachments[${String(index)}].filename`),
      sizeBytes,
      ...(row.fileRef === null || row.fileRef === undefined
        ? {}
        : { fileRef: this.requiredString(row.fileRef, `attachments[${String(index)}].fileRef`) })
    };
  }
}
