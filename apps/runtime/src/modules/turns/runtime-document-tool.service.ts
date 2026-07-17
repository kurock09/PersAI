import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_SANDBOX_POLICY,
  buildAssistantSessionRoot,
  type PersaiRuntimePresentationImagePolicy,
  type PersaiRuntimePresentationVisualDensity,
  type PersaiRuntimePresentationVisualStyle,
  type ProviderGatewayToolCall,
  type RuntimeAttachmentRef,
  type RuntimeDocumentToolResult,
  type RuntimeOutputArtifact,
  type RuntimeSandboxJobRequest,
  type RuntimeSandboxJobResult,
  type RuntimeSandboxPolicy,
  isValidVisibleWorkspacePath
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { RuntimeStoragePlaneFilesService } from "./runtime-storage-plane-files.service";
import { SandboxClientService } from "./sandbox-client.service";
import {
  executeRuntimeToolContractDescribe,
  isToolContractDescribeCall
} from "./runtime-tool-contract-describe";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocumentRenderTemplateTheme = "default" | "report" | "minimal";
type DocumentRenderTemplatePageSize = "A4" | "Letter";
type NormalizedDocumentRenderTemplate = {
  title: string | null;
  theme: DocumentRenderTemplateTheme;
  css: string | null;
  pageSize: DocumentRenderTemplatePageSize;
  runningHeader: string | null;
  runningFooter: string | null;
};

type AuthoredRenderContentSource = {
  markdown: string;
  sourcePath: string | null;
  sourceDisplayName: string | null;
  markdownPath: string;
};

type AuthoredRenderArtifacts = {
  sourceMarkdownPath: string;
  programSource: string;
};

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
    private readonly storagePlaneFilesService: RuntimeStoragePlaneFilesService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly sandboxClientService?: SandboxClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId?: string;
    requestId?: string;
    conversation?:
      | {
          channel: "web" | "telegram";
          externalThreadKey: string;
        }
      | undefined;
    deferToAsyncDocumentJob: {
      sourceUserMessageId: string;
      sourceUserMessageText: string;
      sourceUserMessageCreatedAt?: string | null;
      currentAttachments: RuntimeAttachmentRef[];
      availableAttachments: RuntimeAttachmentRef[];
    };
    originChatId?: string | null;
  }): Promise<RuntimeDocumentToolExecutionResult> {
    if (isToolContractDescribeCall(params.toolCall.arguments)) {
      return executeRuntimeToolContractDescribe({
        bundle: params.bundle,
        toolCode: "document"
      }) as unknown as RuntimeDocumentToolExecutionResult;
    }

    const parsed = this.readDocumentArguments(params.toolCall.arguments);
    if (parsed instanceof Error) {
      return this.buildInvalidDocumentArgumentsResult(parsed.message);
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
        requestId: params.requestId ?? null,
        originChatId: params.originChatId ?? null,
        conversation: params.conversation ?? null,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        sourceUserMessageCreatedAt:
          params.deferToAsyncDocumentJob.sourceUserMessageCreatedAt ?? new Date(0).toISOString()
      });
    }

    if (parsed.kind === "convert") {
      return this.executeConvertToolCall({
        bundle: params.bundle,
        sessionId: params.sessionId ?? null,
        requestId: params.requestId ?? null,
        originChatId: params.originChatId ?? null,
        conversation: params.conversation ?? null,
        request: parsed.request,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        sourceUserMessageCreatedAt:
          params.deferToAsyncDocumentJob.sourceUserMessageCreatedAt ?? new Date(0).toISOString()
      });
    }

    return this.buildInvalidDocumentArgumentsResult(
      'document.action must be "inspect", "render", or "convert".'
    );
  }

  async executePresentationToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    deferToAsyncDocumentJob: {
      sourceUserMessageId: string;
      sourceUserMessageText: string;
      sourceUserMessageCreatedAt?: string | null;
      currentAttachments: RuntimeAttachmentRef[];
      availableAttachments: RuntimeAttachmentRef[];
    };
  }): Promise<RuntimeDocumentToolExecutionResult> {
    if (isToolContractDescribeCall(params.toolCall.arguments)) {
      return executeRuntimeToolContractDescribe({
        bundle: params.bundle,
        toolCode: "presentation"
      }) as unknown as RuntimeDocumentToolExecutionResult;
    }

    const parsed = this.readPresentationArguments(params.toolCall.arguments);
    if (parsed instanceof Error) {
      return {
        payload: {
          toolCode: "document",
          executionMode: "worker",
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

    return this.enqueuePresentationDescriptorToolCall({
      bundle: params.bundle,
      descriptorMode: parsed.descriptorMode,
      request: parsed.request,
      sourceUserMessageId: params.deferToAsyncDocumentJob.sourceUserMessageId,
      sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
      runtimeSessionId: params.sessionId,
      currentAttachments: params.deferToAsyncDocumentJob.currentAttachments,
      availableAttachments: params.deferToAsyncDocumentJob.availableAttachments
    });
  }

  private buildInvalidDocumentArgumentsResult(message: string): RuntimeDocumentToolExecutionResult {
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
        warning: message,
        jobId: null
      },
      artifacts: [],
      isError: true
    };
  }

  private async enqueuePresentationDescriptorToolCall(params: {
    bundle: AssistantRuntimeBundle;
    descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
    request: {
      prompt: string;
      instructions?: string | null;
      outputFormat?: "pdf" | "pptx" | null;
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
    sourceUserMessageId: string;
    sourceUserMessageText: string;
    runtimeSessionId: string;
    currentAttachments: RuntimeAttachmentRef[];
    availableAttachments: RuntimeAttachmentRef[];
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const sourceAttachments = this.selectPresentationSourceAttachments({
      currentAttachments: params.currentAttachments,
      availableAttachments: params.availableAttachments,
      prompt: params.request.prompt,
      sourceUserMessageText: params.sourceUserMessageText
    });
    const normalizedRequest = this.normalizePresentationRequest({
      descriptorMode: params.descriptorMode,
      request: {
        ...params.request,
        docId: this.normalizeUuid(params.request.docId ?? null)
      }
    });
    try {
      const enqueueOutcome = await this.persaiInternalApiClientService.enqueueDeferredDocumentJob({
        assistantId: params.bundle.metadata.assistantId,
        sourceUserMessageId: params.sourceUserMessageId,
        sourceUserMessageText: params.sourceUserMessageText,
        runtimeSessionId: params.runtimeSessionId,
        attachments: sourceAttachments,
        directToolExecution: {
          toolCode: "document",
          descriptorMode: params.descriptorMode,
          request: normalizedRequest
        }
      });
      if (!enqueueOutcome.accepted) {
        return {
          payload: {
            toolCode: "document",
            executionMode: "worker",
            descriptorMode: params.descriptorMode,
            documentType: "presentation",
            provider: "gamma",
            prompt: normalizedRequest.prompt,
            outputFormat: normalizedRequest.outputFormat ?? null,
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
          descriptorMode: params.descriptorMode,
          documentType: "presentation",
          provider: "gamma",
          prompt: normalizedRequest.prompt,
          outputFormat: normalizedRequest.outputFormat ?? null,
          docId: enqueueOutcome.docId,
          requestedName: normalizedRequest.requestedName ?? null,
          artifacts: [],
          usage: null,
          action: "pending_delivery",
          reason: null,
          warning: null,
          guidance:
            "The presentation job is accepted but not delivered yet. Do not send or claim the final file until backend delivery completes.",
          jobId: enqueueOutcome.jobId,
          versionId: enqueueOutcome.versionId,
          canSendFileNow: false,
          messageToUser:
            "Request accepted. I am preparing the presentation and will send it separately when it is ready."
        },
        artifacts: [],
        isError: false
      };
    } catch (error) {
      return {
        payload: {
          toolCode: "document",
          executionMode: "worker",
          descriptorMode: params.descriptorMode,
          documentType: "presentation",
          provider: "gamma",
          prompt: normalizedRequest.prompt,
          outputFormat: normalizedRequest.outputFormat ?? null,
          docId: normalizedRequest.docId ?? null,
          requestedName: normalizedRequest.requestedName ?? null,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "runtime_degraded",
          warning:
            error instanceof Error
              ? error.message
              : "Deferred presentation generation could not be enqueued.",
          jobId: null
        },
        artifacts: [],
        isError: false
      };
    }
  }

  private async executeInspectToolCall(params: {
    bundle: AssistantRuntimeBundle;
    request: {
      path: string;
    };
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const normalizedPath = this.normalizeWorkspacePath(params.request.path);
    if (normalizedPath === null) {
      return this.inspectSkipped(
        "invalid_arguments",
        "document.path must be a valid /workspace/... path."
      );
    }
    try {
      const outcome = await this.persaiInternalApiClientService.inspectDocumentInWorkspace({
        assistantId: params.bundle.metadata.assistantId,
        workspaceId: params.bundle.metadata.workspaceId,
        path: normalizedPath,
        depth: "standard",
        outputPath: null
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
            outcome.format === "pdf" || outcome.format === "docx" || outcome.format === "xlsx"
              ? "workspace_document"
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
            editMethod: outcome.editMethod,
            siblingMarkdownPath: outcome.siblingMarkdownPath,
            extractedMdPath: outcome.extractedMdPath,
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
      format: "pdf" | "xlsx" | "docx";
      requestedName: string;
      content: string | null;
      contentPath: string | null;
      style: DocumentRenderTemplateTheme | null;
      templatePath: string | null;
    };
    sessionId: string | null;
    requestId: string | null;
    originChatId: string | null;
    conversation: {
      channel: "web" | "telegram";
      externalThreadKey: string;
    } | null;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  }): Promise<RuntimeDocumentToolExecutionResult> {
    if (params.sessionId === null || params.requestId === null) {
      return this.renderSkipped(
        params.request.format,
        "runtime_degraded",
        "Document render requires an active runtime session."
      );
    }
    const outputPath = this.resolveRequestedDocumentOutputPath({
      bundle: params.bundle,
      sessionId: params.sessionId,
      requestedName: params.request.requestedName,
      format: params.request.format
    });
    if (outputPath instanceof Error) {
      return this.renderSkipped(params.request.format, "invalid_arguments", outputPath.message);
    }
    const inPlaceGuard = await this.rejectInPlaceRenderOnUploadedBinaryWithoutSiblingMarkdown({
      bundle: params.bundle,
      outputPath
    });
    if (inPlaceGuard !== null) {
      return this.renderSkipped(params.request.format, "invalid_arguments", inPlaceGuard);
    }
    if (
      (params.request.content === null && (params.request.contentPath ?? null) === null) ||
      (params.request.content !== null && (params.request.contentPath ?? null) !== null)
    ) {
      return this.renderSkipped(
        params.request.format,
        "invalid_arguments",
        "document.render requires exactly one of document.content or document.contentPath."
      );
    }
    if (this.sandboxClientService?.isConfigured() !== true) {
      return this.renderSkipped(
        params.request.format,
        "sandbox_unconfigured",
        "Sandbox service is not configured."
      );
    }

    let authoredRenderArtifacts: AuthoredRenderArtifacts | null = null;
    try {
      authoredRenderArtifacts = await this.prepareAuthoredRenderArtifactsIfRequested({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        originChatId: params.originChatId,
        outputPath,
        format: params.request.format,
        content: params.request.content,
        contentPath: params.request.contentPath ?? null,
        style: params.request.style ?? null,
        templatePath: params.request.templatePath ?? null
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to build authored document render sources.";
      return this.renderSkipped(
        params.request.format,
        /document\.content|document\.contentPath|document\.template/i.test(message)
          ? "invalid_arguments"
          : "runtime_degraded",
        message
      );
    }

    let job: RuntimeSandboxJobResult;
    try {
      job = await this.runDocumentCodeSandboxJob({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath,
        programSource: authoredRenderArtifacts!.programSource
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

    let persisted: {
      sizeBytes: number;
      mimeType: string;
      resolvedPath: string;
      metadataWarning: string | null;
    };
    try {
      persisted = await this.persistRenderedWorkspaceFile({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath,
        replace: true,
        originChatId: params.originChatId,
        sourceUserMessageText: params.sourceUserMessageText,
        sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt,
        job
      });
    } catch (error) {
      return this.renderSkipped(
        params.request.format,
        "render_persist_failed",
        error instanceof Error
          ? error.message
          : "Rendered output could not be persisted to the canonical workspace."
      );
    }

    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "render",
        descriptorMode: null,
        documentType: "workspace_document",
        provider: "sandbox",
        prompt: null,
        outputFormat: params.request.format,
        docId: null,
        requestedName: this.basename(persisted.resolvedPath),
        artifacts: [],
        usage: null,
        action: "rendered",
        reason: null,
        warning: persisted.metadataWarning,
        render: {
          outputPath: persisted.resolvedPath,
          format: params.request.format,
          sourceMarkdownPath: authoredRenderArtifacts!.sourceMarkdownPath,
          sizeBytes: persisted.sizeBytes,
          mimeType: persisted.mimeType
        }
      },
      artifacts: [],
      isError: false
    };
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
        documentType: "workspace_document",
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

  private async executeConvertToolCall(params: {
    bundle: AssistantRuntimeBundle;
    request: {
      source: string;
      targetFormat: "pdf" | "xlsx" | "docx";
      requestedName: string | null;
    };
    sessionId: string | null;
    requestId: string | null;
    originChatId: string | null;
    conversation: {
      channel: "web" | "telegram";
      externalThreadKey: string;
    } | null;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const sourcePath = this.normalizeWorkspacePath(params.request.source);
    if (sourcePath === null) {
      return this.convertSkipped(
        "invalid_arguments",
        "document.source must be a valid /workspace/... file path."
      );
    }
    if (params.sessionId === null || params.requestId === null) {
      return this.convertSkipped(
        "runtime_degraded",
        "Document convert requires an active runtime session."
      );
    }
    if (this.sandboxClientService?.isConfigured() !== true) {
      return this.convertSkipped("sandbox_unconfigured", "Sandbox service is not configured.");
    }
    const sourceFormat = this.resolveDocumentFormatFromPath(sourcePath);
    if (sourceFormat === null) {
      return this.convertSkipped(
        "invalid_arguments",
        "document.convert source must be a PDF, DOCX, or XLSX file."
      );
    }
    const outputPath = this.resolveRequestedDocumentOutputPath({
      bundle: params.bundle,
      sessionId: params.sessionId,
      requestedName:
        params.request.requestedName ??
        `${this.stemOf(this.basename(sourcePath))}.${params.request.targetFormat}`,
      format: params.request.targetFormat
    });
    if (outputPath instanceof Error) {
      return this.convertSkipped("invalid_arguments", outputPath.message);
    }
    let job: RuntimeSandboxJobResult;
    try {
      job = await this.runDocumentCodeSandboxJob({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath,
        programSource: this.buildLibreOfficeConvertProgramSource({
          sourcePath,
          sourceFormat,
          targetFormat: params.request.targetFormat,
          outputPath
        })
      });
    } catch (error) {
      return this.convertSkipped(
        "sandbox_render_failed",
        error instanceof Error ? error.message : "Document convert failed."
      );
    }
    if (job.status !== "completed" || job.exitCode !== 0) {
      return this.convertSkipped(
        job.reason ?? "sandbox_render_failed",
        job.warning ?? job.violationMessage ?? job.stderr ?? "Document convert failed."
      );
    }

    let persisted: {
      mimeType: string;
      sizeBytes: number;
      resolvedPath: string;
      metadataWarning: string | null;
    };
    try {
      persisted = await this.persistRenderedWorkspaceFile({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath,
        replace: true,
        originChatId: params.originChatId,
        sourceUserMessageText: params.sourceUserMessageText,
        sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt,
        job
      });
    } catch (error) {
      return this.convertSkipped(
        "render_persist_failed",
        error instanceof Error
          ? error.message
          : "Converted output could not be persisted to the canonical workspace."
      );
    }

    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "convert",
        descriptorMode: null,
        documentType: "workspace_document",
        provider: "sandbox",
        prompt: null,
        outputFormat: params.request.targetFormat,
        docId: null,
        requestedName: this.basename(persisted.resolvedPath),
        artifacts: [],
        usage: null,
        action: "converted",
        reason: null,
        warning: persisted.metadataWarning,
        convert: {
          sourcePath,
          outputPath: persisted.resolvedPath,
          targetFormat: params.request.targetFormat,
          sizeBytes: persisted.sizeBytes,
          mimeType: persisted.mimeType
        }
      },
      artifacts: [],
      isError: false
    };
  }

  private convertSkipped(reason: string, warning: string): RuntimeDocumentToolExecutionResult {
    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "convert",
        descriptorMode: null,
        documentType: "workspace_document",
        provider: "sandbox",
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

  private readDocumentArguments(value: unknown):
    | {
        kind: "inspect";
        request: {
          path: string;
        };
      }
    | {
        kind: "render";
        request: {
          requestedName: string;
          format: "pdf" | "xlsx" | "docx";
          content: string | null;
          contentPath: string | null;
          style: DocumentRenderTemplateTheme | null;
          templatePath: string | null;
        };
      }
    | {
        kind: "convert";
        request: {
          source: string;
          targetFormat: "pdf" | "xlsx" | "docx";
          requestedName: string | null;
        };
      }
    | Error {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return new Error("document arguments must be an object.");
    }
    const row = value as Record<string, unknown>;
    if (row.action === "inspect") {
      const path = this.readNonEmptyString(row.path);
      if (path === null) {
        return new Error("document.path must be a non-empty string.");
      }
      return {
        kind: "inspect",
        request: { path }
      };
    }
    if (row.action === "render") {
      const requestedName = this.readNonEmptyString(row.requestedName);
      if (requestedName === null) {
        return new Error("document.requestedName must be a non-empty string.");
      }
      const format = row.format;
      if (format !== "pdf" && format !== "xlsx" && format !== "docx") {
        return new Error("document.format must be pdf, xlsx, or docx.");
      }
      try {
        return {
          kind: "render",
          request: {
            requestedName,
            format,
            content: this.readDocumentRenderContent(row.content),
            contentPath: this.readDocumentRenderContentPath(row.contentPath),
            style:
              row.style === "report" || row.style === "minimal" || row.style === "default"
                ? row.style
                : null,
            templatePath: this.readNonEmptyString(row.template)
          }
        };
      } catch (error) {
        return new Error(
          error instanceof Error ? error.message : "document.render arguments are invalid."
        );
      }
    }
    if (row.action === "convert") {
      const source = this.readNonEmptyString(row.source);
      if (source === null) {
        return new Error("document.source must be a non-empty string.");
      }
      if (
        row.targetFormat !== "pdf" &&
        row.targetFormat !== "xlsx" &&
        row.targetFormat !== "docx"
      ) {
        return new Error("document.targetFormat must be pdf, xlsx, or docx.");
      }
      return {
        kind: "convert",
        request: {
          source,
          targetFormat: row.targetFormat,
          requestedName: this.readNonEmptyString(row.requestedName)
        }
      };
    }
    if (
      row.descriptorMode === "create_presentation" ||
      row.descriptorMode === "revise_document" ||
      row.descriptorMode === "export_or_redeliver"
    ) {
      return new Error(
        "Presentation work belongs in the presentation tool, not document. Use presentation({descriptorMode, prompt}) for slide decks."
      );
    }
    if (typeof row.prompt === "string" && row.prompt.trim().length > 0) {
      return new Error(
        'document requires an explicit action such as "inspect", "render", or "convert". Slide decks belong in the presentation tool.'
      );
    }
    return new Error('document.action must be "inspect", "render", or "convert".');
  }

  private readPresentationArguments(value: unknown):
    | {
        descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
        request: {
          prompt: string;
          instructions?: string | null;
          outputFormat?: "pdf" | "pptx" | null;
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
      }
    | Error {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return new Error("presentation arguments must be an object.");
    }
    const row = value as Record<string, unknown>;
    const descriptorMode = row.descriptorMode;
    if (
      descriptorMode !== "create_presentation" &&
      descriptorMode !== "revise_document" &&
      descriptorMode !== "export_or_redeliver"
    ) {
      return new Error(
        "presentation.descriptorMode must be create_presentation, revise_document, or export_or_redeliver."
      );
    }
    if (typeof row.prompt !== "string" || row.prompt.trim().length === 0) {
      return new Error("presentation.prompt must be a non-empty string.");
    }
    const metadata =
      row.metadata === undefined || row.metadata === null
        ? null
        : typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null;
    if (row.metadata !== undefined && row.metadata !== null && metadata === null) {
      return new Error("presentation.metadata must be an object when provided.");
    }
    const outputFormat =
      row.outputFormat === "pdf" || row.outputFormat === "pptx" ? row.outputFormat : null;
    return {
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

  private readDocumentRenderContent(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("document.content must be a non-empty string when provided.");
    }
    return value.trim();
  }

  private readDocumentRenderContentPath(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("document.contentPath must be a non-empty string when provided.");
    }
    return value.trim();
  }

  private normalizeUuid(value: string | null): string | null {
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    return UUID_REGEX.test(trimmed) ? trimmed : null;
  }

  private selectPresentationSourceAttachments(input: {
    currentAttachments: RuntimeAttachmentRef[];
    availableAttachments: RuntimeAttachmentRef[];
    prompt: string;
    sourceUserMessageText: string;
  }): RuntimeAttachmentRef[] {
    const currentAttachments = input.currentAttachments.filter((attachment) =>
      this.isPresentationSourceAttachmentMime(attachment.mimeType)
    );
    if (currentAttachments.length > 0) {
      return currentAttachments;
    }
    if (this.referencesPriorPresentationSource(input.prompt, input.sourceUserMessageText)) {
      return input.availableAttachments.filter((attachment) =>
        this.isPresentationSourceAttachmentMime(attachment.mimeType)
      );
    }
    return [];
  }

  private isPresentationSourceAttachmentMime(mimeType: string): boolean {
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

  private referencesPriorPresentationSource(
    prompt: string,
    sourceUserMessageText: string
  ): boolean {
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

  private normalizePresentationRequest(input: {
    descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
    request: {
      prompt: string;
      instructions?: string | null;
      outputFormat?: "pdf" | "pptx" | null;
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
    outputFormat?: "pdf" | "pptx" | null;
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
    if (input.descriptorMode !== "create_presentation") {
      return input.request;
    }
    return {
      ...input.request,
      outputFormat: "pdf"
    };
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
    if (!isValidVisibleWorkspacePath(trimmed)) {
      return null;
    }
    if (options?.allowDirectory === true) {
      const normalized = trimmed.replace(/\/+$/g, "");
      return normalized.length > 0 ? normalized : null;
    }
    return trimmed;
  }

  private async prepareAuthoredRenderArtifactsIfRequested(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    originChatId: string | null;
    outputPath: string;
    format: "pdf" | "xlsx" | "docx";
    content: string | null;
    contentPath: string | null;
    style: DocumentRenderTemplateTheme | null;
    templatePath: string | null;
  }): Promise<AuthoredRenderArtifacts | null> {
    if (input.content === null && input.contentPath === null) {
      return null;
    }
    const authoredTemplate: NormalizedDocumentRenderTemplate = {
      title: null,
      theme: input.style ?? "default",
      css: null,
      pageSize: "A4",
      runningHeader: null,
      runningFooter: null
    };
    const contentSource = await this.resolveAuthoredRenderContentSource({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: input.requestId,
      originChatId: input.originChatId,
      content: input.content,
      contentPath: input.contentPath,
      outputPath: input.outputPath
    });
    return {
      sourceMarkdownPath: contentSource.markdownPath,
      programSource:
        input.format === "xlsx"
          ? this.buildAuthoredWorkbookScript({
              contentPath: contentSource.markdownPath,
              outputPath: input.outputPath
            })
          : this.buildAuthoredRenderScript({
              contentPath: contentSource.markdownPath,
              outputPath: input.outputPath,
              template: authoredTemplate,
              documentTitleFallback: this.stemOf(this.basename(input.outputPath)),
              format: input.format,
              templatePath: input.templatePath
            })
    };
  }

  private async resolveAuthoredRenderContentSource(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    originChatId: string | null;
    outputPath: string;
    content: string | null;
    contentPath: string | null;
  }): Promise<AuthoredRenderContentSource> {
    if (input.contentPath !== null) {
      const normalizedPath = this.normalizeWorkspacePath(input.contentPath);
      if (normalizedPath === null || !/\.(md|markdown)$/i.test(normalizedPath)) {
        throw new Error("document.contentPath must be a valid /workspace/... .md/.markdown file.");
      }
      return {
        markdown: await this.readWorkspaceTextFile({
          bundle: input.bundle,
          sessionId: input.sessionId,
          requestId: input.requestId,
          path: normalizedPath
        }),
        sourcePath: normalizedPath,
        sourceDisplayName: this.basename(normalizedPath),
        markdownPath: normalizedPath
      };
    }
    if (input.content === null) {
      throw new Error(
        "document.render requires exactly one of document.content or document.contentPath."
      );
    }
    const derivedPath = await this.resolveRenderOutputPath({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: `${input.requestId}:resolve-source-markdown`,
      outputPath: this.deriveSiblingMarkdownPath(input.outputPath),
      replace: false,
      originChatId: input.originChatId
    });
    await this.writeWorkspaceTextFile({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: `${input.requestId}:authored-markdown`,
      originChatId: input.originChatId,
      path: derivedPath,
      content: input.content,
      mimeType: "text/markdown",
      replace: false
    });
    return {
      markdown: input.content,
      sourcePath: derivedPath,
      sourceDisplayName: this.basename(derivedPath),
      markdownPath: derivedPath
    };
  }

  private buildAuthoredRenderCss(template: NormalizedDocumentRenderTemplate): string {
    const pageMargin =
      template.theme === "minimal"
        ? "16mm 16mm 18mm 16mm"
        : template.theme === "report"
          ? "18mm 18mm 22mm 18mm"
          : "20mm 18mm 22mm 18mm";
    const pageDecorations = [
      template.runningHeader === null
        ? ""
        : `  @top-center { content: "${this.escapeCssContent(template.runningHeader)}"; font-size: 9pt; color: #6b7280; }`,
      template.runningFooter === null
        ? ""
        : `  @bottom-center { content: "${this.escapeCssContent(template.runningFooter)}"; font-size: 9pt; color: #6b7280; }`
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    const themeCss =
      template.theme === "minimal"
        ? [
            "body { font-family: Arial, Helvetica, sans-serif; color: #111827; background: #ffffff; }",
            ".document-title { font-size: 26pt; margin: 0 0 10mm 0; color: #111827; }",
            "h1, h2, h3, h4, h5, h6 { color: #111827; font-family: Arial, Helvetica, sans-serif; }"
          ]
        : template.theme === "report"
          ? [
              "body { font-family: Inter, Arial, Helvetica, sans-serif; color: #0f172a; background: #ffffff; }",
              ".document-title { font-size: 28pt; letter-spacing: 0.01em; margin: 0 0 10mm 0; color: #0f3d91; }",
              "h1, h2, h3, h4, h5, h6 { color: #0f3d91; font-family: Inter, Arial, Helvetica, sans-serif; }",
              "table thead th { background: #e8eefc; }"
            ]
          : [
              'body { font-family: "Times New Roman", Georgia, serif; color: #1f2937; background: #f8fafc; }',
              ".document-title { font-size: 24pt; margin: 0 0 10mm 0; color: #1f4b99; }",
              "h1, h2, h3, h4, h5, h6 { color: #1f4b99; font-family: Georgia, serif; }"
            ];
    return [
      `@page { size: ${template.pageSize}; margin: ${pageMargin};`,
      pageDecorations,
      "}",
      "html { font-size: 12pt; }",
      ...themeCss,
      "body { line-height: 1.55; margin: 0; }",
      ".document-header { margin-bottom: 6mm; }",
      ".document-body { max-width: 100%; }",
      "p { margin: 0 0 8pt 0; }",
      "ul, ol { margin: 0 0 10pt 20pt; }",
      "li + li { margin-top: 3pt; }",
      "blockquote { margin: 0 0 10pt 0; padding-left: 12pt; border-left: 3px solid #cbd5e1; color: #475569; }",
      "table { width: 100%; border-collapse: collapse; margin: 0 0 10pt 0; }",
      "th, td { border: 1px solid #cbd5e1; padding: 6pt 8pt; vertical-align: top; }",
      "code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 0.92em; }",
      "pre { white-space: pre-wrap; padding: 8pt; background: #f1f5f9; border-radius: 6px; overflow-wrap: anywhere; }",
      template.css ?? ""
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  private buildAuthoredRenderScript(input: {
    contentPath: string;
    outputPath: string;
    template: NormalizedDocumentRenderTemplate;
    documentTitleFallback: string;
    format: "pdf" | "docx";
    templatePath: string | null;
  }): string {
    const title = input.template.title ?? input.documentTitleFallback;
    const themeCss = this.buildAuthoredRenderCss(input.template);
    return [
      "from __future__ import annotations",
      "",
      "from html import escape",
      "from pathlib import Path",
      "",
      "from bs4 import BeautifulSoup, NavigableString, Tag",
      "from docx import Document",
      "from docx.enum.text import WD_ALIGN_PARAGRAPH",
      "from docx.shared import Inches, Mm",
      "import markdown",
      "",
      `CONTENT_PATH = Path(${JSON.stringify(input.contentPath)})`,
      `OUTPUT_PATH = Path(${JSON.stringify(input.outputPath)})`,
      `TEMPLATE_PATH = ${input.templatePath === null ? "None" : `Path(${JSON.stringify(input.templatePath)})`}`,
      `TITLE = ${this.toPythonLiteral(input.template.title)}`,
      `TITLE_FALLBACK = ${JSON.stringify(title)}`,
      `PAGE_SIZE = ${JSON.stringify(input.template.pageSize)}`,
      `RUNNING_HEADER = ${this.toPythonLiteral(input.template.runningHeader)}`,
      `RUNNING_FOOTER = ${this.toPythonLiteral(input.template.runningFooter)}`,
      `THEME_CSS = ${JSON.stringify(themeCss)}`,
      `RENDER_FORMAT = ${JSON.stringify(input.format)}`,
      "",
      "def build_html_document() -> str:",
      "    markdown_source = CONTENT_PATH.read_text(encoding='utf-8')",
      "    body_html = markdown.markdown(",
      "        markdown_source,",
      "        extensions=['extra', 'sane_lists', 'nl2br', 'tables']",
      "    )",
      "    title_value = TITLE or TITLE_FALLBACK",
      "    title_block = ''",
      "    if TITLE:",
      "        title_block = (",
      "            '<header class=\"document-header\">'",
      "            f'<h1 class=\"document-title\">{escape(TITLE)}</h1>'",
      "            '</header>'",
      "        )",
      "    full_html = ''.join([",
      "        '<!DOCTYPE html>\\n',",
      "        '<html lang=\"en\">\\n',",
      "        '<head>\\n',",
      "        '  <meta charset=\"utf-8\"/>\\n',",
      "        f'  <title>{escape(title_value)}</title>\\n',",
      "        '  <style>\\n',",
      "        f'{THEME_CSS}\\n',",
      "        '  </style>\\n',",
      "        '</head>\\n',",
      "        '<body>\\n',",
      "        f'{title_block}\\n' if title_block else '',",
      "        '  <main class=\"document-body\">\\n',",
      "        f'{body_html}\\n',",
      "        '  </main>\\n',",
      "        '</body>\\n',",
      "        '</html>\\n',",
      "    ])",
      "    return full_html",
      "",
      "def configure_sections(document: Document) -> None:",
      "    for section in document.sections:",
      "        section.top_margin = Mm(18)",
      "        section.bottom_margin = Mm(20)",
      "        section.left_margin = Mm(18)",
      "        section.right_margin = Mm(18)",
      "        if PAGE_SIZE == 'Letter':",
      "            section.page_width = Inches(8.5)",
      "            section.page_height = Inches(11)",
      "        else:",
      "            section.page_width = Mm(210)",
      "            section.page_height = Mm(297)",
      "        if RUNNING_HEADER:",
      "            header = section.header.paragraphs[0] if section.header.paragraphs else section.header.add_paragraph()",
      "            header.text = RUNNING_HEADER",
      "            header.alignment = WD_ALIGN_PARAGRAPH.CENTER",
      "        if RUNNING_FOOTER:",
      "            footer = section.footer.paragraphs[0] if section.footer.paragraphs else section.footer.add_paragraph()",
      "            footer.text = RUNNING_FOOTER",
      "            footer.alignment = WD_ALIGN_PARAGRAPH.CENTER",
      "",
      "def add_table(document: Document, element: Tag) -> None:",
      "    rows = element.find_all('tr')",
      "    if not rows:",
      "        return",
      "    first_cells = rows[0].find_all(['th', 'td'])",
      "    if not first_cells:",
      "        return",
      "    table = document.add_table(rows=len(rows), cols=len(first_cells))",
      "    table.style = 'Table Grid'",
      "    for row_index, row in enumerate(rows):",
      "        cells = row.find_all(['th', 'td'])",
      "        for cell_index, cell in enumerate(cells[: len(first_cells)]):",
      "            table.cell(row_index, cell_index).text = cell.get_text(' ', strip=True)",
      "",
      "def add_blocks(document: Document, element: Tag) -> None:",
      "    for child in element.children:",
      "        if isinstance(child, NavigableString):",
      "            if child.strip():",
      "                document.add_paragraph(child.strip())",
      "            continue",
      "        if not isinstance(child, Tag):",
      "            continue",
      "        tag = child.name.lower()",
      "        if tag in {'main', 'article', 'section', 'div', 'body'}:",
      "            add_blocks(document, child)",
      "            continue",
      "        if tag in {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}:",
      "            text = child.get_text(' ', strip=True)",
      "            if text:",
      "                document.add_heading(text, level=min(int(tag[1]), 6))",
      "            continue",
      "        if tag == 'p':",
      "            text = child.get_text(' ', strip=True)",
      "            if text:",
      "                document.add_paragraph(text)",
      "            continue",
      "        if tag == 'ul':",
      "            for item in child.find_all('li', recursive=False):",
      "                text = item.get_text(' ', strip=True)",
      "                if text:",
      "                    document.add_paragraph(text, style='List Bullet')",
      "            continue",
      "        if tag == 'ol':",
      "            for item in child.find_all('li', recursive=False):",
      "                text = item.get_text(' ', strip=True)",
      "                if text:",
      "                    document.add_paragraph(text, style='List Number')",
      "            continue",
      "        if tag == 'table':",
      "            add_table(document, child)",
      "            continue",
      "        text = child.get_text(' ', strip=True)",
      "        if text:",
      "            document.add_paragraph(text)",
      "",
      "def build_docx(html_document: str) -> None:",
      "    soup = BeautifulSoup(html_document, 'html.parser')",
      "    document = Document(str(TEMPLATE_PATH)) if TEMPLATE_PATH is not None else Document()",
      "    configure_sections(document)",
      "    document.core_properties.title = TITLE or TITLE_FALLBACK",
      "    root = soup.body if soup.body is not None else soup",
      "    add_blocks(document, root)",
      "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
      "    document.save(str(OUTPUT_PATH))",
      "",
      "def build_pdf() -> None:",
      "    from weasyprint import HTML",
      "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
      "    HTML(string=build_html_document(), base_url=str(CONTENT_PATH.parent)).write_pdf(str(OUTPUT_PATH))",
      "",
      "def build() -> None:",
      "    if RENDER_FORMAT == 'pdf':",
      "        build_pdf()",
      "    else:",
      "        html_document = build_html_document()",
      "        build_docx(html_document)",
      "",
      "if __name__ == '__main__':",
      "    build()",
      ""
    ].join("\n");
  }

  private buildAuthoredWorkbookScript(input: { contentPath: string; outputPath: string }): string {
    return [
      "from __future__ import annotations",
      "",
      "from pathlib import Path",
      "",
      "from openpyxl import Workbook",
      "",
      `CONTENT_PATH = Path(${JSON.stringify(input.contentPath)})`,
      `OUTPUT_PATH = Path(${JSON.stringify(input.outputPath)})`,
      "",
      "def clean_cell(value: str) -> str:",
      "    return value.strip()",
      "",
      "def parse_markdown_tables(source: str):",
      "    lines = source.splitlines()",
      "    title = None",
      "    rows = []",
      "    index = 0",
      "    while index < len(lines):",
      "        line = lines[index].rstrip()",
      "        stripped = line.strip()",
      "        if title is None and stripped.startswith('# '):",
      "            title = stripped[2:].strip() or None",
      "        if '|' not in stripped or not stripped.startswith('|'):",
      "            index += 1",
      "            continue",
      "        if index + 1 >= len(lines):",
      "            index += 1",
      "            continue",
      "        separator = lines[index + 1].strip()",
      "        if '|' not in separator or '-' not in separator.replace('|', ''):",
      "            index += 1",
      "            continue",
      "        header = [clean_cell(cell) for cell in stripped.strip('|').split('|')]",
      "        if any(cell for cell in header):",
      "            rows.append(header)",
      "        index += 2",
      "        while index < len(lines):",
      "            row_line = lines[index].strip()",
      "            if '|' not in row_line or not row_line.startswith('|'):",
      "                break",
      "            row = [clean_cell(cell) for cell in row_line.strip('|').split('|')]",
      "            if any(cell for cell in row):",
      "                rows.append(row)",
      "            index += 1",
      "        if index < len(lines) and rows:",
      "            rows.append([])",
      "        continue",
      "    while rows and rows[-1] == []:",
      "        rows.pop()",
      "    return title, rows",
      "",
      "def build() -> None:",
      "    markdown_source = CONTENT_PATH.read_text(encoding='utf-8')",
      "    title, rows = parse_markdown_tables(markdown_source)",
      "    if not rows:",
      "        raise ValueError('document.render(format=xlsx) requires at least one Markdown table.')",
      "    workbook = Workbook()",
      "    sheet = workbook.active",
      "    if title:",
      "        safe_title = title[:31].strip() or 'Sheet1'",
      "        invalid = set('[]:*?/\\\\')",
      "        sheet.title = ''.join(ch for ch in safe_title if ch not in invalid) or 'Sheet1'",
      "    for row in rows:",
      "        if row == []:",
      "            sheet.append([])",
      "        else:",
      "            sheet.append(row)",
      "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
      "    workbook.save(str(OUTPUT_PATH))",
      "",
      "if __name__ == '__main__':",
      "    build()",
      ""
    ].join("\n");
  }

  private buildLibreOfficeConvertProgramSource(input: {
    sourcePath: string;
    sourceFormat: "pdf" | "xlsx" | "docx";
    targetFormat: "pdf" | "xlsx" | "docx";
    outputPath: string;
  }): string {
    if (input.sourceFormat === input.targetFormat) {
      return [
        "from pathlib import Path",
        "import shutil",
        "",
        `SOURCE_PATH = Path(${JSON.stringify(input.sourcePath)})`,
        `OUTPUT_PATH = Path(${JSON.stringify(input.outputPath)})`,
        "",
        "def build() -> None:",
        "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
        "    shutil.copyfile(str(SOURCE_PATH), str(OUTPUT_PATH))",
        "",
        "if __name__ == '__main__':",
        "    build()",
        ""
      ].join("\n");
    }
    return [
      "import os",
      "from pathlib import Path",
      "import shutil",
      "import subprocess",
      "import tempfile",
      "",
      `SOURCE_PATH = Path(${JSON.stringify(input.sourcePath)})`,
      `TARGET_FORMAT = ${JSON.stringify(input.targetFormat)}`,
      `OUTPUT_PATH = Path(${JSON.stringify(input.outputPath)})`,
      "",
      "def convert() -> None:",
      "    with tempfile.TemporaryDirectory(prefix='persai-office-convert-', dir='/tmp') as tmp_dir:",
      "        temp_root = Path(tmp_dir)",
      "        source_copy = temp_root / SOURCE_PATH.name",
      "        shutil.copyfile(str(SOURCE_PATH), str(source_copy))",
      "        out_dir = temp_root / 'out'",
      "        out_dir.mkdir(parents=True, exist_ok=True)",
      "        profile_uri = (temp_root / 'libreoffice-profile').resolve().as_uri()",
      "        command = [",
      "            'soffice',",
      "            '--headless',",
      "            '--nologo',",
      "            '--nodefault',",
      "            '--norestore',",
      "            '--nolockcheck',",
      "            '--nofirststartwizard',",
      "            f'-env:UserInstallation={profile_uri}',",
      "            '--convert-to',",
      "            TARGET_FORMAT,",
      "            '--outdir',",
      "            str(out_dir),",
      "            str(source_copy),",
      "        ]",
      "        completed = subprocess.run(command, capture_output=True, text=True)",
      "        if completed.returncode != 0:",
      "            raise RuntimeError(",
      "                f'LibreOffice failed to convert {SOURCE_PATH.name} to {TARGET_FORMAT}: '",
      "                f\"{completed.stderr.strip() or completed.stdout.strip() or 'unknown error'}\"",
      "            )",
      "        exported = out_dir / f'{source_copy.stem}.{TARGET_FORMAT}'",
      "        if not exported.is_file():",
      "            candidates = sorted(out_dir.glob(f'*.{TARGET_FORMAT}'))",
      "            if len(candidates) != 1:",
      "                raise FileNotFoundError(",
      "                    f'LibreOffice did not create a declared {TARGET_FORMAT.upper()} output for {SOURCE_PATH.name}.'",
      "                )",
      "            exported = candidates[0]",
      "        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
      "        shutil.move(str(exported), str(OUTPUT_PATH))",
      "",
      "if __name__ == '__main__':",
      "    convert()",
      ""
    ].join("\n");
  }

  private resolveRequestedDocumentOutputPath(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestedName: string;
    format: "pdf" | "xlsx" | "docx";
  }): string | Error {
    const assistantId = input.bundle.metadata.assistantId?.trim() ?? "";
    if (assistantId.length === 0) {
      return new Error("Document output path resolution requires a runtime assistant id.");
    }
    const requestedName = input.requestedName.trim();
    if (requestedName.length === 0) {
      return new Error("document.requestedName must be a non-empty string.");
    }
    if (
      requestedName.startsWith("/") ||
      requestedName.includes("/") ||
      requestedName.includes("\\") ||
      requestedName === "." ||
      requestedName === ".." ||
      Array.from(requestedName).some((char) => char.charCodeAt(0) < 32)
    ) {
      return new Error(
        "document.requestedName must be a filename only, not an absolute or nested path."
      );
    }
    const resolvedName = this.ensureRequestedNameMatchesFormat(requestedName, input.format);
    if (resolvedName instanceof Error) {
      return resolvedName;
    }
    return `${buildAssistantSessionRoot(assistantId, input.sessionId)}/${resolvedName}`;
  }

  private ensureRequestedNameMatchesFormat(
    requestedName: string,
    format: "pdf" | "xlsx" | "docx"
  ): string | Error {
    const lowered = requestedName.toLowerCase();
    const expectedSuffix = `.${format}`;
    const extensionMatch = /\.([a-z0-9]+)$/i.exec(requestedName);
    if (extensionMatch === null) {
      return `${requestedName}${expectedSuffix}`;
    }
    if (lowered.endsWith(expectedSuffix)) {
      return requestedName;
    }
    return new Error(`document.requestedName extension must match document format ${format}.`);
  }

  private async rejectInPlaceRenderOnUploadedBinaryWithoutSiblingMarkdown(input: {
    bundle: AssistantRuntimeBundle;
    outputPath: string;
  }): Promise<string | null> {
    const format = this.resolveDocumentFormatFromPath(input.outputPath);
    if (format === null) {
      return null;
    }
    try {
      const existing = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: input.outputPath
      });
      if (existing === null) {
        return null;
      }
      const siblingMarkdownPath = this.deriveSiblingMarkdownPath(input.outputPath);
      const siblingMarkdown = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: siblingMarkdownPath
      });
      if (siblingMarkdown !== null) {
        return null;
      }
      return (
        `document.render cannot replace existing uploaded ${format.toUpperCase()} at ${input.outputPath} without a sibling Markdown source (${siblingMarkdownPath}). ` +
        "Inspect the source first and follow editMethod=shell_native with shell + python-docx/openpyxl, then files.attach."
      );
    } catch {
      return null;
    }
  }

  private deriveSiblingMarkdownPath(outputPath: string): string {
    return `${this.dirname(outputPath)}/${this.stemOf(this.basename(outputPath))}.md`;
  }

  private resolveDocumentFormatFromPath(path: string): "pdf" | "xlsx" | "docx" | null {
    const lowered = path.toLowerCase();
    if (lowered.endsWith(".pdf")) {
      return "pdf";
    }
    if (lowered.endsWith(".xlsx")) {
      return "xlsx";
    }
    if (lowered.endsWith(".docx")) {
      return "docx";
    }
    return null;
  }

  private dirname(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash <= 0 ? "/workspace" : normalized.slice(0, lastSlash);
  }

  private async writeWorkspaceTextFile(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    originChatId: string | null;
    path: string;
    content: string;
    mimeType: string;
    replace?: boolean;
  }): Promise<string> {
    const outcome = await this.storagePlaneFilesService.writeTextFile({
      bundle: input.bundle,
      sessionId: input.sessionId,
      chatId: input.originChatId,
      targetPath: input.path,
      content: input.content,
      replace: input.replace === true,
      requestedName: this.basename(input.path)
    });
    if (!outcome.ok) {
      throw new Error(outcome.warning ?? outcome.reason ?? `Could not write ${input.path}.`);
    }
    return outcome.resolvedPath;
  }

  private async readWorkspaceTextFile(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    path: string;
  }): Promise<string> {
    const outcome = await this.storagePlaneFilesService.readTextFile({
      workspaceId: input.bundle.metadata.workspaceId,
      path: input.path,
      maxBytes: 2 * 1024 * 1024
    });
    if (!outcome.ok) {
      throw new Error(
        outcome.warning ?? outcome.reason ?? `Could not read ${input.path} from the workspace.`
      );
    }
    return outcome.content;
  }

  private stemOf(name: string | null): string {
    if (name === null) {
      return "";
    }
    const base = this.basename(name.trim());
    const dotIndex = base.lastIndexOf(".");
    return dotIndex > 0 ? base.slice(0, dotIndex) : base;
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
      },
      scriptVersionId: null,
      scriptSkillId: null,
      scriptContentHash: null,
      scriptInvocationKey: null
    } satisfies RuntimeSandboxJobRequest);
  }

  private async persistRenderedWorkspaceFile(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    outputPath: string;
    replace: boolean;
    originChatId: string | null;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
    job: RuntimeSandboxJobResult;
  }): Promise<{
    mimeType: string;
    sizeBytes: number;
    resolvedPath: string;
    metadataWarning: string | null;
  }> {
    const produced =
      input.job.files.find((file) => file.sizeBytes > 0) ?? input.job.files[0] ?? null;
    if (produced === null || produced.sizeBytes === 0) {
      throw new Error(
        `Could not persist ${input.outputPath}: document render produced no workspace artifact.`
      );
    }
    const buffer = await this.mediaObjectStorage.downloadObject(produced.storagePath);
    if (buffer === null || buffer.length === 0) {
      throw new Error(
        `Could not persist ${input.outputPath}: rendered bytes are unavailable in object storage.`
      );
    }
    const resolvedPath = input.outputPath;
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.bundle.metadata.workspaceId,
      workspaceRelPath: resolvedPath
    });
    await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer,
      mimeType: produced.mimeType
    });
    let metadataWarning: string | null = null;
    try {
      await this.persaiInternalApiClientService.upsertWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: resolvedPath,
        mimeType: produced.mimeType,
        sizeBytes: buffer.length,
        replace: input.replace,
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt,
        ...(input.originChatId === null
          ? {}
          : {
              originChatId: input.originChatId,
              originAssistantId: input.bundle.metadata.assistantId
            })
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Document metadata registration is temporarily unavailable.";
      this.logger.warn(`document_metadata_upsert_failed path=${resolvedPath} reason=${detail}`);
      metadataWarning = `document metadata registration failed after persisting ${resolvedPath}: ${detail}`;
    }
    return {
      resolvedPath,
      mimeType: produced.mimeType,
      sizeBytes: buffer.length,
      metadataWarning
    };
  }

  private async resolveRenderOutputPath(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    outputPath: string;
    replace: boolean;
    originChatId: string | null;
  }): Promise<string> {
    return this.storagePlaneFilesService.resolveWritePath({
      bundle: input.bundle,
      sessionId: input.sessionId,
      chatId: input.originChatId,
      targetPath: input.outputPath,
      replace: input.replace
    });
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

  private toWorkspaceRelativePath(path: string): string {
    return path.replace(/^\/workspace\//, "");
  }

  private basename(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] ?? normalized;
  }

  private escapeCssContent(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\A ");
  }

  private toPythonLiteral(value: string | null): string {
    return value === null ? "None" : JSON.stringify(value);
  }
}
