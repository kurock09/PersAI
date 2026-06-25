import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimePresentationImagePolicy,
  PersaiRuntimePresentationVisualDensity,
  PersaiRuntimePresentationVisualStyle,
  ProviderGatewayToolCall,
  RuntimeAttachmentRef,
  RuntimeDocumentToolResult,
  RuntimeOutputArtifact
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RuntimeDocumentToolExecutionResult {
  payload: RuntimeDocumentToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeDocumentToolService {
  private readonly logger = new Logger(RuntimeDocumentToolService.name);

  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
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
          executionMode: "worker",
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
