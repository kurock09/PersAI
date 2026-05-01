import { Injectable } from "@nestjs/common";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";
import {
  LOCAL_ONLY_DOCUMENT_PROVIDER_AVAILABILITY,
  resolveKnowledgeDocumentProcessorSelection
} from "./knowledge-document-processing-policy";
import type {
  KnowledgeDocumentProcessingInput,
  KnowledgeDocumentProcessingResult,
  KnowledgeDocumentProcessor,
  KnowledgeExtractionQuality
} from "./knowledge-processing.types";

@Injectable()
export class KnowledgeDocumentProcessorService implements KnowledgeDocumentProcessor {
  constructor(private readonly mediaPreprocessorService: MediaPreprocessorService) {}

  async process(
    input: KnowledgeDocumentProcessingInput
  ): Promise<KnowledgeDocumentProcessingResult> {
    const selection = resolveKnowledgeDocumentProcessorSelection({
      content: input.content,
      requestedMode: input.requestedMode ?? "local",
      providerAvailability: LOCAL_ONLY_DOCUMENT_PROVIDER_AVAILABILITY
    });

    if (selection.providerKey !== "local") {
      throw new Error(
        `Document processor provider '${selection.providerKey}' is not implemented in this boundary slice.`
      );
    }

    const normalizedText = await this.extractLocalText(input);
    const quality = buildLocalExtractionQuality(normalizedText);
    return {
      normalizedText,
      markdown: null,
      provider: {
        providerKey: "local",
        processorMode: selection.processorMode,
        attemptedProviderKeys: ["local"]
      },
      quality,
      metadata: {
        selectionReasonCode: selection.reasonCode,
        sourceType: input.source.sourceType,
        sourceId: input.source.sourceId,
        sourceVersion: input.source.sourceVersion,
        provenance: input.source.provenance
      }
    };
  }

  private async extractLocalText(input: KnowledgeDocumentProcessingInput): Promise<string> {
    if (input.content.kind === "text") {
      return input.content.text.trim();
    }

    if (input.content.kind === "external_reference") {
      throw new Error("External reference processing requires a provider-backed processor.");
    }

    const preprocessed = await this.mediaPreprocessorService.process(
      input.content.buffer,
      input.content.mimeType,
      input.content.originalFilename,
      { enableDocumentVisualFallback: true }
    );
    return preprocessed.textExtract?.trim() ?? "";
  }
}

function buildLocalExtractionQuality(normalizedText: string): KnowledgeExtractionQuality {
  const textChars = normalizedText.length;
  if (textChars === 0) {
    return {
      status: "poor",
      score: 0,
      reasonCodes: ["empty_text_extract"],
      textChars
    };
  }

  const garbageRatio = estimateGarbageCharacterRatio(normalizedText);
  if (garbageRatio > 0.3) {
    return {
      status: "needs_review",
      score: 0.45,
      reasonCodes: ["garbage_text_ratio_high"],
      textChars,
      metadata: { garbageRatio }
    };
  }

  return {
    status: "ok",
    score: 0.8,
    reasonCodes: [],
    textChars,
    metadata: { garbageRatio }
  };
}

function estimateGarbageCharacterRatio(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  const garbageChars = Array.from(text).filter((char) => {
    const code = char.charCodeAt(0);
    return (code >= 0 && code <= 8) || (code >= 14 && code <= 31);
  });
  return garbageChars.length / text.length;
}
