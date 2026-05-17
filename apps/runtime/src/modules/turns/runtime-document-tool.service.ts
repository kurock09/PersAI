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

    const outputFormat = parsed.request.outputFormat ?? null;
    const documentType =
      outputFormat === "pptx" || parsed.descriptorMode === "create_presentation"
        ? "presentation"
        : "pdf_document";
    const provider = documentType === "presentation" ? "gamma" : "pdfmonkey";
    try {
      const enqueueOutcome = await this.persaiInternalApiClientService.enqueueDeferredDocumentJob({
        assistantId: params.bundle.metadata.assistantId,
        sourceUserMessageId: params.deferToAsyncDocumentJob.sourceUserMessageId,
        sourceUserMessageText: params.deferToAsyncDocumentJob.sourceUserMessageText,
        attachments: params.deferToAsyncDocumentJob.attachments,
        directToolExecution: {
          toolCode: "document",
          descriptorMode: parsed.descriptorMode,
          request: parsed.request
        }
      });
      if (!enqueueOutcome.accepted) {
        return {
          payload: {
            toolCode: "document",
            executionMode: "worker",
            descriptorMode: parsed.descriptorMode,
            documentType,
            provider,
            prompt: parsed.request.prompt,
            outputFormat: parsed.request.outputFormat ?? null,
            docId: parsed.request.docId ?? null,
            requestedName: parsed.request.requestedName ?? null,
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
          descriptorMode: parsed.descriptorMode,
          documentType: enqueueOutcome.documentType,
          provider,
          prompt: parsed.request.prompt,
          outputFormat: parsed.request.outputFormat ?? null,
          docId: parsed.request.docId ?? null,
          requestedName: parsed.request.requestedName ?? null,
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
          descriptorMode: parsed.descriptorMode,
          documentType,
          provider,
          prompt: parsed.request.prompt,
          outputFormat: parsed.request.outputFormat ?? null,
          docId: parsed.request.docId ?? null,
          requestedName: parsed.request.requestedName ?? null,
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
}
