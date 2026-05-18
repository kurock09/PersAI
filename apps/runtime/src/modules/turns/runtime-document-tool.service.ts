import { Injectable } from "@nestjs/common";
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
      sourceAttachmentCount: sourceAttachments.length
    });
    const effectiveRequest =
      effectiveDescriptorMode === parsed.descriptorMode
        ? parsed.request
        : { ...parsed.request, docId: null };
    const normalizedRequest = this.normalizePresentationRequest({
      descriptorMode: effectiveDescriptorMode,
      request: effectiveRequest,
      sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText
    });
    const outputFormat = normalizedRequest.outputFormat ?? null;
    const documentType =
      outputFormat === "pptx" || effectiveDescriptorMode === "create_presentation"
        ? "presentation"
        : "pdf_document";
    const provider = documentType === "presentation" ? "gamma" : "pdfmonkey";
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
          requestedName?: string | null;
          visualStyle?: PersaiRuntimePresentationVisualStyle | null;
          imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
          visualDensity?: PersaiRuntimePresentationVisualDensity | null;
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
        outline: row.outline,
        metadata
      }
    };
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
    sourceAttachmentCount: number;
  }): "create_pdf_document" | "create_presentation" | "revise_document" | "export_or_redeliver" {
    if (
      input.descriptorMode !== "revise_document" ||
      input.sourceAttachmentCount === 0 ||
      (input.docId !== null && UUID_REGEX.test(input.docId.trim()))
    ) {
      return input.descriptorMode;
    }
    return input.outputFormat === "pptx" ? "create_presentation" : "create_pdf_document";
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
      requestedName?: string | null;
      visualStyle?: PersaiRuntimePresentationVisualStyle | null;
      imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
      visualDensity?: PersaiRuntimePresentationVisualDensity | null;
      outline?: unknown;
      metadata?: Record<string, unknown> | null;
    };
    sourceUserMessageText: string;
  }): {
    prompt: string;
    instructions?: string | null;
    outputFormat?: "pdf" | "pptx" | null;
    docId?: string | null;
    requestedName?: string | null;
    visualStyle?: PersaiRuntimePresentationVisualStyle | null;
    imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
    visualDensity?: PersaiRuntimePresentationVisualDensity | null;
    outline?: unknown;
    metadata?: Record<string, unknown> | null;
  } {
    if (input.descriptorMode !== "create_presentation") {
      return input.request;
    }
    const combinedText = [
      input.sourceUserMessageText,
      input.request.prompt,
      input.request.instructions ?? ""
    ]
      .join("\n")
      .toLowerCase();
    const explicitPptx = this.explicitlyRequestsPptx(combinedText);
    const explicitTextOnly = this.explicitlyRequestsTextOnlyPresentation(combinedText);
    const explicitTextHeavy = this.explicitlyRequestsTextHeavyPresentation(combinedText);
    const schoolLike = this.isSchoolPresentationContext(combinedText);
    const normalizedRequest = { ...input.request };
    normalizedRequest.outputFormat = explicitPptx ? "pptx" : "pdf";
    if (input.request.imagePolicy === "text_only" && !explicitTextOnly) {
      normalizedRequest.imagePolicy = schoolLike ? "pictographic" : "ai_generated";
    }
    if (input.request.visualDensity === "text_heavy" && !explicitTextHeavy) {
      normalizedRequest.visualDensity = "balanced";
    }
    return normalizedRequest;
  }

  private explicitlyRequestsPptx(text: string): boolean {
    return (
      /\b(pptx|powerpoint|power point|editable deck|editable presentation|editable slides)\b/i.test(
        text
      ) ||
      /(?:именно|нужен|нужно|хочу|сделай|дай).{0,24}(pptx|powerpoint|паверпоинт)/i.test(text) ||
      /(редактируем\w*|исходн\w*).{0,24}(pptx|powerpoint|презент)/i.test(text)
    );
  }

  private explicitlyRequestsTextOnlyPresentation(text: string): boolean {
    return (
      /\b(text only|only text|no images|without images|without pictures)\b/i.test(text) ||
      /(без|только).{0,18}(картинок|изображени|иллюстрац|фото)/i.test(text) ||
      /(только|побольше).{0,18}текст/i.test(text)
    );
  }

  private explicitlyRequestsTextHeavyPresentation(text: string): boolean {
    return (
      /\b(text heavy|dense text|more text|detailed slides)\b/i.test(text) ||
      /(много|больше|побольше|подробн\w*).{0,18}текст/i.test(text) ||
      /больш.{0,18}количеств.{0,18}текст/i.test(text) ||
      /подробн\w*.{0,24}(слайды|презентац|дек)/i.test(text)
    );
  }

  private isSchoolPresentationContext(text: string): boolean {
    return (
      /\b(school|student|class|grade|lesson|teacher|biology|history|geography|homework)\b/i.test(
        text
      ) || /(ученик|ученица|школ|класс|урок|биолог|истор|географ|домашн)/i.test(text)
    );
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
