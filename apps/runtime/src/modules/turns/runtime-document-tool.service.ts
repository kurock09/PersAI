import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_SANDBOX_POLICY,
  type PersaiRuntimePresentationImagePolicy,
  type PersaiRuntimePresentationVisualDensity,
  type PersaiRuntimePresentationVisualStyle,
  type ProviderGatewayToolCall,
  type RuntimeAttachmentRef,
  type RuntimeDocumentToolResult,
  type RuntimeOutputArtifact,
  type RuntimeSandboxJobRequest,
  type RuntimeSandboxJobResult,
  type RuntimeSandboxPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { SandboxClientService } from "./sandbox-client.service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RuntimeDocumentToolExecutionResult {
  payload: RuntimeDocumentToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeDocumentToolService {
  private readonly logger = new Logger(RuntimeDocumentToolService.name);

  constructor(
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly sandboxClientService?: SandboxClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId?: string;
    requestId?: string;
    deferToAsyncDocumentJob: {
      sourceUserMessageId: string;
      sourceUserMessageText: string;
      // Sticky-labeled current-turn attachments captured from the user turn
      // that triggered the tool call.
      currentAttachments: RuntimeAttachmentRef[];
      // Sticky-labeled reusable document-source attachments visible to the
      // current turn (current turn + prior reusable sources).
      // Forwarded into the document job so the worker can inline
      // text-extractable source-file content into the generation prompt.
      availableAttachments: RuntimeAttachmentRef[];
    };
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const parsed = this.readDocumentArguments(params.toolCall.arguments);
    if (parsed instanceof Error) {
      return {
        payload: {
          toolCode: "document",
          executionMode: "inline",
          requestedAction: null,
          descriptorMode: null,
          documentType: null,
          provider: null,
          prompt: null,
          outputFormat: null,
          docId: null,
          requestedName: null,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: parsed.message,
          jobId: null
        },
        artifacts: [],
        isError: true
      };
    }

    if (parsed.kind === "extract") {
      return this.executeExtractToolCall({
        bundle: params.bundle,
        request: parsed.request
      });
    }

    if (parsed.kind === "inspect") {
      return this.executeInspectToolCall({
        bundle: params.bundle,
        request: parsed.request
      });
    }

    if (parsed.kind === "render") {
      return this.executeRenderToolCall({
        bundle: params.bundle,
        request: parsed.request,
        sessionId: params.sessionId ?? null,
        requestId: params.requestId ?? null
      });
    }

    const currentAttachments = params.deferToAsyncDocumentJob.currentAttachments ?? [];
    const availableAttachments = params.deferToAsyncDocumentJob.availableAttachments ?? [];
    const sourceAttachments = this.selectSourceAttachmentsForRequest({
      attachments: availableAttachments,
      currentAttachments,
      descriptorMode: parsed.descriptorMode,
      prompt: parsed.request.prompt,
      sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText
    });
    const effectiveDescriptorMode = this.resolveEffectiveDescriptorMode({
      descriptorMode: parsed.descriptorMode,
      outputFormat: parsed.request.outputFormat ?? null,
      docId: parsed.request.docId ?? null,
      storagePath: parsed.request.storagePath ?? null,
      sourceAttachmentCount: sourceAttachments.length
    });
    const normalizedDocId = this.normalizeDocId(parsed.request.docId ?? null);
    const effectiveRequest =
      effectiveDescriptorMode === parsed.descriptorMode
        ? { ...parsed.request, docId: normalizedDocId }
        : { ...parsed.request, docId: null };
    const normalizedRequest = this.normalizePresentationRequest({
      descriptorMode: effectiveDescriptorMode,
      request: effectiveRequest
    });
    const outputFormat = normalizedRequest.outputFormat ?? null;
    const documentType =
      effectiveDescriptorMode === "create_data_document"
        ? "data_document"
        : outputFormat === "pptx" || effectiveDescriptorMode === "create_presentation"
          ? "presentation"
          : "pdf_document";
    // Mode B (create_data_document) always uses the sandbox provider.
    // For mode B, default outputFormat to xlsx if not specified.
    const effectiveOutputFormat: "pdf" | "pptx" | "xlsx" | "docx" | null =
      effectiveDescriptorMode === "create_data_document" && outputFormat === null
        ? "xlsx"
        : outputFormat;
    const provider = documentType === "presentation" ? "gamma" : "sandbox";
    // Diagnostic: surface what the model actually passed in the typed args
    // versus the system-resolved values, so production logs answer "did the
    // model send targetSlideCount?" without guessing.
    this.logger.log(
      `[document-tool] tool-args descriptorMode=${parsed.descriptorMode} effectiveMode=${effectiveDescriptorMode} requestedOutputFormat=${
        parsed.request.outputFormat ?? "null"
      } resolvedOutputFormat=${normalizedRequest.outputFormat ?? "null"} targetSlideCount=${
        parsed.request.targetSlideCount ?? "null"
      } visualDensity=${parsed.request.visualDensity ?? "null"} imagePolicy=${
        parsed.request.imagePolicy ?? "null"
      } visualStyle=${parsed.request.visualStyle ?? "null"} hasOutline=${
        parsed.request.outline === undefined || parsed.request.outline === null ? "false" : "true"
      } sourceAttachmentCount=${sourceAttachments.length}`
    );
    const enqueueRequest = {
      ...normalizedRequest,
      outputFormat: effectiveOutputFormat
    };
    const reviseStoragePath = this.normalizeReviseStoragePath(parsed.request.storagePath ?? null);
    try {
      const enqueueOutcome = await this.persaiInternalApiClientService.enqueueDeferredDocumentJob({
        assistantId: params.bundle.metadata.assistantId,
        sourceUserMessageId: params.deferToAsyncDocumentJob.sourceUserMessageId,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        attachments: sourceAttachments,
        directToolExecution: {
          toolCode: "document",
          descriptorMode: effectiveDescriptorMode,
          ...(reviseStoragePath !== null ? { path: reviseStoragePath } : {}),
          request: enqueueRequest
        }
      });
      if (!enqueueOutcome.accepted) {
        return {
          payload: {
            toolCode: "document",
            executionMode: "worker",
            descriptorMode: effectiveDescriptorMode,
            documentType,
            provider,
            prompt: normalizedRequest.prompt,
            outputFormat: effectiveOutputFormat,
            docId: normalizedRequest.docId ?? null,
            requestedName: normalizedRequest.requestedName ?? null,
            artifacts: [],
            usage: null,
            action: "skipped",
            reason: enqueueOutcome.code,
            warning: enqueueOutcome.message,
            ...(enqueueOutcome.guidance === null ? {} : { guidance: enqueueOutcome.guidance }),
            jobId: null
          },
          artifacts: [],
          isError: false
        };
      }
      return {
        payload: {
          toolCode: "document",
          executionMode: "worker",
          descriptorMode: effectiveDescriptorMode,
          documentType: enqueueOutcome.documentType,
          provider,
          prompt: normalizedRequest.prompt,
          outputFormat: effectiveOutputFormat,
          docId: enqueueOutcome.docId,
          requestedName: normalizedRequest.requestedName ?? null,
          artifacts: [],
          usage: null,
          action: "pending_delivery",
          reason: null,
          warning: null,
          guidance:
            "The document render job is accepted but not delivered yet. Do not send or claim the final file until backend delivery completes.",
          jobId: enqueueOutcome.jobId,
          versionId: enqueueOutcome.versionId,
          canSendFileNow: false,
          messageToUser: this.buildPendingDeliveryMessage(effectiveDescriptorMode)
        },
        artifacts: [],
        isError: false
      };
    } catch (error) {
      return {
        payload: {
          toolCode: "document",
          executionMode: "worker",
          descriptorMode: effectiveDescriptorMode,
          documentType,
          provider,
          prompt: normalizedRequest.prompt,
          outputFormat: effectiveOutputFormat,
          docId: normalizedRequest.docId ?? null,
          requestedName: normalizedRequest.requestedName ?? null,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "runtime_degraded",
          warning:
            error instanceof Error
              ? error.message
              : "Deferred document generation could not be enqueued.",
          jobId: null
        },
        artifacts: [],
        isError: false
      };
    }
  }

  private async executeExtractToolCall(params: {
    bundle: AssistantRuntimeBundle;
    request: {
      path: string;
      mode: "auto" | "text" | "ocr" | "layout";
      outputDir: string | null;
    };
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const normalizedPath = this.normalizeWorkspacePath(params.request.path);
    if (normalizedPath === null) {
      return this.extractSkipped(
        "invalid_arguments",
        "document.path must be a valid /workspace/... path."
      );
    }
    const normalizedOutputDir =
      params.request.outputDir === null
        ? null
        : this.normalizeWorkspacePath(params.request.outputDir, { allowDirectory: true });
    if (params.request.outputDir !== null && normalizedOutputDir === null) {
      return this.extractSkipped(
        "invalid_arguments",
        "document.outputDir must be a valid /workspace/... path."
      );
    }
    try {
      const outcome = await this.persaiInternalApiClientService.extractDocumentToWorkspace({
        assistantId: params.bundle.metadata.assistantId,
        workspaceId: params.bundle.metadata.workspaceId,
        path: normalizedPath,
        mode: params.request.mode,
        outputDir: normalizedOutputDir
      });
      if (!outcome.accepted) {
        return this.extractSkipped(outcome.code, outcome.message);
      }
      return {
        payload: {
          toolCode: "document",
          executionMode: "inline",
          requestedAction: "extract",
          descriptorMode: null,
          documentType: null,
          provider: null,
          prompt: null,
          outputFormat: null,
          docId: null,
          requestedName: null,
          artifacts: [],
          usage: null,
          action: "extracted",
          reason: null,
          warning: null,
          extraction: {
            sourcePath: outcome.sourcePath,
            outputDir: outcome.outputDir,
            manifestPath: outcome.manifestPath,
            outputPaths: outcome.outputPaths,
            suggestedReadPaths: outcome.suggestedReadPaths,
            counts: outcome.counts,
            provider: outcome.provider,
            quality: outcome.quality,
            warnings: outcome.warnings
          }
        },
        artifacts: [],
        isError: false
      };
    } catch (error) {
      return this.extractSkipped(
        "runtime_degraded",
        error instanceof Error ? error.message : "Document extraction is temporarily unavailable."
      );
    }
  }

  private extractSkipped(reason: string, warning: string): RuntimeDocumentToolExecutionResult {
    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "extract",
        descriptorMode: null,
        documentType: null,
        provider: null,
        prompt: null,
        outputFormat: null,
        docId: null,
        requestedName: null,
        artifacts: [],
        usage: null,
        action: "skipped",
        reason,
        warning
      },
      artifacts: [],
      isError: reason === "invalid_arguments"
    };
  }

  private async executeInspectToolCall(params: {
    bundle: AssistantRuntimeBundle;
    request: {
      path: string;
      depth: "quick" | "standard" | "deep";
      outputPath: string | null;
    };
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const normalizedPath = this.normalizeWorkspacePath(params.request.path);
    if (normalizedPath === null) {
      return this.inspectSkipped(
        "invalid_arguments",
        "document.path must be a valid /workspace/... path."
      );
    }
    const normalizedOutputPath =
      params.request.outputPath === null
        ? null
        : this.normalizeWorkspacePath(params.request.outputPath);
    if (params.request.outputPath !== null && normalizedOutputPath === null) {
      return this.inspectSkipped(
        "invalid_arguments",
        "document.outputPath must be a valid /workspace/... path."
      );
    }
    try {
      const outcome = await this.persaiInternalApiClientService.inspectDocumentInWorkspace({
        assistantId: params.bundle.metadata.assistantId,
        workspaceId: params.bundle.metadata.workspaceId,
        path: normalizedPath,
        depth: params.request.depth,
        outputPath: normalizedOutputPath
      });
      if (!outcome.accepted) {
        return this.inspectSkipped(outcome.code, outcome.message);
      }
      return {
        payload: {
          toolCode: "document",
          executionMode: "inline",
          requestedAction: "inspect",
          descriptorMode: null,
          documentType:
            outcome.format === "pdf"
              ? "pdf_document"
              : outcome.format === "docx" || outcome.format === "xlsx"
                ? "data_document"
                : null,
          provider: null,
          prompt: null,
          outputFormat: outcome.format,
          docId: null,
          requestedName: null,
          artifacts: [],
          usage: null,
          action: "inspected",
          reason: null,
          warning: null,
          inspection: {
            sourcePath: outcome.sourcePath,
            inspectPath: outcome.inspectPath,
            format: outcome.format,
            counts: outcome.counts,
            warnings: outcome.warnings,
            suggestedReadPaths: outcome.suggestedReadPaths
          }
        },
        artifacts: [],
        isError: false
      };
    } catch (error) {
      return this.inspectSkipped(
        "runtime_degraded",
        error instanceof Error ? error.message : "Document inspection is temporarily unavailable."
      );
    }
  }

  private inspectSkipped(reason: string, warning: string): RuntimeDocumentToolExecutionResult {
    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "inspect",
        descriptorMode: null,
        documentType: null,
        provider: null,
        prompt: null,
        outputFormat: null,
        docId: null,
        requestedName: null,
        artifacts: [],
        usage: null,
        action: "skipped",
        reason,
        warning
      },
      artifacts: [],
      isError: reason === "invalid_arguments"
    };
  }

  private async executeRenderToolCall(params: {
    bundle: AssistantRuntimeBundle;
    request: {
      projectPath: string;
      outputPath: string;
      format: "pdf" | "xlsx" | "docx";
      entrypoint: string | null;
    };
    sessionId: string | null;
    requestId: string | null;
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const projectPath = this.normalizeWorkspacePath(params.request.projectPath, {
      allowDirectory: true
    });
    if (projectPath === null) {
      return this.renderSkipped(
        params.request.format,
        "invalid_arguments",
        "document.projectPath must be a valid /workspace/... directory."
      );
    }
    const outputPath = this.normalizeWorkspacePath(params.request.outputPath);
    if (outputPath === null) {
      return this.renderSkipped(
        params.request.format,
        "invalid_arguments",
        "document.outputPath must be a valid /workspace/... file path."
      );
    }
    if (!this.outputPathMatchesFormat(outputPath, params.request.format)) {
      return this.renderSkipped(
        params.request.format,
        "invalid_arguments",
        "document.outputPath extension must match document.format."
      );
    }
    if (params.sessionId === null || params.requestId === null) {
      return this.renderSkipped(
        params.request.format,
        "runtime_degraded",
        "Document render requires an active runtime session."
      );
    }
    if (this.sandboxClientService?.isConfigured() !== true) {
      return this.renderSkipped(
        params.request.format,
        "sandbox_unconfigured",
        "Sandbox service is not configured."
      );
    }

    let entrypointPath: string;
    try {
      const resolvedEntrypoint = await this.resolveRenderEntrypoint({
        bundle: params.bundle,
        projectPath,
        format: params.request.format,
        entrypoint: params.request.entrypoint
      });
      if (resolvedEntrypoint === null) {
        return this.renderSkipped(
          params.request.format,
          "unsupported_render_source",
          "Could not resolve a visible HTML or build.py entrypoint for document.render."
        );
      }
      entrypointPath = resolvedEntrypoint;
      if (entrypointPath === outputPath) {
        return this.renderSkipped(
          params.request.format,
          "invalid_arguments",
          "document.outputPath must not overwrite the render entrypoint."
        );
      }
    } catch (error) {
      return this.renderSkipped(
        params.request.format,
        "runtime_degraded",
        error instanceof Error ? error.message : "Failed to resolve document.render entrypoint."
      );
    }

    let job: RuntimeSandboxJobResult;
    try {
      const programSource = await this.buildRenderProgramSource({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        projectPath,
        outputPath,
        entrypointPath,
        format: params.request.format
      });
      job = await this.runDocumentCodeSandboxJob({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath,
        programSource
      });
    } catch (error) {
      return this.renderSkipped(
        params.request.format,
        "sandbox_render_failed",
        error instanceof Error ? error.message : "Document render failed."
      );
    }

    if (job.status !== "completed" || job.exitCode !== 0) {
      return this.renderSkipped(
        params.request.format,
        job.reason ?? "sandbox_render_failed",
        job.warning ?? job.violationMessage ?? job.stderr ?? "Document render failed."
      );
    }

    try {
      const persisted = await this.persistRenderedWorkspaceFile({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath
      });
      return {
        payload: {
          toolCode: "document",
          executionMode: "inline",
          requestedAction: "render",
          descriptorMode: null,
          documentType: params.request.format === "pdf" ? "pdf_document" : "data_document",
          provider: "sandbox",
          prompt: null,
          outputFormat: params.request.format,
          docId: null,
          requestedName: this.basename(outputPath),
          artifacts: [],
          usage: null,
          action: "rendered",
          reason: null,
          warning: null,
          render: {
            projectPath,
            outputPath,
            format: params.request.format,
            entrypointPath,
            sizeBytes: persisted.sizeBytes,
            mimeType: persisted.mimeType
          }
        },
        artifacts: [],
        isError: false
      };
    } catch (error) {
      return this.renderSkipped(
        params.request.format,
        "render_persist_failed",
        error instanceof Error
          ? error.message
          : "Rendered output could not be persisted to the canonical workspace."
      );
    }
  }

  private renderSkipped(
    format: "pdf" | "xlsx" | "docx",
    reason: string,
    warning: string
  ): RuntimeDocumentToolExecutionResult {
    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "render",
        descriptorMode: null,
        documentType: format === "pdf" ? "pdf_document" : "data_document",
        provider: "sandbox",
        prompt: null,
        outputFormat: format,
        docId: null,
        requestedName: null,
        artifacts: [],
        usage: null,
        action: "skipped",
        reason,
        warning
      },
      artifacts: [],
      isError: reason === "invalid_arguments"
    };
  }

  private buildPendingDeliveryMessage(
    descriptorMode:
      | "create_pdf_document"
      | "create_presentation"
      | "revise_document"
      | "export_or_redeliver"
      | "create_data_document"
  ): string {
    switch (descriptorMode) {
      case "create_presentation":
        return "Request accepted. I am preparing the presentation and will send it separately when it is ready.";
      case "revise_document":
        return "Request accepted. I am revising the document and will send the updated version separately when it is ready.";
      case "create_data_document":
        return "Request accepted. I am generating the data document and will send it separately when it is ready.";
      case "export_or_redeliver":
      case "create_pdf_document":
      default:
        return "Request accepted. I am preparing the document and will send it separately when it is ready.";
    }
  }

  private readDocumentArguments(value: unknown):
    | {
        kind: "extract";
        request: {
          path: string;
          mode: "auto" | "text" | "ocr" | "layout";
          outputDir: string | null;
        };
      }
    | {
        kind: "inspect";
        request: {
          path: string;
          depth: "quick" | "standard" | "deep";
          outputPath: string | null;
        };
      }
    | {
        kind: "render";
        request: {
          projectPath: string;
          outputPath: string;
          format: "pdf" | "xlsx" | "docx";
          entrypoint: string | null;
        };
      }
    | {
        kind: "legacy";
        descriptorMode:
          | "create_pdf_document"
          | "create_presentation"
          | "revise_document"
          | "export_or_redeliver"
          | "create_data_document";
        request: {
          prompt: string;
          instructions?: string | null;
          outputFormat?: "pdf" | "pptx" | "xlsx" | "docx" | null;
          docId?: string | null;
          /** ADR-126 v3 — workspace storage path for cross-chat revise. */
          storagePath?: string | null;
          requestedName?: string | null;
          visualStyle?: PersaiRuntimePresentationVisualStyle | null;
          imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
          visualDensity?: PersaiRuntimePresentationVisualDensity | null;
          targetSlideCount?: number | null;
          outline?: unknown;
          metadata?: Record<string, unknown> | null;
        };
      }
    | Error {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return new Error("document arguments must be an object.");
    }
    const row = value as Record<string, unknown>;
    if (row.action === "extract") {
      const path = this.readNonEmptyString(row.path);
      if (path === null) {
        return new Error("document.path must be a non-empty string.");
      }
      return {
        kind: "extract",
        request: {
          path,
          mode:
            row.mode === "text" || row.mode === "ocr" || row.mode === "layout" ? row.mode : "auto",
          outputDir: this.readNonEmptyString(row.outputDir)
        }
      };
    }
    if (row.action === "inspect") {
      const path = this.readNonEmptyString(row.path);
      if (path === null) {
        return new Error("document.path must be a non-empty string.");
      }
      return {
        kind: "inspect",
        request: {
          path,
          depth:
            row.depth === "quick" || row.depth === "deep"
              ? row.depth
              : row.depth === "standard"
                ? "standard"
                : "standard",
          outputPath: this.readNonEmptyString(row.outputPath)
        }
      };
    }
    if (row.action === "render") {
      const projectPath = this.readNonEmptyString(row.projectPath);
      if (projectPath === null) {
        return new Error("document.projectPath must be a non-empty string.");
      }
      const outputPath = this.readNonEmptyString(row.outputPath);
      if (outputPath === null) {
        return new Error("document.outputPath must be a non-empty string.");
      }
      const format = row.format;
      if (format !== "pdf" && format !== "xlsx" && format !== "docx") {
        return new Error("document.format must be pdf, xlsx, or docx.");
      }
      return {
        kind: "render",
        request: {
          projectPath,
          outputPath,
          format,
          entrypoint: this.readNonEmptyString(row.entrypoint)
        }
      };
    }
    const descriptorMode = row.descriptorMode;
    if (
      descriptorMode !== "create_pdf_document" &&
      descriptorMode !== "create_presentation" &&
      descriptorMode !== "revise_document" &&
      descriptorMode !== "export_or_redeliver" &&
      descriptorMode !== "create_data_document"
    ) {
      return new Error(
        "document.descriptorMode must be create_pdf_document, create_presentation, revise_document, export_or_redeliver, or create_data_document."
      );
    }
    if (typeof row.prompt !== "string" || row.prompt.trim().length === 0) {
      return new Error("document.prompt must be a non-empty string.");
    }
    const metadata =
      row.metadata === undefined || row.metadata === null
        ? null
        : typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;
    if (row.metadata !== undefined && row.metadata !== null && metadata === null) {
      return new Error("document.metadata must be an object when provided.");
    }
    const outputFormat =
      row.outputFormat === "pdf" ||
      row.outputFormat === "pptx" ||
      row.outputFormat === "xlsx" ||
      row.outputFormat === "docx"
        ? row.outputFormat
        : null;
    return {
      kind: "legacy",
      descriptorMode,
      request: {
        prompt: row.prompt.trim(),
        instructions: typeof row.instructions === "string" ? row.instructions : null,
        outputFormat,
        docId: typeof row.docId === "string" ? row.docId : null,
        storagePath: typeof row.storagePath === "string" ? row.storagePath : null,
        requestedName: typeof row.requestedName === "string" ? row.requestedName : null,
        visualStyle:
          row.visualStyle === "professional_modern" ||
          row.visualStyle === "bold_editorial" ||
          row.visualStyle === "minimal_clean" ||
          row.visualStyle === "illustrated_storytelling"
            ? row.visualStyle
            : null,
        imagePolicy:
          row.imagePolicy === "ai_generated" ||
          row.imagePolicy === "web_free_to_use" ||
          row.imagePolicy === "pictographic" ||
          row.imagePolicy === "text_only"
            ? row.imagePolicy
            : null,
        visualDensity:
          row.visualDensity === "balanced" ||
          row.visualDensity === "visual_heavy" ||
          row.visualDensity === "text_heavy"
            ? row.visualDensity
            : null,
        targetSlideCount: this.readTargetSlideCount(row.targetSlideCount),
        outline: row.outline,
        metadata
      }
    };
  }

  private readTargetSlideCount(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    const rounded = Math.round(value);
    if (rounded < 1) {
      return null;
    }
    return Math.min(rounded, 30);
  }

  private readNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private normalizeDocId(docId: string | null): string | null {
    if (docId === null) {
      return null;
    }
    const trimmed = docId.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (UUID_REGEX.test(trimmed)) {
      return trimmed;
    }
    this.logger.warn(
      `[document-tool] docId-not-uuid — model passed a non-UUID docId value: "${docId}"`
    );
    return null;
  }

  private selectSourceAttachmentsForRequest(input: {
    attachments: RuntimeAttachmentRef[];
    currentAttachments: RuntimeAttachmentRef[];
    descriptorMode:
      | "create_pdf_document"
      | "create_presentation"
      | "revise_document"
      | "export_or_redeliver"
      | "create_data_document";
    prompt: string;
    sourceUserMessageText: string;
  }): RuntimeAttachmentRef[] {
    const currentAttachments = input.currentAttachments.filter((attachment) =>
      this.isDocumentSourceAttachmentMime(attachment.mimeType)
    );
    if (currentAttachments.length > 0) {
      return currentAttachments;
    }
    if (
      (input.descriptorMode === "create_pdf_document" ||
        input.descriptorMode === "create_presentation" ||
        input.descriptorMode === "create_data_document") &&
      this.referencesPriorSourceAttachment(input.prompt, input.sourceUserMessageText)
    ) {
      return input.attachments;
    }
    return [];
  }

  private isDocumentSourceAttachmentMime(mimeType: string): boolean {
    const normalized = mimeType.trim().toLowerCase();
    return (
      normalized.startsWith("text/") ||
      normalized === "application/pdf" ||
      normalized === "application/x-pdf" ||
      normalized === "application/json" ||
      normalized === "application/x-ndjson" ||
      normalized === "application/xml" ||
      normalized === "application/x-yaml" ||
      normalized === "application/yaml" ||
      normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  }

  private resolveEffectiveDescriptorMode(input: {
    descriptorMode:
      | "create_pdf_document"
      | "create_presentation"
      | "revise_document"
      | "export_or_redeliver"
      | "create_data_document";
    outputFormat: "pdf" | "pptx" | "xlsx" | "docx" | null;
    docId: string | null;
    /** ADR-126 v3 — treat a valid workspace storage path as a confirmed revise intent. */
    storagePath?: string | null;
    sourceAttachmentCount: number;
  }):
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver"
    | "create_data_document" {
    if (input.descriptorMode !== "revise_document") {
      return input.descriptorMode;
    }
    // Valid docId OR storagePath present → proceed as revise_document regardless.
    if (input.docId !== null && UUID_REGEX.test(input.docId.trim())) {
      return input.descriptorMode;
    }
    const normalizedPath = this.normalizeReviseStoragePath(input.storagePath ?? null);
    if (normalizedPath !== null) {
      return input.descriptorMode;
    }
    if (input.storagePath !== null && input.storagePath !== undefined) {
      this.logger.warn(
        `[document-tool] storagePath-invalid — model passed a non-canonical storagePath value: "${input.storagePath}"`
      );
    }
    // ADR-097 Slice 2: for PDF revise without a valid docId, do NOT silently
    // convert to create_pdf_document. The API layer will resolve the latest
    // PDF document in the chat via latestRevisionContextForChat, and return
    // an honest error if none is found. Return revise_document as-is.
    if (input.outputFormat !== "pptx") {
      return input.descriptorMode;
    }
    // Presentation revise without a valid docId: keep the existing Gamma behaviour
    // (untouched in Slice 2) — fall through to create_presentation when there
    // are source attachments but no valid document UUID.
    if (input.sourceAttachmentCount > 0) {
      return "create_presentation";
    }
    return input.descriptorMode;
  }

  private normalizePresentationRequest(input: {
    descriptorMode:
      | "create_pdf_document"
      | "create_presentation"
      | "revise_document"
      | "export_or_redeliver"
      | "create_data_document";
    request: {
      prompt: string;
      instructions?: string | null;
      outputFormat?: "pdf" | "pptx" | "xlsx" | "docx" | null;
      docId?: string | null;
      storagePath?: string | null;
      requestedName?: string | null;
      visualStyle?: PersaiRuntimePresentationVisualStyle | null;
      imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
      visualDensity?: PersaiRuntimePresentationVisualDensity | null;
      targetSlideCount?: number | null;
      outline?: unknown;
      metadata?: Record<string, unknown> | null;
    };
  }): {
    prompt: string;
    instructions?: string | null;
    outputFormat?: "pdf" | "pptx" | "xlsx" | "docx" | null;
    docId?: string | null;
    storagePath?: string | null;
    requestedName?: string | null;
    visualStyle?: PersaiRuntimePresentationVisualStyle | null;
    imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
    visualDensity?: PersaiRuntimePresentationVisualDensity | null;
    targetSlideCount?: number | null;
    outline?: unknown;
    metadata?: Record<string, unknown> | null;
  } {
    // Chat-delivered presentations are PDF-only by system contract. Editable
    // PPTX is a separate explicit user-requested render, so the in-chat
    // artifact never needs to be PPTX. We deliberately ignore
    // outputFormat="pptx" coming from the model here — chat delivery is a
    // system-owned UX decision and not a model-controlled parameter.
    if (input.descriptorMode !== "create_presentation") {
      return input.request;
    }
    return {
      ...input.request,
      outputFormat: "pdf"
    };
  }

  private normalizeReviseStoragePath(value: string | null): string | null {
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (!trimmed.startsWith("/workspace/")) {
      return null;
    }
    return trimmed;
  }

  private normalizeWorkspacePath(
    value: string,
    options?: { allowDirectory?: boolean }
  ): string | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith("/workspace/")) {
      return null;
    }
    if (trimmed.includes("..")) {
      return null;
    }
    if (
      trimmed === "/workspace/input" ||
      trimmed.startsWith("/workspace/input/") ||
      trimmed === "/workspace/outbound" ||
      trimmed.startsWith("/workspace/outbound/")
    ) {
      return null;
    }
    if (options?.allowDirectory === true) {
      const normalized = trimmed.replace(/\/+$/g, "");
      return normalized.length > 0 ? normalized : null;
    }
    return trimmed;
  }

  private async resolveRenderEntrypoint(input: {
    bundle: AssistantRuntimeBundle;
    projectPath: string;
    format: "pdf" | "xlsx" | "docx";
    entrypoint: string | null;
  }): Promise<string | null> {
    if (input.entrypoint !== null) {
      if (input.entrypoint.startsWith("/workspace/")) {
        return this.normalizeWorkspacePath(input.entrypoint);
      }
      return this.normalizeWorkspacePath(
        `${input.projectPath}/${input.entrypoint.replace(/^\.?\//, "")}`
      );
    }
    if (input.format !== "pdf") {
      return `${input.projectPath}/build.py`;
    }
    const files = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
      workspaceId: input.bundle.metadata.workspaceId,
      pathPrefix: `${input.projectPath}/`,
      assistantHandle: input.bundle.metadata.assistantHandle
    });
    const filePaths = files.items.filter((item) => item.type === "file").map((item) => item.path);
    for (const preferred of [
      `${input.projectPath}/index.html`,
      `${input.projectPath}/report.html`
    ]) {
      if (filePaths.includes(preferred)) {
        return preferred;
      }
    }
    const htmlCandidates = filePaths.filter(
      (path) => path.toLowerCase().endsWith(".html") || path.toLowerCase().endsWith(".htm")
    );
    if (htmlCandidates.length === 1) {
      return htmlCandidates[0] ?? null;
    }
    const buildScript = `${input.projectPath}/build.py`;
    if (filePaths.includes(buildScript)) {
      return buildScript;
    }
    return null;
  }

  private async buildRenderProgramSource(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    projectPath: string;
    outputPath: string;
    entrypointPath: string;
    format: "pdf" | "xlsx" | "docx";
  }): Promise<string> {
    const loweredEntrypoint = input.entrypointPath.toLowerCase();
    if (loweredEntrypoint.endsWith(".html") || loweredEntrypoint.endsWith(".htm")) {
      return [
        "import os",
        "from weasyprint import HTML",
        `project_dir = ${JSON.stringify(input.projectPath)}`,
        `entrypoint_path = ${JSON.stringify(input.entrypointPath)}`,
        `output_path = ${JSON.stringify(input.outputPath)}`,
        "os.makedirs(os.path.dirname(output_path), exist_ok=True)",
        "HTML(filename=entrypoint_path, base_url=project_dir).write_pdf(output_path)",
        "if not os.path.isfile(output_path):",
        '    raise FileNotFoundError(f"Rendered output was not created: {output_path}")'
      ].join("\n");
    }
    if (!loweredEntrypoint.endsWith(".py")) {
      throw new Error(
        "document.render currently supports HTML entrypoints for PDF and Python build.py entrypoints for workspace renders."
      );
    }
    const scriptSource = await this.readWorkspaceTextFile({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: input.requestId,
      path: input.entrypointPath
    });
    return [
      "import os",
      "import sys",
      `project_dir = ${JSON.stringify(input.projectPath)}`,
      `entrypoint_path = ${JSON.stringify(input.entrypointPath)}`,
      `output_path = ${JSON.stringify(input.outputPath)}`,
      `script_source = ${JSON.stringify(scriptSource)}`,
      "os.makedirs(os.path.dirname(output_path), exist_ok=True)",
      "sys.path.insert(0, project_dir)",
      "os.chdir(project_dir)",
      'globals_dict = {"__name__": "__main__", "__file__": entrypoint_path, "PERSAI_OUTPUT_PATH": output_path}',
      "exec(compile(script_source, entrypoint_path, 'exec'), globals_dict)",
      "if not os.path.isfile(output_path):",
      '    raise FileNotFoundError(f"Build script did not create the declared output path: {output_path}")'
    ].join("\n");
  }

  private async readWorkspaceTextFile(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    path: string;
  }): Promise<string> {
    const job = await this.sandboxClientService!.waitForCompletion({
      assistantId: input.bundle.metadata.assistantId,
      assistantHandle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceId: input.bundle.metadata.workspaceId,
      runtimeRequestId: input.requestId,
      runtimeSessionId: input.sessionId,
      toolCode: "files",
      policy: this.buildInlineDocumentSandboxPolicy(input.bundle.runtime.sandbox),
      args: {
        action: "read",
        path: input.path,
        maxBytes: 2 * 1024 * 1024
      }
    } satisfies RuntimeSandboxJobRequest);
    if (job.status !== "completed" || typeof job.reason === "string") {
      throw new Error(
        job.warning ??
          job.violationMessage ??
          job.reason ??
          `Could not read ${input.path} from the workspace.`
      );
    }
    const parsed = this.parseFilesReadContent(job.content);
    if (parsed.content === null) {
      throw new Error(`Workspace file ${input.path} did not return readable text content.`);
    }
    return parsed.content;
  }

  private async runDocumentCodeSandboxJob(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    outputPath: string;
    programSource: string;
  }): Promise<RuntimeSandboxJobResult> {
    return this.sandboxClientService!.waitForCompletion({
      assistantId: input.bundle.metadata.assistantId,
      assistantHandle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceId: input.bundle.metadata.workspaceId,
      runtimeRequestId: input.requestId,
      runtimeSessionId: input.sessionId,
      toolCode: "execute_document_code",
      policy: this.buildRenderSandboxPolicy(input.bundle.runtime.sandbox),
      args: {
        programSource: input.programSource,
        outputFileName: this.toWorkspaceRelativePath(input.outputPath),
        sourceMounts: [],
        textSidecars: [],
        inputPaths: []
      }
    } satisfies RuntimeSandboxJobRequest);
  }

  private async persistRenderedWorkspaceFile(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    outputPath: string;
  }): Promise<{ mimeType: string; sizeBytes: number }> {
    const job = await this.sandboxClientService!.waitForCompletion({
      assistantId: input.bundle.metadata.assistantId,
      assistantHandle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceId: input.bundle.metadata.workspaceId,
      runtimeRequestId: `${input.requestId}:persist`,
      runtimeSessionId: input.sessionId,
      toolCode: "files",
      policy: this.buildInlineDocumentSandboxPolicy(input.bundle.runtime.sandbox),
      args: {
        action: "attach",
        path: input.outputPath
      }
    } satisfies RuntimeSandboxJobRequest);
    if (job.status !== "completed" || typeof job.reason === "string") {
      throw new Error(
        job.warning ??
          job.violationMessage ??
          job.reason ??
          `Could not persist ${input.outputPath} to the canonical workspace.`
      );
    }
    const attach = this.parseFilesAttachContent(job.content);
    if (attach === null) {
      throw new Error("Sandbox attach completed without a valid persistence payload.");
    }
    await this.persaiInternalApiClientService.upsertWorkspaceFileMetadata({
      workspaceId: input.bundle.metadata.workspaceId,
      path: input.outputPath,
      mimeType: attach.mimeType,
      sizeBytes: attach.sizeBytes
    });
    return {
      mimeType: attach.mimeType,
      sizeBytes: attach.sizeBytes
    };
  }

  private buildInlineDocumentSandboxPolicy(
    policy: RuntimeSandboxPolicy | null | undefined
  ): RuntimeSandboxPolicy {
    const basePolicy = policy ?? DEFAULT_RUNTIME_SANDBOX_POLICY;
    return {
      ...basePolicy,
      enabled: true
    };
  }

  private buildRenderSandboxPolicy(
    policy: RuntimeSandboxPolicy | null | undefined
  ): RuntimeSandboxPolicy {
    const basePolicy = this.buildInlineDocumentSandboxPolicy(policy);
    return {
      ...basePolicy,
      maxProcessRuntimeMs: Math.max(basePolicy.maxProcessRuntimeMs, 120_000),
      maxCpuMsPerJob: Math.max(basePolicy.maxCpuMsPerJob, 120_000),
      maxSingleFileWriteBytes: Math.max(basePolicy.maxSingleFileWriteBytes, 50 * 1024 * 1024),
      maxWorkspaceBytesPerJob: Math.max(basePolicy.maxWorkspaceBytesPerJob, 64 * 1024 * 1024)
    };
  }

  private parseFilesReadContent(content: string | null): {
    content: string | null;
    sizeBytes: number | null;
    truncated: boolean;
  } {
    const row = this.parseJsonObject(content);
    return {
      content: typeof row?.content === "string" ? row.content : null,
      sizeBytes: typeof row?.sizeBytes === "number" ? row.sizeBytes : null,
      truncated: row?.truncated === true
    };
  }

  private parseFilesAttachContent(content: string | null): {
    workspaceRelPath: string;
    sizeBytes: number;
    mimeType: string;
    displayName: string;
  } | null {
    const row = this.parseJsonObject(content);
    const attachment = row?.attachment;
    if (attachment === null || typeof attachment !== "object" || Array.isArray(attachment)) {
      return null;
    }
    const value = attachment as Record<string, unknown>;
    if (
      typeof value.workspaceRelPath !== "string" ||
      typeof value.sizeBytes !== "number" ||
      typeof value.mimeType !== "string" ||
      typeof value.displayName !== "string"
    ) {
      return null;
    }
    return {
      workspaceRelPath: value.workspaceRelPath,
      sizeBytes: value.sizeBytes,
      mimeType: value.mimeType,
      displayName: value.displayName
    };
  }

  private parseJsonObject(content: string | null): Record<string, unknown> | null {
    if (typeof content !== "string" || content.trim().length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(content) as unknown;
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private toWorkspaceRelativePath(path: string): string {
    return path.replace(/^\/workspace\//, "");
  }

  private outputPathMatchesFormat(path: string, format: "pdf" | "xlsx" | "docx"): boolean {
    return path.toLowerCase().endsWith(`.${format}`);
  }

  private basename(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] ?? normalized;
  }

  private referencesPriorSourceAttachment(prompt: string, sourceUserMessageText: string): boolean {
    const text = `${sourceUserMessageText}\n${prompt}`.toLowerCase();
    return (
      /\b(previous attachment|attached document|attached file|source file|my document|my file|from (?:the )?file|based on (?:the )?(?:attached|source|uploaded) (?:file|document))\b/i.test(
        text
      ) ||
      /предыдущ(?:ий|его|ем|ая|ую)\s+(?:файл|документ|attachment)|прикреп|прилож|вложен|загружен|файл|мо[йеегою]*\s+документ|мо[йеегою]*\s+файл|на\s+основе[^.\n]{0,80}документ|из\s+(?:этого\s+)?документ/i.test(
        text
      )
    );
  }
}
