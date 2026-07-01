import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_SANDBOX_POLICY,
  buildDocumentProjectManifest,
  buildDocumentProjectPdfExportEntrypoint,
  buildDocumentProjectPythonRenderEntrypoint,
  buildDocumentProjectRenderScaffoldHtml,
  buildDocumentWorkspaceProjectLayout,
  isWorkspacePathUnderPrefix,
  validateDocumentProjectRenderPaths,
  type DocumentWorkspaceProjectSourceFormat,
  type DocumentWorkspaceProjectSourceKind,
  type PersaiRuntimePresentationImagePolicy,
  type PersaiRuntimePresentationVisualDensity,
  type PersaiRuntimePresentationVisualStyle,
  type ProviderGatewayToolCall,
  type RuntimeAttachmentRef,
  type RuntimeDocumentEditOpResult,
  type RuntimeDocumentEditSummary,
  type RuntimeDocumentToolResult,
  type RuntimeDocumentVersionRegistrationSummary,
  type RuntimeOutputArtifact,
  type RuntimeSandboxJobRequest,
  type RuntimeSandboxJobResult,
  type RuntimeSandboxPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { SandboxClientService } from "./sandbox-client.service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DocumentProjectManifestFacts = {
  sourceKind: DocumentWorkspaceProjectSourceKind | null;
  sourcePath: string | null;
  projectSourcePath: string | null;
  sourceFormat: DocumentWorkspaceProjectSourceFormat | null;
  defaultRenderEntrypoint: string | null;
  defaultPdfExportEntrypoint: string | null;
};

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
};

type DocumentEditOp =
  | { op: "replace"; find: string; replaceWith: string; all: boolean }
  | { op: "section"; heading: string; content: string };

type EditableDocumentContentSource = {
  contentPath: string;
  contentKind: "authored" | "extracted";
  content: string;
};

export interface RuntimeDocumentToolExecutionResult {
  payload: RuntimeDocumentToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeDocumentToolService {
  constructor(
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
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
    activeDocumentProjectPath?: string | null;
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const parsed = this.readDocumentArguments(params.toolCall.arguments);
    if (parsed instanceof Error) {
      return this.buildInvalidDocumentArgumentsResult(parsed.message);
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
        requestId: params.requestId ?? null,
        originChatId: params.originChatId ?? null,
        activeDocumentProjectPath: params.activeDocumentProjectPath ?? null,
        conversation: params.conversation ?? null,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        sourceUserMessageCreatedAt:
          params.deferToAsyncDocumentJob.sourceUserMessageCreatedAt ?? new Date(0).toISOString()
      });
    }

    if (parsed.kind === "register_version") {
      return this.executeRegisterVersionToolCall({
        bundle: params.bundle,
        conversation: params.conversation ?? null,
        request: parsed.request,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        sourceUserMessageCreatedAt:
          params.deferToAsyncDocumentJob.sourceUserMessageCreatedAt ?? new Date(0).toISOString()
      });
    }

    if (parsed.kind === "edit") {
      return this.executeEditToolCall({
        bundle: params.bundle,
        request: parsed.request,
        sessionId: params.sessionId ?? null,
        requestId: params.requestId ?? null,
        originChatId: params.originChatId ?? null,
        activeDocumentProjectPath: params.activeDocumentProjectPath ?? null,
        conversation: params.conversation ?? null,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        sourceUserMessageCreatedAt:
          params.deferToAsyncDocumentJob.sourceUserMessageCreatedAt ?? new Date(0).toISOString()
      });
    }

    return this.buildInvalidDocumentArgumentsResult(
      'document.action must be "extract", "inspect", "render", "edit", or "register_version".'
    );
  }

  async executePresentationToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    deferToAsyncDocumentJob: {
      sourceUserMessageId: string;
      sourceUserMessageText: string;
      sourceUserMessageCreatedAt?: string | null;
      currentAttachments: RuntimeAttachmentRef[];
      availableAttachments: RuntimeAttachmentRef[];
    };
  }): Promise<RuntimeDocumentToolExecutionResult> {
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

  private async executeExtractToolCall(params: {
    bundle: AssistantRuntimeBundle;
    request: {
      path: string;
      mode: "auto" | "text" | "ocr" | "layout";
    };
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const normalizedPath = this.normalizeWorkspacePath(params.request.path);
    if (normalizedPath === null) {
      return this.extractSkipped(
        "invalid_arguments",
        "document.path must be a valid /workspace/... path."
      );
    }
    try {
      const outcome = await this.persaiInternalApiClientService.extractDocumentToWorkspace({
        assistantId: params.bundle.metadata.assistantId,
        workspaceId: params.bundle.metadata.workspaceId,
        path: normalizedPath,
        mode: params.request.mode,
        outputDir: null
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
            projectPath: outcome.projectPath,
            projectManifestPath: outcome.projectManifestPath,
            projectSourcePath: outcome.projectSourcePath,
            defaultRenderEntrypoint: outcome.defaultRenderEntrypoint,
            defaultPdfOutputPath: outcome.defaultPdfOutputPath,
            outputPaths: outcome.outputPaths,
            suggestedReadPaths: outcome.suggestedReadPaths,
            counts: outcome.counts,
            provider: outcome.provider,
            quality: outcome.quality,
            warnings: outcome.warnings,
            suggestedNextActions: outcome.suggestedNextActions
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
            counts: outcome.counts,
            warnings: outcome.warnings,
            suggestedReadPaths: outcome.suggestedReadPaths,
            comparison: outcome.comparison
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
      requestedName?: string | null;
      replace?: boolean;
      content: string | null;
      template: NormalizedDocumentRenderTemplate | null;
    };
    sessionId: string | null;
    requestId: string | null;
    originChatId: string | null;
    activeDocumentProjectPath: string | null;
    conversation: {
      channel: "web" | "telegram";
      externalThreadKey: string;
    } | null;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
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

    const projectManifest = await this.readDocumentProjectManifestFactsOptional({
      bundle: params.bundle,
      sessionId: params.sessionId,
      requestId: params.requestId,
      projectPath
    });
    const importedNativeRenderWarning = this.resolveImportedNativeRenderWarning({
      format: params.request.format,
      projectManifest
    });
    if (importedNativeRenderWarning !== null) {
      return this.renderSkipped(
        params.request.format,
        "native_render_not_implemented",
        importedNativeRenderWarning
      );
    }

    // ADR-129 P-1: a render deliverable must live inside its document project so the
    // subsequent version registration is always keyed on a matching projectPath +
    // outputPath. Escaped outputs (e.g. workspace-root paths) are relocated into the
    // canonical <project>/output/ directory under a meaningful derived filename.
    const renderOutputPath = this.normalizeRenderOutputPath({
      projectPath,
      outputPath,
      format: params.request.format,
      requestedName: params.request.requestedName ?? null,
      projectManifest
    });

    let authoredEntrypointPath: string | null = null;
    try {
      authoredEntrypointPath = await this.prepareAuthoredRenderArtifactsIfRequested({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        originChatId: params.originChatId,
        projectPath,
        format: params.request.format,
        content: params.request.content,
        template: params.request.template,
        projectManifest
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to build authored document render sources.";
      return this.renderSkipped(
        params.request.format,
        /document\.content|document\.template|currently supports format=pdf or format=docx/i.test(
          message
        )
          ? "invalid_arguments"
          : "runtime_degraded",
        message
      );
    }

    let entrypointPath: string;
    try {
      const resolvedEntrypoint = await this.resolveRenderEntrypoint({
        bundle: params.bundle,
        projectPath,
        format: params.request.format,
        entrypoint: authoredEntrypointPath ?? params.request.entrypoint,
        projectManifest
      });
      if (resolvedEntrypoint === null) {
        return this.renderSkipped(
          params.request.format,
          "unsupported_render_source",
          this.renderEntrypointMissingWarning(params.request.format, projectPath, projectManifest)
        );
      }
      entrypointPath = resolvedEntrypoint;
      if (entrypointPath === renderOutputPath) {
        return this.renderSkipped(
          params.request.format,
          "invalid_arguments",
          "document.outputPath must not overwrite the render entrypoint."
        );
      }
      if (
        projectManifest?.sourceKind === "imported_workspace_file" &&
        (projectManifest.sourceFormat === "docx" || projectManifest.sourceFormat === "xlsx") &&
        projectManifest.sourceFormat === params.request.format
      ) {
        const layout = buildDocumentWorkspaceProjectLayout(projectPath);
        if (!isWorkspacePathUnderPrefix(entrypointPath, layout.renderDir)) {
          return this.renderSkipped(
            params.request.format,
            "invalid_arguments",
            `Imported ${params.request.format.toUpperCase()} projects must use a native Python entrypoint under ${layout.renderDir}/.`
          );
        }
      }
      if (params.activeDocumentProjectPath !== null) {
        const layout = buildDocumentWorkspaceProjectLayout(params.activeDocumentProjectPath);
        const validationError = validateDocumentProjectRenderPaths({
          layout,
          projectPath,
          outputPath: renderOutputPath,
          entrypointPath
        });
        if (validationError !== null) {
          return this.renderSkipped(params.request.format, "invalid_arguments", validationError);
        }
      }
    } catch (error) {
      return this.renderSkipped(
        params.request.format,
        "runtime_degraded",
        error instanceof Error ? error.message : "Failed to resolve document.render entrypoint."
      );
    }

    let resolvedOutputPath: string;
    try {
      resolvedOutputPath = await this.resolveRenderOutputPath({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath: renderOutputPath,
        replace: params.request.replace === true
      });
    } catch (error) {
      return this.renderSkipped(
        params.request.format,
        "runtime_degraded",
        error instanceof Error ? error.message : "Failed to resolve document.render output path."
      );
    }

    let job: RuntimeSandboxJobResult;
    try {
      const programSource = await this.buildRenderProgramSource({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        projectPath,
        outputPath: resolvedOutputPath,
        entrypointPath,
        format: params.request.format,
        activeDocumentProjectPath: params.activeDocumentProjectPath,
        projectManifest
      });
      job = await this.runDocumentCodeSandboxJob({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath: resolvedOutputPath,
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

    let persisted: { sizeBytes: number; mimeType: string; resolvedPath: string };
    try {
      persisted = await this.persistRenderedWorkspaceFile({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        outputPath: resolvedOutputPath,
        replace: params.request.replace === true,
        originChatId: params.originChatId
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

    const finalize = await this.finalizeRenderedDocument({
      bundle: params.bundle,
      conversation: params.conversation,
      sourceUserMessageText: params.sourceUserMessageText,
      sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt,
      projectPath,
      outputPath: persisted.resolvedPath
    });
    if (!finalize.ok) {
      // ADR-129 P-1: render owns register + delivery. When the version cannot be
      // registered (the deliverable gate that also blocks files.attach), the render
      // must NOT read as a clean delivered success. Surface the failure honestly and
      // do not record a produced/undelivered path, so nothing is auto-attached.
      return this.renderSkipped(params.request.format, finalize.reason, finalize.warning);
    }

    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "render",
        descriptorMode: finalize.registration?.descriptorMode ?? null,
        documentType: "workspace_document",
        provider: "sandbox",
        prompt: null,
        outputFormat: params.request.format,
        docId: finalize.registration?.docId ?? null,
        requestedName: this.basename(persisted.resolvedPath),
        artifacts: [],
        usage: null,
        action: "rendered",
        reason: null,
        warning: finalize.warning,
        render: {
          projectPath,
          outputPath: persisted.resolvedPath,
          format: params.request.format,
          entrypointPath,
          sizeBytes: persisted.sizeBytes,
          mimeType: persisted.mimeType
        },
        ...(finalize.registration === null
          ? {}
          : {
              versionId: finalize.registration.versionId,
              registration: finalize.registration
            })
      },
      artifacts: [],
      isError: false
    };
  }

  /**
   * ADR-129 P-1: `document.render` is the single deliverable producer that also owns
   * inspect + register. Registration (and the equivalent files.attach gate) require a
   * relevant inspect sidecar, so the runtime inspects the freshly rendered output and
   * then registers the version keyed on the in-project projectPath + outputPath. The
   * successfully rendered output is delivered exactly once by the end-of-turn
   * auto-attach machinery via the recorded produced path; the model must not call
   * files.attach for a render output.
   */
  private async finalizeRenderedDocument(input: {
    bundle: AssistantRuntimeBundle;
    conversation: {
      channel: "web" | "telegram";
      externalThreadKey: string;
    } | null;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
    projectPath: string;
    outputPath: string;
  }): Promise<
    | {
        ok: true;
        registration: RuntimeDocumentVersionRegistrationSummary | null;
        warning: string | null;
      }
    | {
        ok: false;
        reason: string;
        warning: string;
      }
  > {
    if (input.conversation === null) {
      // Genuinely no chat context to register/deliver against. Keep the historical
      // behavior: the render itself is valid, but no version/metadata was recorded.
      return {
        ok: true,
        registration: null,
        warning:
          "auto_register_skipped:no_conversation_context: version was not registered automatically because no chat conversation was resolved for this render. Delivery still works, but document/version metadata is missing."
      };
    }

    let inspectionPath: string | null = null;
    let inspectDetail: string | null = null;
    try {
      const inspect = await this.persaiInternalApiClientService.inspectDocumentInWorkspace({
        assistantId: input.bundle.metadata.assistantId,
        workspaceId: input.bundle.metadata.workspaceId,
        path: input.outputPath,
        depth: "standard",
        outputPath: null
      });
      if (inspect.accepted) {
        inspectionPath = inspect.inspectPath;
      } else {
        inspectDetail = `inspect_rejected:${inspect.code}: ${inspect.message}`;
      }
    } catch (error) {
      inspectDetail = `inspect_failed: ${
        error instanceof Error ? error.message : "Document inspect is temporarily unavailable."
      }`;
    }

    try {
      const outcome = await this.persaiInternalApiClientService.registerDocumentVersion({
        assistantId: input.bundle.metadata.assistantId,
        workspaceId: input.bundle.metadata.workspaceId,
        channel: input.conversation.channel,
        externalThreadKey: input.conversation.externalThreadKey,
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt,
        descriptorMode: null,
        docId: null,
        requestedName: null,
        workspaceProjectPath: input.projectPath,
        outputPath: input.outputPath,
        sourceManifestPath: null,
        inspectionPath
      });
      if (!outcome.accepted) {
        return {
          ok: false,
          reason: `register_rejected:${outcome.code}`,
          warning: `document.render produced ${input.outputPath} but could not register/deliver a document version (${outcome.code}): ${outcome.message}${
            inspectDetail === null ? "" : ` [${inspectDetail}]`
          }`
        };
      }
      return {
        ok: true,
        registration: {
          docId: outcome.docId,
          versionId: outcome.versionId,
          versionNumber: outcome.versionNumber,
          descriptorMode: outcome.descriptorMode,
          documentType: outcome.documentType,
          outputFormat: outcome.outputFormat,
          outputPath: outcome.outputPath,
          workspaceProjectPath: outcome.workspaceProjectPath,
          sourceManifestPath: outcome.sourceManifestPath,
          inspectionPath: outcome.inspectionPath
        },
        warning: null
      };
    } catch (error) {
      return {
        ok: false,
        reason: "register_failed",
        warning: `document.render produced ${input.outputPath} but document version registration failed: ${
          error instanceof Error
            ? error.message
            : "Document version registration is temporarily unavailable."
        }${inspectDetail === null ? "" : ` [${inspectDetail}]`}`
      };
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

  /**
   * ADR-129 Addendum III (P-3): `document.edit` applies ordered, declarative edit
   * operations server-side over the FULL canonical editable content (never a truncated
   * blob). It is all-or-nothing: every op must resolve first, then the updated content
   * is written back once to the same visible source. If `rerender` is set and all ops
   * apply, it chains into the single-door `document.render` so the updated document is
   * registered + delivered exactly once via the existing path.
   */
  private async executeEditToolCall(params: {
    bundle: AssistantRuntimeBundle;
    request: {
      projectPath: string;
      edits: DocumentEditOp[];
      rerender: boolean;
      format: "pdf" | "xlsx" | "docx" | null;
      outputPath: string | null;
      requestedName: string | null;
      replace: boolean;
    };
    sessionId: string | null;
    requestId: string | null;
    originChatId: string | null;
    activeDocumentProjectPath: string | null;
    conversation: {
      channel: "web" | "telegram";
      externalThreadKey: string;
    } | null;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  }): Promise<RuntimeDocumentToolExecutionResult> {
    const projectPath = this.normalizeWorkspacePath(params.request.projectPath, {
      allowDirectory: true
    });
    if (projectPath === null) {
      return this.editSkipped(
        "invalid_arguments",
        "document.projectPath must be a valid /workspace/... directory."
      );
    }
    if (params.sessionId === null || params.requestId === null) {
      return this.editSkipped(
        "runtime_degraded",
        "document.edit requires an active runtime session."
      );
    }
    if (this.sandboxClientService?.isConfigured() !== true) {
      return this.editSkipped("sandbox_unconfigured", "Sandbox service is not configured.");
    }

    let source: EditableDocumentContentSource | null;
    try {
      source = await this.resolveEditableContentSource({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: params.requestId,
        projectPath
      });
    } catch (error) {
      return this.editSkipped(
        "runtime_degraded",
        error instanceof Error
          ? error.message
          : "document.edit could not read the project's editable content."
      );
    }
    if (source === null) {
      return this.editSkipped(
        "no_editable_content",
        `document.edit found no editable content for ${projectPath}. Extract a source (extract/extracted.md) or author render/content.md first.`
      );
    }

    const applyOutcome = this.applyDocumentEditOps({
      content: source.content,
      edits: params.request.edits
    });
    const bytesBefore = Buffer.byteLength(source.content, "utf8");

    if (!applyOutcome.ok) {
      const failed = applyOutcome.results
        .filter((result) => result.status === "failed")
        .map(
          (result) =>
            `${result.op}(${result.failureReason ?? "failed"})${result.detail === null || result.detail === undefined ? "" : `: ${result.detail}`}`
        )
        .join("; ");
      return this.editResult({
        projectPath,
        source,
        applied: false,
        results: applyOutcome.results,
        bytesBefore,
        bytesAfter: bytesBefore,
        reason: "edit_op_failed",
        warning: `document.edit made NO changes (all-or-nothing): ${failed}. The visible source ${source.contentPath} was left byte-for-byte unchanged.`
      });
    }

    const bytesAfter = Buffer.byteLength(applyOutcome.content, "utf8");
    try {
      await this.writeWorkspaceTextFile({
        bundle: params.bundle,
        sessionId: params.sessionId,
        requestId: `${params.requestId}:edit-write`,
        originChatId: params.originChatId,
        path: source.contentPath,
        content: applyOutcome.content,
        mimeType: "text/markdown"
      });
    } catch (error) {
      return this.editSkipped(
        "edit_write_failed",
        error instanceof Error
          ? error.message
          : `document.edit could not write the updated content to ${source.contentPath}.`
      );
    }

    if (!params.request.rerender) {
      return this.editResult({
        projectPath,
        source,
        applied: true,
        results: applyOutcome.results,
        bytesBefore,
        bytesAfter,
        reason: null,
        warning: null
      });
    }

    const rerender = await this.executeRenderToolCall({
      bundle: params.bundle,
      request: {
        projectPath,
        outputPath: params.request.outputPath as string,
        format: params.request.format as "pdf" | "xlsx" | "docx",
        entrypoint: null,
        requestedName: params.request.requestedName,
        replace: params.request.replace,
        // Authored projects re-bind their updated content.md through the P-4 authored
        // render path; imported/extracted projects reuse their existing/derived
        // entrypoint (content stays null so render resolves the project entrypoint).
        content: source.contentKind === "authored" ? source.contentPath : null,
        template: null
      },
      sessionId: params.sessionId,
      requestId: params.requestId,
      originChatId: params.originChatId,
      activeDocumentProjectPath: params.activeDocumentProjectPath,
      conversation: params.conversation,
      sourceUserMessageText: params.sourceUserMessageText,
      sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt
    });

    const editSummary: RuntimeDocumentEditSummary = {
      projectPath,
      contentPath: source.contentPath,
      contentKind: source.contentKind,
      applied: true,
      opCount: applyOutcome.results.length,
      results: applyOutcome.results,
      bytesBefore,
      bytesAfter
    };
    return {
      ...rerender,
      payload: {
        ...rerender.payload,
        requestedAction: "edit",
        edit: editSummary
      }
    };
  }

  private editResult(input: {
    projectPath: string;
    source: EditableDocumentContentSource;
    applied: boolean;
    results: RuntimeDocumentEditOpResult[];
    bytesBefore: number;
    bytesAfter: number;
    reason: string | null;
    warning: string | null;
  }): RuntimeDocumentToolExecutionResult {
    const summary: RuntimeDocumentEditSummary = {
      projectPath: input.projectPath,
      contentPath: input.source.contentPath,
      contentKind: input.source.contentKind,
      applied: input.applied,
      opCount: input.results.length,
      results: input.results,
      bytesBefore: input.bytesBefore,
      bytesAfter: input.bytesAfter
    };
    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "edit",
        descriptorMode: null,
        documentType: "workspace_document",
        provider: "sandbox",
        prompt: null,
        outputFormat: null,
        docId: null,
        requestedName: null,
        artifacts: [],
        usage: null,
        action: input.applied ? "edited" : "skipped",
        reason: input.reason,
        warning: input.warning,
        edit: summary
      },
      artifacts: [],
      isError: !input.applied
    };
  }

  private editSkipped(reason: string, warning: string): RuntimeDocumentToolExecutionResult {
    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "edit",
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
      isError: true
    };
  }

  /**
   * ADR-129 Addendum III (P-3): pick the project's single canonical editable content
   * file deterministically. Authored projects (P-4) own `render/content.md`;
   * imported/extracted projects own `extract/extracted.md`. The manifest sourceKind
   * chooses the preferred order and the first candidate that actually exists wins, so
   * the edit always targets a real visible source (or reports no editable content).
   */
  private async resolveEditableContentSource(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    projectPath: string;
  }): Promise<EditableDocumentContentSource | null> {
    const layout = buildDocumentWorkspaceProjectLayout(input.projectPath);
    const authoredPath = `${layout.renderDir}/content.md`;
    const extractedPath = `${layout.extractDir}/extracted.md`;
    const manifest = await this.readDocumentProjectManifestFactsOptional(input);
    const candidates: Array<{ path: string; kind: "authored" | "extracted" }> =
      manifest?.sourceKind === "authored_workspace_project"
        ? [
            { path: authoredPath, kind: "authored" },
            { path: extractedPath, kind: "extracted" }
          ]
        : [
            { path: extractedPath, kind: "extracted" },
            { path: authoredPath, kind: "authored" }
          ];
    const files = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
      workspaceId: input.bundle.metadata.workspaceId,
      pathPrefix: `${input.projectPath}/`,
      assistantHandle: input.bundle.metadata.assistantHandle,
      scope: "workspace_shared",
      currentChatId: null,
      currentAssistantId: input.bundle.metadata.assistantId
    });
    const filePaths = new Set(
      files.items.filter((item) => item.type === "file").map((item) => item.path)
    );
    for (const candidate of candidates) {
      if (!filePaths.has(candidate.path)) {
        continue;
      }
      const content = await this.readWorkspaceTextFile({
        bundle: input.bundle,
        sessionId: input.sessionId,
        requestId: `${input.requestId}:edit-read`,
        path: candidate.path
      });
      return { contentPath: candidate.path, contentKind: candidate.kind, content };
    }
    return null;
  }

  /**
   * ADR-129 Addendum III (P-3): apply the ordered ops over the full content string.
   * All-or-nothing — ops are applied to a working copy in order; the first failing op
   * aborts the edit (remaining ops are reported as skipped) and the caller writes
   * nothing. Untouched content is preserved verbatim.
   */
  private applyDocumentEditOps(input: { content: string; edits: DocumentEditOp[] }): {
    ok: boolean;
    content: string;
    results: RuntimeDocumentEditOpResult[];
  } {
    let working = input.content;
    const results: RuntimeDocumentEditOpResult[] = [];
    let failed = false;
    for (let index = 0; index < input.edits.length; index += 1) {
      const op = input.edits[index]!;
      if (failed) {
        results.push({
          op: op.op,
          status: "skipped",
          replacements: 0,
          failureReason: null,
          detail: "not applied: a previous edit failed and the document was left unchanged."
        });
        continue;
      }
      const outcome =
        op.op === "replace"
          ? this.applyReplaceEditOp(working, op)
          : this.applySectionEditOp(working, op);
      if (!outcome.ok) {
        failed = true;
        results.push({
          op: op.op,
          status: "failed",
          replacements: 0,
          failureReason: outcome.failureReason,
          detail: outcome.detail
        });
        continue;
      }
      working = outcome.content;
      results.push({
        op: op.op,
        status: "applied",
        replacements: outcome.replacements,
        failureReason: null,
        detail: null
      });
    }
    if (failed) {
      return { ok: false, content: input.content, results };
    }
    return { ok: true, content: working, results };
  }

  private applyReplaceEditOp(
    content: string,
    op: { find: string; replaceWith: string; all: boolean }
  ):
    | { ok: true; content: string; replacements: number }
    | {
        ok: false;
        failureReason: "no_match" | "ambiguous_match" | "heading_not_found";
        detail: string;
      } {
    const occurrences = this.countLiteralOccurrences(content, op.find);
    if (occurrences === 0) {
      return {
        ok: false,
        failureReason: "no_match",
        detail: `find text was not present in the content: ${JSON.stringify(this.truncateForDetail(op.find))}`
      };
    }
    if (!op.all && occurrences > 1) {
      return {
        ok: false,
        failureReason: "ambiguous_match",
        detail: `find text matched ${String(occurrences)} times; pass all:true to replace every occurrence or make find unique.`
      };
    }
    if (op.all) {
      return {
        ok: true,
        content: content.split(op.find).join(op.replaceWith),
        replacements: occurrences
      };
    }
    const idx = content.indexOf(op.find);
    return {
      ok: true,
      content: content.slice(0, idx) + op.replaceWith + content.slice(idx + op.find.length),
      replacements: 1
    };
  }

  private applySectionEditOp(
    content: string,
    op: { heading: string; content: string }
  ):
    | { ok: true; content: string; replacements: number }
    | {
        ok: false;
        failureReason: "no_match" | "ambiguous_match" | "heading_not_found";
        detail: string;
      } {
    const target = this.parseHeadingQuery(op.heading);
    const headings = this.findMarkdownHeadings(content);
    const matches = headings.filter(
      (heading) =>
        heading.text === target.text && (target.level === null || heading.level === target.level)
    );
    if (matches.length === 0) {
      return {
        ok: false,
        failureReason: "heading_not_found",
        detail: `no Markdown heading matched ${JSON.stringify(op.heading)}.`
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        failureReason: "ambiguous_match",
        detail: `heading ${JSON.stringify(op.heading)} matched ${String(matches.length)} sections; make the heading unique.`
      };
    }
    const match = matches[0]!;
    const bodyEnd = this.resolveSectionBodyEnd(headings, match, content.length);
    const before = content.slice(0, match.bodyStart);
    const after = content.slice(bodyEnd);
    let replacement = op.content.replace(/\n+$/, "");
    replacement = `${replacement}\n`;
    if (after.length > 0) {
      replacement = `${replacement}\n`;
    }
    return { ok: true, content: `${before}${replacement}${after}`, replacements: 1 };
  }

  private countLiteralOccurrences(content: string, find: string): number {
    if (find.length === 0) {
      return 0;
    }
    let count = 0;
    let from = 0;
    for (;;) {
      const idx = content.indexOf(find, from);
      if (idx === -1) {
        break;
      }
      count += 1;
      from = idx + find.length;
    }
    return count;
  }

  private truncateForDetail(value: string): string {
    const collapsed = value.replace(/\s+/g, " ").trim();
    return collapsed.length > 80 ? `${collapsed.slice(0, 77)}...` : collapsed;
  }

  private parseHeadingQuery(heading: string): { level: number | null; text: string } {
    const match = /^(#{1,6})\s+(.*)$/.exec(heading.trim());
    if (match) {
      return {
        level: match[1]!.length,
        text: match[2]!.replace(/\s+#*\s*$/, "").trim()
      };
    }
    return { level: null, text: heading.trim() };
  }

  /**
   * Parse ATX Markdown headings with character offsets so section edits can splice the
   * body by offset (preserving every untouched byte). Lines inside fenced code blocks
   * are ignored so `#` comments in code are never treated as headings.
   */
  private findMarkdownHeadings(content: string): Array<{
    level: number;
    text: string;
    lineStart: number;
    bodyStart: number;
  }> {
    const headings: Array<{ level: number; text: string; lineStart: number; bodyStart: number }> =
      [];
    let offset = 0;
    let inFence = false;
    let fenceMarker = "";
    for (const rawLine of content.split("\n")) {
      const lineStart = offset;
      const bodyStart = offset + rawLine.length + 1;
      offset = bodyStart;
      const fenceMatch = /^\s*(```+|~~~+)/.exec(rawLine);
      if (fenceMatch) {
        const marker = fenceMatch[1]!;
        if (!inFence) {
          inFence = true;
          fenceMarker = marker[0]!;
        } else if (marker[0] === fenceMarker) {
          inFence = false;
          fenceMarker = "";
        }
        continue;
      }
      if (inFence) {
        continue;
      }
      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(rawLine);
      if (headingMatch) {
        headings.push({
          level: headingMatch[1]!.length,
          text: headingMatch[2]!.replace(/\s+#*\s*$/, "").trim(),
          lineStart,
          bodyStart
        });
      }
    }
    return headings;
  }

  private resolveSectionBodyEnd(
    headings: Array<{ level: number; lineStart: number }>,
    match: { level: number; lineStart: number },
    contentLength: number
  ): number {
    for (const heading of headings) {
      if (heading.lineStart > match.lineStart && heading.level <= match.level) {
        return heading.lineStart;
      }
    }
    return contentLength;
  }

  private async executeRegisterVersionToolCall(params: {
    bundle: AssistantRuntimeBundle;
    conversation: {
      channel: "web" | "telegram";
      externalThreadKey: string;
    } | null;
    request: {
      descriptorMode:
        | "create_document"
        | "create_pdf_document"
        | "revise_document"
        | "create_data_document"
        | null;
      docId: string | null;
      requestedName: string | null;
      workspaceProjectPath: string | null;
      outputPath: string;
      sourceManifestPath: string | null;
      inspectionPath: string | null;
    };
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  }): Promise<RuntimeDocumentToolExecutionResult> {
    if (params.conversation === null) {
      return this.registerSkipped(
        "runtime_degraded",
        "Document version registration requires an active chat conversation."
      );
    }
    const outputPath = this.normalizeWorkspacePath(params.request.outputPath);
    if (outputPath === null) {
      return this.registerSkipped(
        "invalid_arguments",
        "document.outputPath must be a valid /workspace/... file path."
      );
    }
    const workspaceProjectPath =
      params.request.workspaceProjectPath === null
        ? null
        : this.normalizeWorkspacePath(params.request.workspaceProjectPath, {
            allowDirectory: true
          });
    if (params.request.workspaceProjectPath !== null && workspaceProjectPath === null) {
      return this.registerSkipped(
        "invalid_arguments",
        "document.workspaceProjectPath must be a valid /workspace/... directory."
      );
    }
    const sourceManifestPath =
      params.request.sourceManifestPath === null
        ? null
        : this.normalizeWorkspacePath(params.request.sourceManifestPath);
    if (params.request.sourceManifestPath !== null && sourceManifestPath === null) {
      return this.registerSkipped(
        "invalid_arguments",
        "document.sourceManifestPath must be a valid /workspace/... file path."
      );
    }
    const inspectionPath =
      params.request.inspectionPath === null
        ? null
        : this.normalizeWorkspacePath(params.request.inspectionPath);
    if (params.request.inspectionPath !== null && inspectionPath === null) {
      return this.registerSkipped(
        "invalid_arguments",
        "document.inspectionPath must be a valid /workspace/... file path."
      );
    }
    try {
      const outcome = await this.persaiInternalApiClientService.registerDocumentVersion({
        assistantId: params.bundle.metadata.assistantId,
        workspaceId: params.bundle.metadata.workspaceId,
        channel: params.conversation.channel,
        externalThreadKey: params.conversation.externalThreadKey,
        sourceUserMessageText: params.sourceUserMessageText,
        sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt,
        descriptorMode: params.request.descriptorMode,
        docId: params.request.docId,
        requestedName: params.request.requestedName,
        workspaceProjectPath,
        outputPath,
        sourceManifestPath,
        inspectionPath
      });
      if (!outcome.accepted) {
        return this.registerSkipped(outcome.code, outcome.message);
      }
      return {
        payload: {
          toolCode: "document",
          executionMode: "inline",
          requestedAction: "register_version",
          descriptorMode: outcome.descriptorMode,
          documentType: outcome.documentType,
          provider: "sandbox",
          prompt: null,
          outputFormat: outcome.outputFormat,
          docId: outcome.docId,
          requestedName: params.request.requestedName ?? this.basename(outcome.outputPath),
          artifacts: [],
          usage: null,
          action: "registered",
          reason: null,
          warning: null,
          versionId: outcome.versionId,
          registration: {
            docId: outcome.docId,
            versionId: outcome.versionId,
            versionNumber: outcome.versionNumber,
            descriptorMode: outcome.descriptorMode,
            documentType: outcome.documentType,
            outputFormat: outcome.outputFormat,
            outputPath: outcome.outputPath,
            workspaceProjectPath: outcome.workspaceProjectPath,
            sourceManifestPath: outcome.sourceManifestPath,
            inspectionPath: outcome.inspectionPath
          }
        },
        artifacts: [],
        isError: false
      };
    } catch (error) {
      return this.registerSkipped(
        "runtime_degraded",
        error instanceof Error
          ? error.message
          : "Document version registration is temporarily unavailable."
      );
    }
  }

  private registerSkipped(reason: string, warning: string): RuntimeDocumentToolExecutionResult {
    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "register_version",
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

  private readDocumentArguments(value: unknown):
    | {
        kind: "extract";
        request: {
          path: string;
          mode: "auto" | "text" | "ocr" | "layout";
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
          requestedName: string | null;
          content: string | null;
          template: NormalizedDocumentRenderTemplate | null;
        };
      }
    | {
        kind: "register_version";
        request: {
          descriptorMode:
            | "create_document"
            | "create_pdf_document"
            | "revise_document"
            | "create_data_document"
            | null;
          docId: string | null;
          requestedName: string | null;
          workspaceProjectPath: string | null;
          outputPath: string;
          sourceManifestPath: string | null;
          inspectionPath: string | null;
        };
      }
    | {
        kind: "edit";
        request: {
          projectPath: string;
          edits: DocumentEditOp[];
          rerender: boolean;
          format: "pdf" | "xlsx" | "docx" | null;
          outputPath: string | null;
          requestedName: string | null;
          replace: boolean;
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
      if (this.readNonEmptyString(row.outputDir) !== null) {
        return new Error(
          "document.extract no longer accepts outputDir; extraction creates a document project under /workspace/projects/<slug>/."
        );
      }
      return {
        kind: "extract",
        request: {
          path,
          mode:
            row.mode === "text" || row.mode === "ocr" || row.mode === "layout" ? row.mode : "auto"
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
      try {
        return {
          kind: "render",
          request: {
            projectPath,
            outputPath,
            format,
            entrypoint: this.readNonEmptyString(row.entrypoint),
            requestedName: this.readNonEmptyString(row.requestedName),
            content: this.readDocumentRenderContent(row.content),
            template: this.readDocumentRenderTemplate(row.template),
            ...(row.replace === true ? { replace: true } : {})
          }
        };
      } catch (error) {
        return new Error(
          error instanceof Error ? error.message : "document.render arguments are invalid."
        );
      }
    }
    if (row.action === "edit") {
      const projectPath = this.readNonEmptyString(row.projectPath);
      if (projectPath === null) {
        return new Error("document.projectPath must be a non-empty string.");
      }
      try {
        const edits = this.readDocumentEditOps(row.edits);
        const rerender = row.rerender === true;
        let format: "pdf" | "xlsx" | "docx" | null = null;
        let outputPath: string | null = null;
        if (rerender) {
          if (row.format !== "pdf" && row.format !== "xlsx" && row.format !== "docx") {
            return new Error(
              "document.edit with rerender=true requires document.format (pdf, xlsx, or docx)."
            );
          }
          format = row.format;
          outputPath = this.readNonEmptyString(row.outputPath);
          if (outputPath === null) {
            return new Error(
              "document.edit with rerender=true requires a non-empty document.outputPath."
            );
          }
        }
        return {
          kind: "edit",
          request: {
            projectPath,
            edits,
            rerender,
            format,
            outputPath,
            requestedName: this.readNonEmptyString(row.requestedName),
            replace: row.replace === true
          }
        };
      } catch (error) {
        return new Error(
          error instanceof Error ? error.message : "document.edit arguments are invalid."
        );
      }
    }
    if (row.action === "register_version") {
      const outputPath = this.readNonEmptyString(row.outputPath);
      if (outputPath === null) {
        return new Error("document.outputPath must be a non-empty string.");
      }
      return {
        kind: "register_version",
        request: {
          descriptorMode:
            row.descriptorMode === "create_document" ||
            row.descriptorMode === "create_pdf_document" ||
            row.descriptorMode === "revise_document" ||
            row.descriptorMode === "create_data_document"
              ? row.descriptorMode === "revise_document"
                ? "revise_document"
                : "create_document"
              : null,
          docId: this.readNonEmptyString(row.docId),
          requestedName: this.readNonEmptyString(row.requestedName),
          workspaceProjectPath: this.readNonEmptyString(row.workspaceProjectPath),
          outputPath,
          sourceManifestPath: this.readNonEmptyString(row.sourceManifestPath),
          inspectionPath: this.readNonEmptyString(row.inspectionPath)
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
        'document requires an explicit action such as "extract", "inspect", "render", "edit", or "register_version". Slide decks belong in the presentation tool.'
      );
    }
    return new Error(
      'document.action must be "extract", "inspect", "render", "edit", or "register_version".'
    );
  }

  private readDocumentEditOps(value: unknown): DocumentEditOp[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("document.edits must be a non-empty array of edit operations.");
    }
    return value.map((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`document.edits[${index}] must be an object.`);
      }
      const row = entry as Record<string, unknown>;
      if (row.op === "replace") {
        const find = typeof row.find === "string" ? row.find : "";
        if (find.length === 0) {
          throw new Error(`document.edits[${index}].find must be a non-empty string.`);
        }
        if (typeof row.replaceWith !== "string") {
          throw new Error(`document.edits[${index}].replaceWith must be a string.`);
        }
        return {
          op: "replace" as const,
          find,
          replaceWith: row.replaceWith,
          all: row.all === true
        };
      }
      if (row.op === "section") {
        const heading = typeof row.heading === "string" ? row.heading.trim() : "";
        if (heading.length === 0) {
          throw new Error(`document.edits[${index}].heading must be a non-empty string.`);
        }
        if (typeof row.content !== "string") {
          throw new Error(`document.edits[${index}].content must be a string.`);
        }
        return { op: "section" as const, heading, content: row.content };
      }
      throw new Error(`document.edits[${index}].op must be "replace" or "section".`);
    });
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

  private readDocumentRenderTemplate(value: unknown): NormalizedDocumentRenderTemplate | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("document.template must be an object when provided.");
    }
    const row = value as Record<string, unknown>;
    const allowedKeys = new Set([
      "title",
      "theme",
      "css",
      "pageSize",
      "runningHeader",
      "runningFooter"
    ]);
    for (const key of Object.keys(row)) {
      if (!allowedKeys.has(key)) {
        throw new Error(
          "document.template supports only title, theme, css, pageSize, runningHeader, and runningFooter."
        );
      }
    }
    const title = this.readNullableTemplateString(row.title, "document.template.title");
    const css = this.readNullableTemplateString(row.css, "document.template.css");
    const runningHeader = this.readNullableTemplateString(
      row.runningHeader,
      "document.template.runningHeader"
    );
    const runningFooter = this.readNullableTemplateString(
      row.runningFooter,
      "document.template.runningFooter"
    );
    if (
      row.theme !== undefined &&
      row.theme !== "default" &&
      row.theme !== "report" &&
      row.theme !== "minimal"
    ) {
      throw new Error("document.template.theme must be default, report, or minimal.");
    }
    if (row.pageSize !== undefined && row.pageSize !== "A4" && row.pageSize !== "Letter") {
      throw new Error("document.template.pageSize must be A4 or Letter.");
    }
    return {
      title,
      theme: row.theme === "report" || row.theme === "minimal" ? row.theme : ("default" as const),
      css,
      pageSize: row.pageSize === "Letter" ? "Letter" : "A4",
      runningHeader,
      runningFooter
    };
  }

  private readNullableTemplateString(value: unknown, fieldName: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new Error(`${fieldName} must be a string when provided.`);
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
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
    projectManifest: DocumentProjectManifestFacts | null;
  }): Promise<string | null> {
    // ADR-129 P-2: imported DOCX/XLSX -> PDF is a fixed deterministic pipeline. The
    // engine is always the seeded LibreOffice `export_pdf.py`; the model cannot select
    // or override the engine for this conversion, so any provided entrypoint is ignored.
    if (
      input.format === "pdf" &&
      input.projectManifest?.sourceKind === "imported_workspace_file" &&
      (input.projectManifest.sourceFormat === "docx" ||
        input.projectManifest.sourceFormat === "xlsx")
    ) {
      return this.resolveImportedOfficePdfExportEntrypoint({
        bundle: input.bundle,
        projectPath: input.projectPath,
        projectManifest: input.projectManifest
      });
    }
    if (input.entrypoint !== null) {
      if (input.entrypoint.startsWith("/workspace/")) {
        return this.normalizeWorkspacePath(input.entrypoint);
      }
      return this.normalizeWorkspacePath(
        `${input.projectPath}/${input.entrypoint.replace(/^\.?\//, "")}`
      );
    }
    if (input.format !== "pdf") {
      if (
        input.projectManifest?.sourceKind === "imported_workspace_file" &&
        (input.projectManifest.sourceFormat === "docx" ||
          input.projectManifest.sourceFormat === "xlsx") &&
        input.projectManifest.sourceFormat === input.format
      ) {
        const files = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
          workspaceId: input.bundle.metadata.workspaceId,
          pathPrefix: `${input.projectPath}/`,
          assistantHandle: input.bundle.metadata.assistantHandle,
          scope: "workspace_shared",
          currentChatId: null,
          currentAssistantId: input.bundle.metadata.assistantId
        });
        const filePaths = files.items
          .filter((item) => item.type === "file")
          .map((item) => item.path);
        const layout = buildDocumentWorkspaceProjectLayout(input.projectPath);
        const preferredEntrypoints = [
          input.projectManifest.defaultRenderEntrypoint,
          buildDocumentProjectPythonRenderEntrypoint(layout)
        ].filter((value): value is string => typeof value === "string" && value.length > 0);
        for (const preferred of preferredEntrypoints) {
          if (filePaths.includes(preferred)) {
            return preferred;
          }
        }
        return null;
      }
      return `${input.projectPath}/build.py`;
    }
    const files = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
      workspaceId: input.bundle.metadata.workspaceId,
      pathPrefix: `${input.projectPath}/`,
      assistantHandle: input.bundle.metadata.assistantHandle,
      scope: "workspace_shared",
      currentChatId: null,
      currentAssistantId: input.bundle.metadata.assistantId
    });
    const filePaths = files.items.filter((item) => item.type === "file").map((item) => item.path);
    for (const preferred of [
      `${input.projectPath}/render/report.html`,
      `${input.projectPath}/render/index.html`,
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
    return null;
  }

  private async prepareAuthoredRenderArtifactsIfRequested(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    originChatId: string | null;
    projectPath: string;
    format: "pdf" | "xlsx" | "docx";
    content: string | null;
    template: NormalizedDocumentRenderTemplate | null;
    projectManifest: DocumentProjectManifestFacts | null;
  }): Promise<string | null> {
    if (input.content === null) {
      return null;
    }
    if (input.projectManifest?.sourceKind === "imported_workspace_file") {
      return null;
    }
    if (input.format !== "pdf" && input.format !== "docx") {
      throw new Error(
        "document.content authored render currently supports format=pdf or format=docx."
      );
    }
    const layout = buildDocumentWorkspaceProjectLayout(input.projectPath);
    const authoredTemplate = input.template ?? {
      title: null,
      theme: "default",
      css: null,
      pageSize: "A4",
      runningHeader: null,
      runningFooter: null
    };
    const contentSource = await this.resolveAuthoredRenderContentSource({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: input.requestId,
      content: input.content
    });
    const contentPath = `${layout.renderDir}/content.md`;
    const reportHtmlPath = layout.defaultRenderEntrypoint;
    const indexHtmlPath = `${layout.renderDir}/index.html`;
    const pythonEntrypointPath = buildDocumentProjectPythonRenderEntrypoint(layout);
    const buildScript = this.buildAuthoredRenderScript({
      contentPath,
      reportHtmlPath,
      indexHtmlPath,
      template: authoredTemplate,
      projectPath: input.projectPath,
      format: input.format
    });
    const manifest = buildDocumentProjectManifest({
      layout,
      sourceKind: "authored_workspace_project",
      sourcePath: contentSource.sourcePath,
      projectSourcePath: contentPath,
      sourceFormat: "text",
      sourceMimeType: "text/markdown",
      sourceDisplayName: contentSource.sourceDisplayName,
      extractManifestPath: null,
      mimeType: "text/markdown"
    });
    await this.writeWorkspaceTextFile({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: `${input.requestId}:authored-manifest`,
      originChatId: input.originChatId,
      path: layout.projectManifestPath,
      content: `${JSON.stringify(manifest, null, 2)}\n`,
      mimeType: "application/json"
    });
    await this.writeWorkspaceTextFile({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: `${input.requestId}:authored-markdown`,
      originChatId: input.originChatId,
      path: contentPath,
      content: contentSource.markdown,
      mimeType: "text/markdown"
    });
    await this.writeWorkspaceTextFile({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: `${input.requestId}:authored-render-builder`,
      originChatId: input.originChatId,
      path: pythonEntrypointPath,
      content: buildScript,
      mimeType: "text/x-python"
    });
    // ADR-129 Addendum III: authored renders bind identical HTML from a single seeded
    // Python `markdown` engine for both pdf and docx. The visible render/report.html and
    // render/index.html sources are produced by build.py at render time (they remain
    // repairable, visible sources after the render), so the effective entrypoint is the
    // Python builder for BOTH formats — never a runtime JS-rendered HTML file.
    return pythonEntrypointPath;
  }

  private async resolveAuthoredRenderContentSource(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    content: string;
  }): Promise<AuthoredRenderContentSource> {
    if (!input.content.startsWith("/workspace/")) {
      return {
        markdown: input.content,
        sourcePath: null,
        sourceDisplayName: "content.md"
      };
    }
    const normalizedPath = this.normalizeWorkspacePath(input.content);
    if (normalizedPath === null || !/\.(md|markdown)$/i.test(normalizedPath)) {
      throw new Error(
        "document.content path must be an inline Markdown string or a valid /workspace/... .md/.markdown file."
      );
    }
    return {
      markdown: await this.readWorkspaceTextFile({
        bundle: input.bundle,
        sessionId: input.sessionId,
        requestId: input.requestId,
        path: normalizedPath
      }),
      sourcePath: normalizedPath,
      sourceDisplayName: this.basename(normalizedPath)
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
    reportHtmlPath: string;
    indexHtmlPath: string;
    template: NormalizedDocumentRenderTemplate;
    projectPath: string;
    format: "pdf" | "docx";
  }): string {
    const title = input.template.title ?? this.basename(input.projectPath);
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
      `REPORT_HTML_PATH = Path(${JSON.stringify(input.reportHtmlPath)})`,
      `INDEX_HTML_PATH = Path(${JSON.stringify(input.indexHtmlPath)})`,
      `OUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)`,
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
      "    REPORT_HTML_PATH.parent.mkdir(parents=True, exist_ok=True)",
      "    REPORT_HTML_PATH.write_text(full_html, encoding='utf-8')",
      "    INDEX_HTML_PATH.write_text(full_html, encoding='utf-8')",
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
      "    document = Document()",
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
      "    HTML(filename=str(REPORT_HTML_PATH)).write_pdf(str(OUTPUT_PATH))",
      "",
      "def build() -> None:",
      "    html_document = build_html_document()",
      "    if RENDER_FORMAT == 'pdf':",
      "        build_pdf()",
      "    else:",
      "        build_docx(html_document)",
      "",
      "if __name__ == '__main__':",
      "    build()",
      ""
    ].join("\n");
  }

  private async writeWorkspaceTextFile(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    originChatId: string | null;
    path: string;
    content: string;
    mimeType: string;
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
        action: "write",
        path: input.path,
        content: input.content,
        replace: true
      }
    } satisfies RuntimeSandboxJobRequest);
    if (job.status !== "completed" || typeof job.reason === "string") {
      throw new Error(
        job.warning ?? job.violationMessage ?? job.reason ?? `Could not write ${input.path}.`
      );
    }
    const writeOutcome = this.parseFilesWriteContent(job.content);
    const resolvedPath = writeOutcome.resolvedPath ?? input.path;
    try {
      await this.persaiInternalApiClientService.upsertWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: resolvedPath,
        mimeType: input.mimeType,
        sizeBytes: writeOutcome.sizeBytes ?? Buffer.byteLength(input.content, "utf8"),
        contentHash: createHash("sha256").update(input.content, "utf8").digest("hex"),
        replace: true,
        ...(input.originChatId === null
          ? {}
          : {
              originChatId: input.originChatId,
              originAssistantId: input.bundle.metadata.assistantId
            })
      });
    } catch {
      // Best-effort only: authored scaffolding stays usable even if the metadata mirror
      // upsert is temporarily unavailable, matching normal files.write behavior.
    }
    return resolvedPath;
  }

  private renderEntrypointMissingWarning(
    format: "pdf" | "xlsx" | "docx",
    projectPath: string,
    projectManifest: DocumentProjectManifestFacts | null
  ): string {
    if (
      format === "pdf" &&
      projectManifest?.sourceKind === "imported_workspace_file" &&
      (projectManifest.sourceFormat === "docx" || projectManifest.sourceFormat === "xlsx")
    ) {
      return `Imported ${projectManifest.sourceFormat.toUpperCase()} -> PDF export must go through document.render(format=pdf) on the extracted project. Do not pick or run a separate PDF conversion entrypoint.`;
    }
    if (format === "pdf") {
      return "document.render(format=pdf) requires a visible HTML entrypoint unless an explicit Python entrypoint is provided that writes the PDF to PERSAI_OUTPUT_PATH.";
    }
    if (
      projectManifest?.sourceKind === "imported_workspace_file" &&
      (projectManifest.sourceFormat === "docx" || projectManifest.sourceFormat === "xlsx") &&
      projectManifest.sourceFormat === format
    ) {
      return `Imported ${format.toUpperCase()} projects require a visible native Python entrypoint at ${buildDocumentProjectPythonRenderEntrypoint(
        buildDocumentWorkspaceProjectLayout(projectPath)
      )} or an explicit document.entrypoint under the project's render/ directory.`;
    }
    return "Could not resolve a visible Python entrypoint for document.render.";
  }

  private async resolvePdfHtmlSourceForRender(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    projectPath: string;
    entrypointPath: string;
    activeDocumentProjectPath: string | null;
    projectManifest: DocumentProjectManifestFacts | null;
  }): Promise<string> {
    const projectRoot =
      input.activeDocumentProjectPath !== null &&
      input.projectPath.replace(/\/+$/g, "") ===
        input.activeDocumentProjectPath.replace(/\/+$/g, "")
        ? input.activeDocumentProjectPath
        : input.projectPath.startsWith("/workspace/projects/")
          ? input.projectPath
          : null;
    if (
      projectRoot !== null &&
      input.projectManifest?.sourceKind === "imported_workspace_file" &&
      input.projectManifest.sourceFormat !== "pdf" &&
      input.projectManifest.sourceFormat !== "docx" &&
      input.projectManifest.sourceFormat !== "xlsx"
    ) {
      const layout = buildDocumentWorkspaceProjectLayout(projectRoot);
      const extractedPath = `${layout.extractDir}/extracted.md`;
      try {
        const extractedText = await this.readWorkspaceTextFile({
          bundle: input.bundle,
          sessionId: input.sessionId,
          requestId: input.requestId,
          path: extractedPath
        });
        if (extractedText.trim().length > 0) {
          const sourcePath = await this.readDocumentProjectSourcePath({
            bundle: input.bundle,
            sessionId: input.sessionId,
            requestId: input.requestId,
            projectPath: projectRoot
          });
          return buildDocumentProjectRenderScaffoldHtml({
            sourcePath,
            extractedText
          });
        }
      } catch {
        // Fall back to the visible HTML entrypoint when extract sidecars are unavailable.
      }
    }
    return this.readWorkspaceTextFile({
      bundle: input.bundle,
      sessionId: input.sessionId,
      requestId: input.requestId,
      path: input.entrypointPath
    });
  }

  private async readDocumentProjectSourcePath(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    projectPath: string;
  }): Promise<string> {
    try {
      const manifest = await this.readDocumentProjectManifestFactsOptional(input);
      if (manifest?.sourcePath != null) {
        return manifest.sourcePath;
      }
      if (manifest?.projectSourcePath != null) {
        return manifest.projectSourcePath;
      }
    } catch {
      // Fall back below.
    }
    return input.projectPath;
  }

  private async buildRenderProgramSource(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    projectPath: string;
    outputPath: string;
    entrypointPath: string;
    format: "pdf" | "xlsx" | "docx";
    activeDocumentProjectPath: string | null;
    projectManifest: DocumentProjectManifestFacts | null;
  }): Promise<string> {
    const loweredEntrypoint = input.entrypointPath.toLowerCase();
    if (loweredEntrypoint.endsWith(".html") || loweredEntrypoint.endsWith(".htm")) {
      const htmlSource = await this.resolvePdfHtmlSourceForRender({
        bundle: input.bundle,
        sessionId: input.sessionId,
        requestId: input.requestId,
        projectPath: input.projectPath,
        entrypointPath: input.entrypointPath,
        activeDocumentProjectPath: input.activeDocumentProjectPath,
        projectManifest: input.projectManifest
      });
      return [
        "import os",
        "from weasyprint import HTML",
        `project_dir = ${JSON.stringify(input.projectPath)}`,
        `output_path = ${JSON.stringify(input.outputPath)}`,
        `html_source = ${JSON.stringify(htmlSource)}`,
        "os.makedirs(os.path.dirname(output_path), exist_ok=True)",
        "HTML(string=html_source, base_url=project_dir).write_pdf(output_path)",
        "if not os.path.isfile(output_path):",
        '    raise FileNotFoundError(f"Rendered output was not created: {output_path}")'
      ].join("\n");
    }
    if (!loweredEntrypoint.endsWith(".py")) {
      throw new Error(
        "document.render currently supports HTML entrypoints for PDF and Python build/export entrypoints for workspace renders."
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
      "os.environ['PERSAI_OUTPUT_PATH'] = output_path",
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

  private async readDocumentProjectManifestFactsOptional(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    projectPath: string;
  }): Promise<DocumentProjectManifestFacts | null> {
    const layout = buildDocumentWorkspaceProjectLayout(input.projectPath);
    try {
      const manifestText = await this.readWorkspaceTextFile({
        bundle: input.bundle,
        sessionId: input.sessionId,
        requestId: input.requestId,
        path: layout.projectManifestPath
      });
      const manifest = JSON.parse(manifestText) as Record<string, unknown>;
      const sourceKind =
        manifest.sourceKind === "imported_workspace_file" ||
        manifest.sourceKind === "authored_workspace_project"
          ? manifest.sourceKind
          : null;
      const sourceFormat =
        manifest.sourceFormat === "pdf" ||
        manifest.sourceFormat === "docx" ||
        manifest.sourceFormat === "xlsx" ||
        manifest.sourceFormat === "csv" ||
        manifest.sourceFormat === "text" ||
        manifest.sourceFormat === "html" ||
        manifest.sourceFormat === "python" ||
        manifest.sourceFormat === "image" ||
        manifest.sourceFormat === "other"
          ? manifest.sourceFormat
          : null;
      return {
        sourceKind,
        sourcePath:
          typeof manifest.sourcePath === "string" && manifest.sourcePath.startsWith("/workspace/")
            ? manifest.sourcePath
            : null,
        projectSourcePath:
          typeof manifest.projectSourcePath === "string" &&
          manifest.projectSourcePath.startsWith("/workspace/")
            ? manifest.projectSourcePath
            : null,
        sourceFormat,
        defaultRenderEntrypoint:
          typeof manifest.defaultRenderEntrypoint === "string" &&
          manifest.defaultRenderEntrypoint.startsWith("/workspace/")
            ? manifest.defaultRenderEntrypoint
            : null,
        defaultPdfExportEntrypoint:
          typeof manifest.defaultPdfExportEntrypoint === "string" &&
          manifest.defaultPdfExportEntrypoint.startsWith("/workspace/")
            ? manifest.defaultPdfExportEntrypoint
            : null
      };
    } catch {
      return null;
    }
  }

  private resolveImportedNativeRenderWarning(input: {
    format: "pdf" | "xlsx" | "docx";
    projectManifest: DocumentProjectManifestFacts | null;
  }): string | null {
    if (
      input.projectManifest?.sourceKind !== "imported_workspace_file" ||
      (input.projectManifest.sourceFormat !== "pdf" &&
        input.projectManifest.sourceFormat !== "docx" &&
        input.projectManifest.sourceFormat !== "xlsx")
    ) {
      return null;
    }
    const visibleSourcePath =
      input.projectManifest.projectSourcePath ?? input.projectManifest.sourcePath ?? "unknown";
    if (input.projectManifest.sourceFormat === "pdf") {
      return (
        `document.render(format=${input.format}) cannot yet use a native source-preserving render ` +
        `engine for imported PDF projects. The visible native project source is ${visibleSourcePath}.`
      );
    }
    if (
      input.format === input.projectManifest.sourceFormat ||
      (input.format === "pdf" &&
        (input.projectManifest.sourceFormat === "docx" ||
          input.projectManifest.sourceFormat === "xlsx"))
    ) {
      return null;
    }
    return (
      `document.render(format=${input.format}) cannot yet export imported ${input.projectManifest.sourceFormat.toUpperCase()} ` +
      `projects through a native source-preserving engine. The visible native project source is ` +
      `${visibleSourcePath}. Only same-format ${input.projectManifest.sourceFormat.toUpperCase()} ` +
      "revision and the visible Office PDF export entrypoint are currently supported for this imported project."
    );
  }

  /**
   * ADR-129 P-2: resolve the seeded LibreOffice Office->PDF exporter entrypoint. The
   * engine for imported DOCX/XLSX -> PDF is fixed; if the visible `export_pdf.py`
   * exporter is not present in the project, the render is skipped honestly rather than
   * falling back to a different engine.
   */
  private async resolveImportedOfficePdfExportEntrypoint(input: {
    bundle: AssistantRuntimeBundle;
    projectPath: string;
    projectManifest: DocumentProjectManifestFacts;
  }): Promise<string | null> {
    const files = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
      workspaceId: input.bundle.metadata.workspaceId,
      pathPrefix: `${input.projectPath}/`,
      assistantHandle: input.bundle.metadata.assistantHandle,
      scope: "workspace_shared",
      currentChatId: null,
      currentAssistantId: input.bundle.metadata.assistantId
    });
    const filePaths = files.items.filter((item) => item.type === "file").map((item) => item.path);
    const layout = buildDocumentWorkspaceProjectLayout(input.projectPath);
    const preferredEntrypoints = [
      input.projectManifest.defaultPdfExportEntrypoint,
      buildDocumentProjectPdfExportEntrypoint(layout)
    ].filter((value, index, array): value is string => {
      return typeof value === "string" && value.length > 0 && array.indexOf(value) === index;
    });
    for (const preferred of preferredEntrypoints) {
      if (filePaths.includes(preferred)) {
        return preferred;
      }
    }
    return null;
  }

  /**
   * ADR-129 P-1: keep a render deliverable inside its document project. Outputs that
   * already live inside the project are respected as-is; outputs that escape the
   * project (e.g. workspace-root paths that then fail registration) are relocated into
   * the canonical `<project>/output/` directory under a meaningful filename derived
   * from the requested name, the escaped basename, the imported source basename, or
   * the project directory name.
   */
  private normalizeRenderOutputPath(input: {
    projectPath: string;
    outputPath: string;
    format: "pdf" | "xlsx" | "docx";
    requestedName: string | null;
    projectManifest: DocumentProjectManifestFacts | null;
  }): string {
    if (isWorkspacePathUnderPrefix(input.outputPath, input.projectPath)) {
      return input.outputPath;
    }
    const layout = buildDocumentWorkspaceProjectLayout(input.projectPath);
    const basename = this.deriveRenderOutputBasename({
      projectPath: input.projectPath,
      outputPath: input.outputPath,
      format: input.format,
      requestedName: input.requestedName,
      projectManifest: input.projectManifest
    });
    return `${layout.outputDir}/${basename}`;
  }

  private deriveRenderOutputBasename(input: {
    projectPath: string;
    outputPath: string;
    format: "pdf" | "xlsx" | "docx";
    requestedName: string | null;
    projectManifest: DocumentProjectManifestFacts | null;
  }): string {
    const escapedStem = this.stemOf(this.basename(input.outputPath));
    const importedSourceStem =
      input.projectManifest?.sourceKind === "imported_workspace_file"
        ? this.stemOf(
            this.basename(
              input.projectManifest.projectSourcePath ?? input.projectManifest.sourcePath ?? ""
            )
          )
        : "";
    const candidates: string[] = [
      this.sanitizeOutputStem(this.stemOf(input.requestedName)),
      this.isGenericOutputStem(escapedStem) ? "" : this.sanitizeOutputStem(escapedStem),
      this.sanitizeOutputStem(importedSourceStem),
      this.sanitizeOutputStem(this.basename(input.projectPath))
    ];
    for (const candidate of candidates) {
      if (candidate.length > 0) {
        return `${candidate}.${input.format}`;
      }
    }
    return `document.${input.format}`;
  }

  private stemOf(name: string | null): string {
    if (name === null) {
      return "";
    }
    const base = this.basename(name.trim());
    const dotIndex = base.lastIndexOf(".");
    return dotIndex > 0 ? base.slice(0, dotIndex) : base;
  }

  private sanitizeOutputStem(stem: string): string {
    return stem
      .trim()
      .replace(/[^\p{L}\p{N}._ -]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isGenericOutputStem(stem: string): boolean {
    const lowered = stem.trim().toLowerCase();
    if (lowered.length === 0) {
      return true;
    }
    return [
      "output",
      "document",
      "render",
      "build",
      "untitled",
      "file",
      "result",
      "temp",
      "tmp"
    ].includes(lowered);
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
    replace: boolean;
    originChatId: string | null;
  }): Promise<{ mimeType: string; sizeBytes: number; resolvedPath: string }> {
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
      path: attach.workspaceRelPath,
      mimeType: attach.mimeType,
      sizeBytes: attach.sizeBytes,
      replace: input.replace,
      ...(input.originChatId === null
        ? {}
        : {
            originChatId: input.originChatId,
            originAssistantId: input.bundle.metadata.assistantId
          })
    });
    return {
      resolvedPath: attach.workspaceRelPath,
      mimeType: attach.mimeType,
      sizeBytes: attach.sizeBytes
    };
  }

  private async resolveRenderOutputPath(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    outputPath: string;
    replace: boolean;
  }): Promise<string> {
    const job = await this.sandboxClientService!.waitForCompletion({
      assistantId: input.bundle.metadata.assistantId,
      assistantHandle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceId: input.bundle.metadata.workspaceId,
      runtimeRequestId: `${input.requestId}:resolve-output-path`,
      runtimeSessionId: input.sessionId,
      toolCode: "files",
      policy: this.buildInlineDocumentSandboxPolicy(input.bundle.runtime.sandbox),
      args: {
        action: "resolve_write_path",
        path: input.outputPath,
        replace: input.replace
      }
    } satisfies RuntimeSandboxJobRequest);
    if (job.status !== "completed" || typeof job.reason === "string") {
      throw new Error(
        job.warning ??
          job.violationMessage ??
          job.reason ??
          `Could not resolve ${input.outputPath} for document.render.`
      );
    }
    const resolvedPath = this.parseResolvedWritePathContent(job.content);
    if (resolvedPath === null) {
      throw new Error("Sandbox path resolution completed without a valid resolvedPath payload.");
    }
    return resolvedPath;
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

  private parseResolvedWritePathContent(content: string | null): string | null {
    if (content === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return typeof parsed.resolvedPath === "string" ? parsed.resolvedPath : null;
    } catch {
      return null;
    }
  }

  private parseFilesWriteContent(content: string | null): {
    sizeBytes: number | null;
    resolvedPath: string | null;
  } {
    const row = this.parseJsonObject(content);
    return {
      sizeBytes: typeof row?.sizeBytes === "number" ? row.sizeBytes : null,
      resolvedPath: typeof row?.resolvedPath === "string" ? row.resolvedPath : null
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

  private escapeCssContent(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\A ");
  }

  private toPythonLiteral(value: string | null): string {
    return value === null ? "None" : JSON.stringify(value);
  }
}
