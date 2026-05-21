import { Injectable } from "@nestjs/common";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";
import {
  KnowledgeDocumentProcessingPolicyError,
  resolveKnowledgeDocumentProcessorEscalation,
  resolveKnowledgeDocumentProcessorSelection
} from "./knowledge-document-processing-policy";
import {
  normalizeDocumentProcessingPolicyRecord,
  toDocumentProcessingSecretStorageKey
} from "./document-processing-settings";
import { PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID } from "./platform-runtime-provider-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import type {
  KnowledgeDocumentProcessingInput,
  KnowledgeDocumentProcessingResult,
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderKey,
  KnowledgeProcessingProviderTrace
} from "./knowledge-processing.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";
import type { RuntimeBillingFacts } from "@persai/runtime-contract";

type PdfParseLegacyModule = (
  buffer: Buffer,
  options?: { max?: number }
) => Promise<{ text?: string }>;

type PdfParseV2Module = {
  PDFParse: new (options: { data: Buffer }) => {
    getText(): Promise<{ text?: string } | string>;
    destroy(): Promise<void> | void;
  };
};

@Injectable()
export class DocumentExtractionService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly mediaPreprocessorService: MediaPreprocessorService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService
  ) {}

  async extract(
    input: KnowledgeDocumentProcessingInput
  ): Promise<KnowledgeDocumentProcessingResult> {
    const policy = await this.loadPolicy();
    const providerAvailability = await this.loadProviderAvailability(policy);
    const selection = resolveKnowledgeDocumentProcessorSelection({
      content: input.content,
      requestedMode: input.requestedMode ?? "auto",
      policy,
      providerAvailability
    });

    let providerTrace: KnowledgeProcessingProviderTrace = {
      providerKey: selection.providerKey,
      processorMode: selection.processorMode,
      attemptedProviderKeys: [selection.providerKey]
    };
    let firstAttempt: { normalizedText: string; markdown: string | null };
    try {
      firstAttempt = await this.extractWithSelection(input, selection.providerKey);
    } catch (error) {
      const fallbackAttempt = await this.extractWithLocalFallbackAfterProviderError({
        input,
        failedProviderKey: selection.providerKey,
        policy,
        providerAvailability
      });
      if (fallbackAttempt === null) {
        throw error;
      }
      firstAttempt = fallbackAttempt.result;
      providerTrace = {
        providerKey: "local",
        processorMode: "local",
        attemptedProviderKeys: [selection.providerKey, "local"]
      };
    }
    let quality = buildExtractionQuality(firstAttempt.normalizedText, providerTrace.providerKey);
    let selectedText = firstAttempt.normalizedText;
    let selectedMarkdown = firstAttempt.markdown;
    let selectionReasonCode = selection.reasonCode;

    const escalation = resolveKnowledgeDocumentProcessorEscalation({
      previousSelection: selection,
      quality,
      policy,
      providerAvailability
    });

    if (escalation !== null) {
      const fallbackAttempt = await this.extractWithSelection(input, escalation.providerKey);
      const fallbackQuality = buildExtractionQuality(
        fallbackAttempt.normalizedText,
        escalation.providerKey
      );
      providerTrace = {
        providerKey: escalation.providerKey,
        processorMode: escalation.processorMode,
        attemptedProviderKeys: [selection.providerKey, escalation.providerKey]
      };
      quality = fallbackQuality;
      selectedText = fallbackAttempt.normalizedText;
      selectedMarkdown = fallbackAttempt.markdown;
      selectionReasonCode = escalation.reasonCode;
    }

    return {
      normalizedText: selectedText,
      markdown: selectedMarkdown,
      provider: providerTrace,
      quality,
      metadata: {
        selectionReasonCode,
        sourceType: input.source.sourceType,
        sourceId: input.source.sourceId,
        sourceVersion: input.source.sourceVersion,
        provenance: input.source.provenance
      }
    };
  }

  private async extractWithLocalFallbackAfterProviderError(input: {
    input: KnowledgeDocumentProcessingInput;
    failedProviderKey: KnowledgeProcessingProviderKey;
    policy: Awaited<ReturnType<DocumentExtractionService["loadPolicy"]>>;
    providerAvailability: Awaited<
      ReturnType<DocumentExtractionService["loadProviderAvailability"]>
    >;
  }): Promise<{ result: { normalizedText: string; markdown: string | null } } | null> {
    if (
      input.failedProviderKey === "local" ||
      !input.policy.localFallbackEnabled ||
      !input.providerAvailability.local.enabled ||
      !input.providerAvailability.local.configured ||
      !isLocalExtractableContent(input.input.content)
    ) {
      return null;
    }
    const normalizedText = await this.extractLocalText(input.input);
    return {
      result: {
        normalizedText,
        markdown: null
      }
    };
  }

  private async loadPolicy() {
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { documentProcessingPolicy: true }
    });
    return normalizeDocumentProcessingPolicyRecord(row?.documentProcessingPolicy ?? null);
  }

  private async loadProviderAvailability(policy: Awaited<ReturnType<typeof this.loadPolicy>>) {
    const keyMetadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
      toDocumentProcessingSecretStorageKey("mistral"),
      toDocumentProcessingSecretStorageKey("llamaparse")
    ]);
    return {
      local: {
        enabled: policy.localFallbackEnabled || policy.defaultProvider === "local",
        configured: true
      },
      mistral: {
        enabled:
          policy.defaultProvider === "mistral" || policy.highQualityFallbackProvider === "mistral",
        configured: keyMetadata.document_processing_mistral?.configured === true
      },
      llamaparse: {
        enabled:
          policy.defaultProvider === "llamaparse" ||
          policy.highQualityFallbackProvider === "llamaparse",
        configured: keyMetadata.document_processing_llamaparse?.configured === true
      }
    };
  }

  private async extractWithSelection(
    input: KnowledgeDocumentProcessingInput,
    providerKey: KnowledgeProcessingProviderKey
  ): Promise<{ normalizedText: string; markdown: string | null }> {
    if (providerKey === "local") {
      const normalizedText = await this.extractLocalText(input);
      return { normalizedText, markdown: null };
    }
    if (input.content.kind === "text") {
      return { normalizedText: input.content.text.trim(), markdown: input.content.text.trim() };
    }
    if (input.content.kind === "external_reference") {
      throw new Error("External reference document processing is not implemented yet.");
    }
    const bytesInput = { ...input, content: input.content };
    const apiKey = await this.loadRemoteProviderKey(providerKey);
    if (providerKey === "mistral") {
      return this.extractWithMistral(bytesInput, apiKey);
    }
    return this.extractWithLlamaParse(bytesInput, apiKey);
  }

  private async loadRemoteProviderKey(
    providerKey: Exclude<KnowledgeProcessingProviderKey, "local">
  ) {
    const apiKey =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        toDocumentProcessingSecretStorageKey(providerKey)
      );
    if (apiKey === null || apiKey.trim().length === 0) {
      throw new KnowledgeDocumentProcessingPolicyError(
        "needs_key",
        `Document processor provider '${providerKey}' is not configured.`,
        providerKey
      );
    }
    return apiKey.trim();
  }

  private async extractLocalText(input: KnowledgeDocumentProcessingInput): Promise<string> {
    if (input.content.kind === "text") {
      return normalizeExtractedText(input.content.text);
    }

    if (input.content.kind === "external_reference") {
      throw new Error("External reference processing requires a provider-backed processor.");
    }

    const mime = normalizeMime(input.content.mimeType);
    if (isTextLikeMime(mime)) {
      return normalizeExtractedText(input.content.buffer.toString("utf8"));
    }
    if (mime === "application/pdf" || mime === "application/x-pdf") {
      return normalizeExtractedText(await parsePdfBuffer(input.content.buffer));
    }
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return normalizeExtractedText(await extractDocxText(input.content.buffer));
    }

    const preprocessed = await this.mediaPreprocessorService.process(
      input.content.buffer,
      input.content.mimeType,
      input.content.originalFilename
    );
    return preprocessed.textExtract?.trim() ?? "";
  }

  private async extractWithMistral(
    input: KnowledgeDocumentProcessingInput & { content: { kind: "bytes" } },
    apiKey: string
  ): Promise<{ normalizedText: string; markdown: string | null }> {
    const uploaded = await postMultipartJson("https://api.mistral.ai/v1/files", apiKey, {
      file: {
        buffer: input.content.buffer,
        filename: input.content.originalFilename,
        mimeType: input.content.mimeType
      },
      fields: { purpose: "ocr" }
    });
    const fileId = readRequiredString(uploaded, ["id"], "Mistral file id");
    const signedUrlPayload = await getJson(
      `https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}/url?expiry=24`,
      apiKey
    );
    const signedUrl =
      readOptionalString(signedUrlPayload, ["url"]) ??
      readOptionalString(signedUrlPayload, ["signed_url"]);
    if (signedUrl === null) {
      throw new Error("Mistral OCR signed URL response did not include a URL.");
    }
    const ocrResult = await postJson("https://api.mistral.ai/v1/ocr", apiKey, {
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        document_url: signedUrl
      },
      include_image_base64: false
    });
    const markdown = readMistralMarkdown(ocrResult);
    const occurredAt = new Date().toISOString();
    const billingFacts: RuntimeBillingFacts = {
      providerKey: "mistral",
      modelKey: "mistral-ocr-latest",
      capability: "ocr_or_document_parsing",
      occurredAt,
      metering: {
        meteringKind: "operation_metered",
        operationCount: 1,
        dimensions: { operation: "ocr", processor: "mistral" }
      }
    };
    await this.appendOcrLedgerFromBillingFacts({
      source: input.source,
      billingFacts,
      occurredAt
    });
    return { normalizedText: normalizeExtractedText(markdown), markdown };
  }

  private async appendOcrLedgerFromBillingFacts(input: {
    source: KnowledgeDocumentProcessingInput["source"];
    billingFacts: RuntimeBillingFacts;
    occurredAt: string;
  }): Promise<void> {
    const workspaceId = input.source.workspaceId;
    const assistantId = input.source.assistantId ?? null;
    if (workspaceId === null || assistantId === null) {
      return;
    }
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: { userId: true }
    });
    if (assistant === null) {
      return;
    }
    try {
      await this.recordModelCostLedgerService.recordPersistedBillingFactsEvent({
        workspaceId,
        assistantId,
        userId: assistant.userId,
        surface: "background",
        source: "knowledge_document_ocr",
        sourceEventId: `knowledge_source:${input.source.sourceType}:${input.source.sourceId}:ocr`,
        billingFacts: input.billingFacts
      });
    } catch {
      // Non-blocking OCR ledger append; extraction success must not depend on economics writes.
    }
  }

  private async extractWithLlamaParse(
    input: KnowledgeDocumentProcessingInput & { content: { kind: "bytes" } },
    apiKey: string
  ): Promise<{ normalizedText: string; markdown: string | null }> {
    const uploadResult = await postMultipartJson(
      "https://api.cloud.llamaindex.ai/api/v2/parse/upload",
      apiKey,
      {
        file: {
          buffer: input.content.buffer,
          filename: input.content.originalFilename,
          mimeType: input.content.mimeType
        },
        fields: {
          configuration: JSON.stringify({
            tier: "agentic",
            version: "latest",
            output_options: {
              markdown: {
                annotate_links: true,
                tables: { compact_markdown_tables: true }
              }
            }
          })
        }
      }
    );
    const jobId =
      readOptionalString(uploadResult, ["job", "id"]) ??
      readRequiredString(uploadResult, ["id"], "LlamaParse job id");
    const result = await pollLlamaParseResult(jobId, apiKey);
    const markdown = readLlamaParseMarkdown(result);
    return { normalizedText: normalizeExtractedText(markdown), markdown };
  }
}

function buildExtractionQuality(
  normalizedText: string,
  providerKey: KnowledgeProcessingProviderKey
): KnowledgeExtractionQuality {
  const textChars = normalizedText.length;
  if (textChars === 0) {
    return {
      status: "poor",
      score: 0,
      reasonCodes: ["empty_text_extract"],
      textChars,
      metadata: { providerKey }
    };
  }

  const garbageRatio = estimateGarbageCharacterRatio(normalizedText);
  if (garbageRatio > 0.3) {
    return {
      status: "needs_review",
      score: 0.45,
      reasonCodes: ["garbage_text_ratio_high"],
      textChars,
      metadata: { garbageRatio, providerKey }
    };
  }

  return {
    status: "ok",
    score: 0.8,
    reasonCodes: [],
    textChars,
    metadata: { garbageRatio, providerKey }
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

async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParseModule = require("pdf-parse") as PdfParseLegacyModule | PdfParseV2Module;
  if (typeof pdfParseModule === "function") {
    const result = await pdfParseModule(buffer, { max: 100 });
    return result.text ?? "";
  }
  if (typeof pdfParseModule.PDFParse !== "function") {
    throw new Error("pdf-parse module does not expose a supported parser API.");
  }
  const parser = new pdfParseModule.PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return typeof result === "string" ? result : (result.text ?? "");
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require("mammoth") as {
    extractRawText(input: { buffer: Buffer }): Promise<{ value?: string }>;
  };
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return readJsonResponse(response, url);
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` }
  });
  return readJsonResponse(response, url);
}

async function postMultipartJson(
  url: string,
  apiKey: string,
  input: {
    file: { buffer: Buffer; filename: string; mimeType: string };
    fields: Record<string, string>;
  }
): Promise<unknown> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.file.buffer)], { type: input.file.mimeType }),
    input.file.filename
  );
  for (const [key, value] of Object.entries(input.fields)) {
    form.append(key, value);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form
  });
  return readJsonResponse(response, url);
}

async function readJsonResponse(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      text.trim().length > 0
        ? `Document processor request failed (${response.status}) ${url}: ${text.trim()}`
        : `Document processor request failed (${response.status}) ${url}`
    );
  }
  return text.trim().length === 0 ? {} : JSON.parse(text);
}

async function pollLlamaParseResult(jobId: string, apiKey: string): Promise<unknown> {
  const deadline = Date.now() + 15 * 60 * 1000;
  let lastStatus = "PENDING";
  while (Date.now() < deadline) {
    const result = await getJson(
      `https://api.cloud.llamaindex.ai/api/v2/parse/${encodeURIComponent(
        jobId
      )}?expand=markdown_full,markdown,job_metadata`,
      apiKey
    );
    const job = readObject(result, ["job"]);
    const status = readOptionalString(job ?? result, ["status"]) ?? lastStatus;
    lastStatus = status;
    if (status === "COMPLETED") {
      return result;
    }
    if (status === "FAILED" || status === "CANCELLED") {
      const errorMessage =
        readOptionalString(job ?? result, ["error_message"]) ?? `LlamaParse job ${status}.`;
      throw new Error(errorMessage);
    }
    await delay(2_000);
  }
  throw new Error(`LlamaParse job did not complete in time (last status: ${lastStatus}).`);
}

function readMistralMarkdown(payload: unknown): string {
  const pages = readArray(payload, ["pages"]);
  return pages
    .map((page) => readOptionalString(page, ["markdown"]) ?? "")
    .filter((page) => page.trim().length > 0)
    .join("\n\n")
    .trim();
}

function readLlamaParseMarkdown(payload: unknown): string {
  const markdownFull = readOptionalString(payload, ["markdown_full"]);
  if (markdownFull !== null) {
    return markdownFull.trim();
  }
  const markdown = readObject(payload, ["markdown"]);
  const pages = readArray(markdown ?? payload, ["pages"]);
  return pages
    .map((page) => readOptionalString(page, ["markdown"]) ?? "")
    .filter((page) => page.trim().length > 0)
    .join("\n\n")
    .trim();
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

function isTextLikeMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/x-ndjson" ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    mime === "application/yaml"
  );
}

function isLocalExtractableContent(content: KnowledgeDocumentProcessingInput["content"]): boolean {
  if (content.kind === "text") {
    return true;
  }
  if (content.kind !== "bytes") {
    return false;
  }
  const mime = normalizeMime(content.mimeType);
  return (
    isTextLikeMime(mime) ||
    mime === "application/pdf" ||
    mime === "application/x-pdf" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function readRequiredString(payload: unknown, path: string[], label: string): string {
  const value = readOptionalString(payload, path);
  if (value === null) {
    throw new Error(`${label} is missing from document processor response.`);
  }
  return value;
}

function readOptionalString(payload: unknown, path: string[]): string | null {
  let value = payload;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readObject(payload: unknown, path: string[]): Record<string, unknown> | null {
  let value = payload;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(payload: unknown, path: string[]): unknown[] {
  let value = payload;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    value = (value as Record<string, unknown>)[key];
  }
  return Array.isArray(value) ? value : [];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
