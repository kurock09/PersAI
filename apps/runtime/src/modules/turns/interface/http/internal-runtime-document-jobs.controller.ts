import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import {
  PERSAI_RUNTIME_TIERS,
  type PersaiRuntimeTier,
  type RuntimeDocumentJobCompletionRequest,
  type RuntimeDocumentJobCompletionResult,
  type RuntimeDocumentJobRunRequest,
  type RuntimeDocumentJobRunResult,
  type RuntimeDocumentSourceFile
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../../../runtime-config";
import { RuntimeDocumentJobCompletionService } from "../../runtime-document-job-completion.service";
import { RuntimeDocumentJobRunService } from "../../runtime-document-job-run.service";
import {
  assertRuntimeInternalApiAuthorized,
  type RuntimeInternalRequestLike
} from "./assert-runtime-internal-auth";

@Controller("api/v1/internal/runtime/document-jobs")
export class InternalRuntimeDocumentJobsController {
  constructor(
    private readonly runtimeDocumentJobRunService: RuntimeDocumentJobRunService,
    private readonly runtimeDocumentJobCompletionService: RuntimeDocumentJobCompletionService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  @HttpCode(200)
  @Post("run")
  async run(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: unknown
  ): Promise<RuntimeDocumentJobRunResult> {
    this.assertAuthorized(req);
    return this.runtimeDocumentJobRunService.run(this.parseInput(body));
  }

  @HttpCode(200)
  @Post("complete")
  async complete(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: unknown
  ): Promise<RuntimeDocumentJobCompletionResult> {
    this.assertAuthorized(req);
    return this.runtimeDocumentJobCompletionService.complete(this.parseCompletionInput(body));
  }

  private assertAuthorized(req: RuntimeInternalRequestLike): void {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for runtime internal endpoints.",
      "Internal runtime authorization failed."
    );
  }

  private parseInput(body: unknown): RuntimeDocumentJobRunRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Document-job run request must be a JSON object.");
    }
    const row = body as Record<string, unknown>;
    const job = this.objectField(row.job, "job");
    const direct = this.objectField(row.directToolExecution, "directToolExecution");
    const request = this.objectField(direct.request, "directToolExecution.request");
    // ADR-097 Slice 2 — patch-revise loop. The scheduler forwards the exact
    // previous-version rendered HTML for revise_document PDF jobs so the worker
    // can apply SEARCH/REPLACE patches instead of re-generating the document.
    // Empty strings and non-strings collapse to null (the adapter treats null
    // as "no patch-revise available" and falls back to single-shot or chunked).
    const previousVersionRenderedHtml =
      typeof row.previousVersionRenderedHtml === "string" &&
      row.previousVersionRenderedHtml.length > 0
        ? row.previousVersionRenderedHtml
        : null;

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
        docId: this.requiredString(job.docId, "job.docId"),
        versionId: this.requiredString(job.versionId, "job.versionId"),
        surface: this.jobSurface(job.surface),
        chatId: this.requiredString(job.chatId, "job.chatId"),
        provider: this.provider(job.provider),
        outputFormat: this.outputFormat(job.outputFormat),
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
      attachments: this.attachments(row.attachments),
      sourceFiles: this.sourceFiles(row.sourceFiles),
      ...(previousVersionRenderedHtml === null ? {} : { previousVersionRenderedHtml }),
      directToolExecution: {
        toolCode: this.toolCode(direct.toolCode),
        descriptorMode: this.descriptorMode(direct.descriptorMode),
        request: {
          prompt: this.requiredString(request.prompt, "directToolExecution.request.prompt"),
          instructions:
            request.instructions === null || request.instructions === undefined
              ? null
              : this.stringValue(request.instructions, "directToolExecution.request.instructions"),
          outputFormat:
            request.outputFormat === null || request.outputFormat === undefined
              ? null
              : this.outputFormat(request.outputFormat),
          docId:
            request.docId === null || request.docId === undefined
              ? null
              : this.requiredString(request.docId, "directToolExecution.request.docId"),
          requestedName:
            request.requestedName === null || request.requestedName === undefined
              ? null
              : this.stringValue(
                  request.requestedName,
                  "directToolExecution.request.requestedName"
                ),
          visualStyle:
            request.visualStyle === null || request.visualStyle === undefined
              ? null
              : this.presentationVisualStyle(request.visualStyle),
          imagePolicy:
            request.imagePolicy === null || request.imagePolicy === undefined
              ? null
              : this.presentationImagePolicy(request.imagePolicy),
          visualDensity:
            request.visualDensity === null || request.visualDensity === undefined
              ? null
              : this.presentationVisualDensity(request.visualDensity),
          gammaThemeId:
            request.gammaThemeId === null || request.gammaThemeId === undefined
              ? null
              : this.stringValue(request.gammaThemeId, "directToolExecution.request.gammaThemeId"),
          targetSlideCount: this.optionalTargetSlideCount(request.targetSlideCount),
          outline: request.outline,
          metadata:
            request.metadata === null || request.metadata === undefined
              ? null
              : this.objectField(request.metadata, "directToolExecution.request.metadata")
        }
      }
    };
  }

  private optionalTargetSlideCount(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new BadRequestException(
        "directToolExecution.request.targetSlideCount must be a finite number when provided."
      );
    }
    const rounded = Math.round(value);
    if (rounded < 1) {
      return null;
    }
    return Math.min(rounded, 30);
  }

  private parseCompletionInput(body: unknown): RuntimeDocumentJobCompletionRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Document-job completion request must be a JSON object.");
    }
    const row = body as Record<string, unknown>;
    const job = this.objectField(row.job, "job");
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
        docId: this.requiredString(job.docId, "job.docId"),
        versionId: this.requiredString(job.versionId, "job.versionId"),
        surface: this.jobSurface(job.surface),
        chatId: this.requiredString(job.chatId, "job.chatId"),
        outputFormat: this.outputFormat(job.outputFormat),
        descriptorMode: this.descriptorMode(job.descriptorMode),
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
          workerResult.assistantText === null || workerResult.assistantText === undefined
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

  private objectField(value: unknown, fieldName: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
  }

  private runtimeTier(value: unknown): PersaiRuntimeTier {
    if (typeof value !== "string" || !PERSAI_RUNTIME_TIERS.includes(value as PersaiRuntimeTier)) {
      throw new BadRequestException("runtimeTier must be a valid runtime tier.");
    }
    return value as PersaiRuntimeTier;
  }

  private jobSurface(value: unknown): "web" | "telegram" {
    if (value === "web" || value === "telegram") {
      return value;
    }
    throw new BadRequestException("job.surface must be one of web or telegram.");
  }

  private provider(value: unknown): "sandbox" | "gamma" {
    if (value === "sandbox" || value === "gamma") {
      return value;
    }
    throw new BadRequestException("job.provider must be one of sandbox or gamma.");
  }

  private outputFormat(value: unknown): "pdf" | "pptx" | "xlsx" | "docx" {
    if (value === "pdf" || value === "pptx" || value === "xlsx" || value === "docx") {
      return value;
    }
    throw new BadRequestException("outputFormat must be one of pdf, pptx, xlsx, or docx.");
  }

  private toolCode(value: unknown): "document" {
    if (value === "document") {
      return value;
    }
    throw new BadRequestException("directToolExecution.toolCode must be document.");
  }

  private descriptorMode(
    value: unknown
  ):
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver"
    | "create_data_document" {
    if (
      value === "create_pdf_document" ||
      value === "create_presentation" ||
      value === "revise_document" ||
      value === "export_or_redeliver" ||
      value === "create_data_document"
    ) {
      return value;
    }
    throw new BadRequestException("directToolExecution.descriptorMode is invalid.");
  }

  private presentationVisualStyle(
    value: unknown
  ): "professional_modern" | "bold_editorial" | "minimal_clean" | "illustrated_storytelling" {
    if (
      value === "professional_modern" ||
      value === "bold_editorial" ||
      value === "minimal_clean" ||
      value === "illustrated_storytelling"
    ) {
      return value;
    }
    throw new BadRequestException("directToolExecution.request.visualStyle is invalid.");
  }

  private presentationImagePolicy(
    value: unknown
  ): "ai_generated" | "web_free_to_use" | "pictographic" | "text_only" {
    if (
      value === "ai_generated" ||
      value === "web_free_to_use" ||
      value === "pictographic" ||
      value === "text_only"
    ) {
      return value;
    }
    throw new BadRequestException("directToolExecution.request.imagePolicy is invalid.");
  }

  private presentationVisualDensity(value: unknown): "balanced" | "visual_heavy" | "text_heavy" {
    if (value === "balanced" || value === "visual_heavy" || value === "text_heavy") {
      return value;
    }
    throw new BadRequestException("directToolExecution.request.visualDensity is invalid.");
  }

  private attachments(value: unknown): RuntimeDocumentJobRunRequest["attachments"] {
    // Backward-compatible: jobs queued before the document-attachment path
    // existed will not include this field; treat as no attachments.
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new BadRequestException("attachments must be an array when provided.");
    }
    return value.map((entry, index) => {
      const row = this.objectField(entry, `attachments[${index}]`);
      const kind = row.kind;
      if (kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "file") {
        throw new BadRequestException(
          `attachments[${index}].kind must be one of "image", "audio", "video", "file".`
        );
      }
      const sizeBytesRaw = row.sizeBytes;
      const sizeBytes =
        typeof sizeBytesRaw === "number" && Number.isFinite(sizeBytesRaw) && sizeBytesRaw >= 0
          ? sizeBytesRaw
          : 0;
      const fileRef =
        row.fileRef === undefined
          ? undefined
          : row.fileRef === null
            ? null
            : this.stringValue(row.fileRef, `attachments[${index}].fileRef`);
      const aliases =
        row.aliases === undefined
          ? undefined
          : row.aliases === null
            ? null
            : Array.isArray(row.aliases)
              ? row.aliases.filter(
                  (alias): alias is string => typeof alias === "string" && alias.trim().length > 0
                )
              : null;
      return {
        attachmentId: this.requiredString(row.attachmentId, `attachments[${index}].attachmentId`),
        kind,
        objectKey: this.requiredString(row.objectKey, `attachments[${index}].objectKey`),
        mimeType: this.requiredString(row.mimeType, `attachments[${index}].mimeType`),
        filename:
          row.filename === null || row.filename === undefined
            ? null
            : this.stringValue(row.filename, `attachments[${index}].filename`),
        sizeBytes,
        ...(fileRef === undefined ? {} : { fileRef }),
        ...(aliases === undefined ? {} : { aliases })
      };
    });
  }

  private sourceFiles(value: unknown): RuntimeDocumentSourceFile[] {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new BadRequestException("sourceFiles must be an array when provided.");
    }
    return value.map((entry, index) => {
      const row = this.objectField(entry, `sourceFiles[${index}]`);
      return {
        attachmentId: this.requiredString(row.attachmentId, `sourceFiles[${index}].attachmentId`),
        filename:
          row.filename === null || row.filename === undefined
            ? null
            : this.stringValue(row.filename, `sourceFiles[${index}].filename`),
        mimeType: this.requiredString(row.mimeType, `sourceFiles[${index}].mimeType`),
        sizeBytes: this.sourceFileSizeBytes(row.sizeBytes, `sourceFiles[${index}].sizeBytes`),
        text:
          row.text === null || row.text === undefined
            ? null
            : this.stringValue(row.text, `sourceFiles[${index}].text`),
        markdown:
          row.markdown === null || row.markdown === undefined
            ? null
            : this.stringValue(row.markdown, `sourceFiles[${index}].markdown`),
        note:
          row.note === null || row.note === undefined
            ? null
            : this.stringValue(row.note, `sourceFiles[${index}].note`),
        provider:
          row.provider === null || row.provider === undefined
            ? null
            : (this.objectField(
                row.provider,
                `sourceFiles[${index}].provider`
              ) as RuntimeDocumentSourceFile["provider"]),
        quality:
          row.quality === null || row.quality === undefined
            ? null
            : (this.objectField(
                row.quality,
                `sourceFiles[${index}].quality`
              ) as RuntimeDocumentSourceFile["quality"])
      };
    });
  }

  private sourceFileSizeBytes(value: unknown, fieldName: string): number {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
    throw new BadRequestException(`${fieldName} must be a non-negative number.`);
  }

  private currentHistory(value: unknown): RuntimeDocumentJobCompletionRequest["currentHistory"] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("currentHistory must be an array.");
    }
    return value.map((entry, index) => {
      const row = this.objectField(entry, `currentHistory[${index}]`);
      const author = row.author;
      if (author !== "user" && author !== "assistant" && author !== "system") {
        throw new BadRequestException(
          `currentHistory[${index}].author must be one of user, assistant, or system.`
        );
      }
      return {
        author,
        content: this.stringValue(row.content, `currentHistory[${index}].content`),
        createdAt: this.requiredString(row.createdAt, `currentHistory[${index}].createdAt`)
      };
    });
  }

  private completionArtifacts(
    value: unknown
  ): NonNullable<RuntimeDocumentJobCompletionRequest["workerResult"]>["artifacts"] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("workerResult.artifacts must be an array.");
    }
    return value.map((entry, index) => {
      const row = this.objectField(entry, `workerResult.artifacts[${index}]`);
      const type = row.type;
      if (type !== "file" && type !== "image" && type !== "audio" && type !== "video") {
        throw new BadRequestException(
          `workerResult.artifacts[${index}].type must be a valid runtime artifact kind.`
        );
      }
      return {
        type,
        filename:
          row.filename === null || row.filename === undefined
            ? null
            : this.stringValue(row.filename, `workerResult.artifacts[${index}].filename`),
        fileRef:
          row.fileRef === null || row.fileRef === undefined
            ? null
            : this.stringValue(row.fileRef, `workerResult.artifacts[${index}].fileRef`)
      };
    });
  }
}
