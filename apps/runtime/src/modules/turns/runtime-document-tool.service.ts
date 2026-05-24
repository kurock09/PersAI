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
      // Attachments captured from the user turn that triggered the tool call.
      // Forwarded into the document job so the worker can inline
      // text-extractable source-file content into the generation prompt.
      attachments: RuntimeAttachmentRef[];
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

    const sourceAttachments = this.selectSourceAttachmentsForRequest({
      attachments: params.deferToAsyncDocumentJob.attachments,
      descriptorMode: parsed.descriptorMode,
      prompt: parsed.request.prompt,
      sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText
    });
    const effectiveDescriptorMode = this.resolveEffectiveDescriptorMode({
      descriptorMode: parsed.descriptorMode,
      outputFormat: parsed.request.outputFormat ?? null,
      docId: parsed.request.docId ?? null,
      fileRef: parsed.request.fileRef ?? null,
      sourceAttachmentCount: sourceAttachments.length
    });
    const effectiveRequest =
      effectiveDescriptorMode === parsed.descriptorMode
        ? parsed.request
        : { ...parsed.request, docId: null };
    const normalizedRequest = this.normalizePresentationRequest({
      descriptorMode: effectiveDescriptorMode,
      request: effectiveRequest
    });
    const outputFormat = normalizedRequest.outputFormat ?? null;
    const documentType =
      outputFormat === "pptx" || effectiveDescriptorMode === "create_presentation"
        ? "presentation"
        : "pdf_document";
    const provider = documentType === "presentation" ? "gamma" : "pdfmonkey";
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
    try {
      const enqueueOutcome = await this.persaiInternalApiClientService.enqueueDeferredDocumentJob({
        assistantId: params.bundle.metadata.assistantId,
        sourceUserMessageId: params.deferToAsyncDocumentJob.sourceUserMessageId,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        attachments: sourceAttachments,
        directToolExecution: {
          toolCode: "document",
          descriptorMode: effectiveDescriptorMode,
          request: normalizedRequest
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
          descriptorMode: effectiveDescriptorMode,
          documentType: enqueueOutcome.documentType,
          provider,
          prompt: normalizedRequest.prompt,
          outputFormat: normalizedRequest.outputFormat ?? null,
          docId: normalizedRequest.docId ?? null,
          requestedName: normalizedRequest.requestedName ?? null,
          artifacts: [],
          usage: null,
          action: "deferred",
          reason: null,
          warning: null,
          jobId: enqueueOutcome.jobId
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
              : "Deferred document generation could not be enqueued.",
          jobId: null
        },
        artifacts: [],
        isError: false
      };
    }
  }

  private readDocumentArguments(value: unknown):
    | {
        descriptorMode:
          | "create_pdf_document"
          | "create_presentation"
          | "revise_document"
          | "export_or_redeliver";
        request: {
          prompt: string;
          instructions?: string | null;
          outputFormat?: "pdf" | "pptx" | null;
          docId?: string | null;
          /** ADR-097 Slice 4 — AssistantFile.id for cross-chat revise. */
          fileRef?: string | null;
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
      descriptorMode !== "export_or_redeliver"
    ) {
      return new Error(
        "document.descriptorMode must be create_pdf_document, create_presentation, revise_document, or export_or_redeliver."
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
      row.outputFormat === "pdf" || row.outputFormat === "pptx" ? row.outputFormat : null;
    return {
      descriptorMode,
      request: {
        prompt: row.prompt.trim(),
        instructions: typeof row.instructions === "string" ? row.instructions : null,
        outputFormat,
        docId: typeof row.docId === "string" ? row.docId : null,
        fileRef: typeof row.fileRef === "string" ? row.fileRef : null,
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

  private selectSourceAttachmentsForRequest(input: {
    attachments: RuntimeAttachmentRef[];
    descriptorMode:
      | "create_pdf_document"
      | "create_presentation"
      | "revise_document"
      | "export_or_redeliver";
    prompt: string;
    sourceUserMessageText: string;
  }): RuntimeAttachmentRef[] {
    if (input.attachments.length === 0) {
      return [];
    }
    const currentAttachments = input.attachments.filter((attachment) =>
      (attachment.aliases ?? []).some((alias) =>
        alias.toLowerCase().startsWith("current attachment #")
      )
    );
    if (currentAttachments.length > 0) {
      return currentAttachments;
    }
    if (
      (input.descriptorMode === "create_pdf_document" ||
        input.descriptorMode === "create_presentation") &&
      this.referencesPriorSourceAttachment(input.prompt, input.sourceUserMessageText)
    ) {
      return input.attachments.filter((attachment) =>
        (attachment.aliases ?? []).some((alias) =>
          alias.toLowerCase().startsWith("previous attachment #")
        )
      );
    }
    return [];
  }

  private resolveEffectiveDescriptorMode(input: {
    descriptorMode:
      | "create_pdf_document"
      | "create_presentation"
      | "revise_document"
      | "export_or_redeliver";
    outputFormat: "pdf" | "pptx" | null;
    docId: string | null;
    /** ADR-097 Slice 4 — treat a valid fileRef as a confirmed revise intent. */
    fileRef?: string | null;
    sourceAttachmentCount: number;
  }): "create_pdf_document" | "create_presentation" | "revise_document" | "export_or_redeliver" {
    if (input.descriptorMode !== "revise_document") {
      return input.descriptorMode;
    }
    // Valid docId OR fileRef present → proceed as revise_document regardless.
    if (input.docId !== null && UUID_REGEX.test(input.docId.trim())) {
      return input.descriptorMode;
    }
    if (
      input.fileRef !== null &&
      input.fileRef !== undefined &&
      UUID_REGEX.test(input.fileRef.trim())
    ) {
      return input.descriptorMode;
    }
    // ADR-097 Slice 2: for PDF revise without a valid docId, do NOT silently
    // convert to create_pdf_document. The API layer will resolve the latest
    // PDF document in the chat via latestRevisionContextForChat, and return
    // an honest error if none is found. Return revise_document as-is.
    if (input.outputFormat !== "pptx") {
      return input.descriptorMode;
    }
    // Presentation revise without a docId: keep the existing Gamma behaviour
    // (untouched in Slice 2) — fall through to create_presentation when there
    // are source attachments but no valid doc_id.
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
      | "export_or_redeliver";
    request: {
      prompt: string;
      instructions?: string | null;
      outputFormat?: "pdf" | "pptx" | null;
      docId?: string | null;
      fileRef?: string | null;
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
    fileRef?: string | null;
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
