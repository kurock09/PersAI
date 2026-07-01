import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  DEFAULT_RUNTIME_SANDBOX_POLICY,
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

    return this.buildInvalidDocumentArgumentsResult(
      'document.action must be "extract", "inspect", "render", or "register_version".'
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
      replace?: boolean;
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

    let entrypointPath: string;
    try {
      const resolvedEntrypoint = await this.resolveRenderEntrypoint({
        bundle: params.bundle,
        projectPath,
        format: params.request.format,
        entrypoint: params.request.entrypoint,
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
      if (entrypointPath === outputPath) {
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
      const importedOfficePdfEntrypointError = this.validateImportedOfficePdfEntrypoint({
        projectPath,
        format: params.request.format,
        projectManifest,
        entrypointPath
      });
      if (importedOfficePdfEntrypointError !== null) {
        return this.renderSkipped(
          params.request.format,
          "invalid_arguments",
          importedOfficePdfEntrypointError
        );
      }
      if (params.activeDocumentProjectPath !== null) {
        const layout = buildDocumentWorkspaceProjectLayout(params.activeDocumentProjectPath);
        const validationError = validateDocumentProjectRenderPaths({
          layout,
          projectPath,
          outputPath,
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
        outputPath,
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

    const autoRegister = await this.tryAutoRegisterRenderedVersion({
      bundle: params.bundle,
      conversation: params.conversation,
      sourceUserMessageText: params.sourceUserMessageText,
      sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt,
      projectPath,
      outputPath: persisted.resolvedPath
    });

    return {
      payload: {
        toolCode: "document",
        executionMode: "inline",
        requestedAction: "render",
        descriptorMode: autoRegister.registration?.descriptorMode ?? null,
        documentType: "workspace_document",
        provider: "sandbox",
        prompt: null,
        outputFormat: params.request.format,
        docId: autoRegister.registration?.docId ?? null,
        requestedName: this.basename(persisted.resolvedPath),
        artifacts: [],
        usage: null,
        action: "rendered",
        reason: null,
        warning: autoRegister.warning,
        render: {
          projectPath,
          outputPath: persisted.resolvedPath,
          format: params.request.format,
          entrypointPath,
          sizeBytes: persisted.sizeBytes,
          mimeType: persisted.mimeType
        },
        ...(autoRegister.registration === null
          ? {}
          : {
              versionId: autoRegister.registration.versionId,
              registration: autoRegister.registration
            })
      },
      artifacts: [],
      isError: false
    };
  }

  private async tryAutoRegisterRenderedVersion(input: {
    bundle: AssistantRuntimeBundle;
    conversation: {
      channel: "web" | "telegram";
      externalThreadKey: string;
    } | null;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
    projectPath: string;
    outputPath: string;
  }): Promise<{
    registration: RuntimeDocumentVersionRegistrationSummary | null;
    warning: string | null;
  }> {
    if (input.conversation === null) {
      return {
        registration: null,
        warning:
          "auto_register_skipped:no_conversation_context: version was not registered automatically because no chat conversation was resolved for this render. Delivery still works, but document/version metadata is missing."
      };
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
        inspectionPath: null
      });
      if (!outcome.accepted) {
        return {
          registration: null,
          warning: `auto_register_skipped:${outcome.code}: ${outcome.message}`
        };
      }
      return {
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
        registration: null,
        warning: `auto_register_skipped:runtime_degraded: ${
          error instanceof Error
            ? error.message
            : "Document version registration is temporarily unavailable."
        }`
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
      return {
        kind: "render",
        request: {
          projectPath,
          outputPath,
          format,
          entrypoint: this.readNonEmptyString(row.entrypoint),
          ...(row.replace === true ? { replace: true } : {})
        }
      };
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
        'document requires an explicit action such as "extract", "inspect", "render", or "register_version". Slide decks belong in the presentation tool.'
      );
    }
    return new Error(
      'document.action must be "extract", "inspect", "render", or "register_version".'
    );
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
    if (input.entrypoint !== null) {
      if (input.entrypoint.startsWith("/workspace/")) {
        return this.normalizeWorkspacePath(input.entrypoint);
      }
      return this.normalizeWorkspacePath(
        `${input.projectPath}/${input.entrypoint.replace(/^\.?\//, "")}`
      );
    }
    if (
      input.format === "pdf" &&
      input.projectManifest?.sourceKind === "imported_workspace_file" &&
      (input.projectManifest.sourceFormat === "docx" ||
        input.projectManifest.sourceFormat === "xlsx")
    ) {
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
      return `Imported ${projectManifest.sourceFormat.toUpperCase()} -> PDF export requires the visible Office PDF entrypoint ${buildDocumentProjectPdfExportEntrypoint(
        buildDocumentWorkspaceProjectLayout(projectPath)
      )}.`;
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

  private validateImportedOfficePdfEntrypoint(input: {
    projectPath: string;
    format: "pdf" | "xlsx" | "docx";
    projectManifest: DocumentProjectManifestFacts | null;
    entrypointPath: string;
  }): string | null {
    if (
      input.format !== "pdf" ||
      input.projectManifest?.sourceKind !== "imported_workspace_file" ||
      (input.projectManifest.sourceFormat !== "docx" &&
        input.projectManifest.sourceFormat !== "xlsx")
    ) {
      return null;
    }
    const layout = buildDocumentWorkspaceProjectLayout(input.projectPath);
    const expectedEntrypoint =
      input.projectManifest.defaultPdfExportEntrypoint ??
      buildDocumentProjectPdfExportEntrypoint(layout);
    if (input.entrypointPath === expectedEntrypoint) {
      return null;
    }
    return `Imported ${input.projectManifest.sourceFormat.toUpperCase()} -> PDF render must use the visible Office PDF export entrypoint ${expectedEntrypoint}.`;
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
}
