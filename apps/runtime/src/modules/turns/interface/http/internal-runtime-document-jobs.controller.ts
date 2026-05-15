import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import {
  PERSAI_RUNTIME_TIERS,
  type PersaiRuntimeTier,
  type RuntimeDocumentJobRunRequest,
  type RuntimeDocumentJobRunResult
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../../../runtime-config";
import { RuntimeDocumentJobRunService } from "../../runtime-document-job-run.service";
import {
  assertRuntimeInternalApiAuthorized,
  type RuntimeInternalRequestLike
} from "./assert-runtime-internal-auth";

@Controller("api/v1/internal/runtime/document-jobs")
export class InternalRuntimeDocumentJobsController {
  constructor(
    private readonly runtimeDocumentJobRunService: RuntimeDocumentJobRunService,
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
          outline: request.outline,
          metadata:
            request.metadata === null || request.metadata === undefined
              ? null
              : this.objectField(request.metadata, "directToolExecution.request.metadata")
        }
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

  private provider(value: unknown): "pdfmonkey" | "gamma" {
    if (value === "pdfmonkey" || value === "gamma") {
      return value;
    }
    throw new BadRequestException("job.provider must be one of pdfmonkey or gamma.");
  }

  private outputFormat(value: unknown): "pdf" | "pptx" {
    if (value === "pdf" || value === "pptx") {
      return value;
    }
    throw new BadRequestException("outputFormat must be one of pdf or pptx.");
  }

  private toolCode(value: unknown): "document" {
    if (value === "document") {
      return value;
    }
    throw new BadRequestException("directToolExecution.toolCode must be document.");
  }

  private descriptorMode(
    value: unknown
  ): "create_pdf_document" | "create_presentation" | "revise_document" | "export_or_redeliver" {
    if (
      value === "create_pdf_document" ||
      value === "create_presentation" ||
      value === "revise_document" ||
      value === "export_or_redeliver"
    ) {
      return value;
    }
    throw new BadRequestException("directToolExecution.descriptorMode is invalid.");
  }
}
