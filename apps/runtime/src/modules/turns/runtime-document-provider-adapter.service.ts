import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import type {
  PersaiRuntimeModelRole,
  ProviderGatewayTextGenerateRequest,
  RuntimeDocumentJobRunRequest,
  RuntimeDocumentJobRunResult,
  RuntimeDocumentSourceFile,
  RuntimeOutputArtifact,
  RuntimeSandboxJobResult,
  RuntimeSandboxPolicy,
  RuntimeSandboxProducedFile,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import {
  ProviderGatewayClientService,
  ProviderGatewayTimeoutError
} from "./provider-gateway.client.service";
import {
  applySectionPatches,
  buildStructureFromExtractedText,
  buildStructureFromRenderedHtml,
  createDefaultStyleProfile,
  createTransformStyleProfile,
  extractStructurePlainText,
  LARGE_DOCUMENT_STRUCTURE_THRESHOLD_BYTES,
  mergeStyleProfile,
  parsePersaiDocumentStructureSnapshot,
  parsePersaiDocumentStyleProfile,
  renderStructureToHtml,
  resolveEditStrategyForCreate,
  shouldUseStructuredDocumentPath,
  type PersaiDocumentEditStrategy,
  type PersaiDocumentInternalOperation,
  type PersaiDocumentStructureSnapshot,
  type PersaiDocumentStyleProfile,
  PERSAI_DOCUMENT_STRUCTURE_VERSION
} from "./persai-document-structure";
import { resolveModelOutputBudget } from "./model-output-budget";
import { SandboxClientService } from "./sandbox-client.service";
import { writeRuntimeOutboundArtifact } from "./write-runtime-outbound-artifact";

type SupportedDocumentProvider = "sandbox" | "gamma";
type NativeManagedProvider = "openai" | "anthropic";
type ProviderSelection = { provider: NativeManagedProvider; model: string };

type DocumentContentIntent = "preserve_content" | "rewrite_content";
class DocumentPdfPatchReviseInvalidEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPdfPatchReviseInvalidEnvelopeError";
  }
}

class DocumentPdfPatchReviseSearchNotFoundError extends Error {
  readonly patchIndex: number;
  readonly excerpt: string;
  constructor(patchIndex: number, excerpt: string) {
    super(
      `Patch #${String(patchIndex)}: search block not found in current HTML. Excerpt: ${excerpt}`
    );
    this.name = "DocumentPdfPatchReviseSearchNotFoundError";
    this.patchIndex = patchIndex;
    this.excerpt = excerpt;
  }
}

class DocumentPdfPatchReviseSearchAmbiguousError extends Error {
  readonly patchIndex: number;
  readonly excerpt: string;
  constructor(patchIndex: number, excerpt: string) {
    super(
      `Patch #${String(patchIndex)}: search block matches more than once in current HTML. Excerpt: ${excerpt}`
    );
    this.name = "DocumentPdfPatchReviseSearchAmbiguousError";
    this.patchIndex = patchIndex;
    this.excerpt = excerpt;
  }
}

interface Parse5Node {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  namespaceURI?: string;
  childNodes?: Parse5Node[];
  parentNode?: Parse5Node | null;
  value?: string;
}

interface Parse5Document extends Parse5Node {
  mode?: string;
}
function mergeUsageSnapshots(
  current: RuntimeUsageSnapshot | null,
  next: RuntimeUsageSnapshot | null
): RuntimeUsageSnapshot | null {
  if (current === null) return next;
  if (next === null) return current;
  const sum = (left: number | null, right: number | null): number | null =>
    left === null && right === null ? null : (left ?? 0) + (right ?? 0);
  return {
    providerKey: current.providerKey ?? next.providerKey,
    modelKey: current.modelKey ?? next.modelKey,
    inputTokens: sum(current.inputTokens, next.inputTokens),
    cacheCreationInputTokens: sum(
      current.cacheCreationInputTokens ?? null,
      next.cacheCreationInputTokens ?? null
    ),
    cachedInputTokens: sum(current.cachedInputTokens ?? null, next.cachedInputTokens ?? null),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens)
  };
}

const DEFAULT_DOCUMENT_TIMEOUT_MS = 6 * 60 * 1000;
// ADR-097 Slice 3: per-request timeout hint for document LLM generation calls that may
// produce up to 64k output tokens. Applied to document_html_generation, document_pdf_outline,
// and document_pdf_patch_revise. Section generation keeps the default 90s since each
// section is small (~1-2k tokens).
const DOCUMENT_CLASSIFICATION_TIMEOUT_MS = 240_000;
// Output-token ceiling for document generation is resolved per-model from the
// runtime bundle modelSlots via resolveModelOutputBudget. OUTPUT_BUDGET_MAX
// from model-output-budget.ts is the ultimate sanity clamp.
// Route to the chunked pipeline when the job has source attachments AND the
// total inlined source text exceeds this threshold. Simple v1 rule: purely
// based on objective attachment bytes, no keyword/prompt-text heuristics.
// NOTE: Chunked pipeline was removed in ADR-123 Slice 5; threshold kept for future use.
const DOCUMENT_PDF_MAX_RENDER_ATTEMPTS = 3;
const PDF_VALIDATION_MIN_BYTES = 1_024;
const PDF_VALIDATION_MIN_TEXT_LENGTH = 80;
const PDF_VALIDATION_MIN_ALNUM_COUNT = 24;
const DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH = 120;
// ADR-123 Slice 6 — mode B PDF text-layer probe. A digital PDF yields
// hundreds+ of alphanumeric characters; a scanned PDF yields ~none. Below this
// alnum count the worker treats the PDF as scanned and provides an OCR sidecar.
const DATA_DOC_PDF_TEXT_LAYER_MIN_ALNUM = 32;
const PDF_VALIDATION_TAIL_INSPECTION_BYTES = 2_048;
// Truncation detection: if single-shot HTML body text is below this fraction
// of the minimum expected envelope, treat it as a truncated response even when
// the provider did not report finish_reason=length.
const TRUNCATION_BODY_TEXT_FRACTION = 0.5;

// Enhanced print CSS: restrained editorial typography + WeasyPrint/Chromium pagination rules.
// Key behaviors:
// - @page sets A4 size + margins and shows "page N / total" in the footer.
// - thead { display: table-header-group } repeats <thead> on every printed page.
// - tr { break-inside: avoid } keeps rows intact when possible.
// - p { orphans: 3; widows: 3 } reduces orphan/widow lines.
// - h1..h6 { break-after: avoid } keeps headings with the content that follows.
// - .cover-page / .title-page { break-after: page } isolates cover pages.
// - .keep-together / .card / blockquote / callouts stay on one page when small.
// - section rhythm + first-child margin reset reduce awkward top offsets after breaks.
const DOCUMENT_HTML_ENHANCED_PRINT_CSS = [
  "@page{size:A4;margin:2cm 1.8cm;}",
  '@page{@bottom-center{content:counter(page) " / " counter(pages);font-size:9pt;color:#64748b;}}',
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1e293b;background:#fff;line-height:1.55;}',
  "h1{font-size:26pt;font-weight:700;letter-spacing:-0.02em;color:#0f172a;margin:0 0 14pt;padding-bottom:8pt;border-bottom:1pt solid #e2e8f0;}",
  "h2{font-size:17pt;font-weight:600;color:#0f172a;margin:22pt 0 8pt;}",
  "h3{font-size:13.5pt;font-weight:600;color:#1e293b;margin:16pt 0 6pt;}",
  "h4,h5,h6{font-size:11.5pt;font-weight:600;color:#334155;margin:12pt 0 4pt;}",
  "p,li{font-size:11pt;margin:7pt 0;}",
  "ul,ol{padding-left:20pt;margin:8pt 0;}",
  "li{margin:4pt 0;}",
  "strong,b{color:#0f172a;}",
  "a{color:#2563eb;text-decoration:none;}",
  "table{border-collapse:collapse;width:100%;margin:14pt 0;}",
  "th,td{border:1px solid #dbe3ee;padding:7pt 10pt;text-align:left;font-size:10pt;vertical-align:top;}",
  "th{background:#f1f5f9;color:#0f172a;font-weight:600;}",
  "tr:nth-child(even) td{background:#fafbfc;}",
  "blockquote{margin:12pt 0;padding:10pt 14pt;border-left:3pt solid #94a3b8;background:#f8fafc;color:#334155;}",
  ".callout,.infocard,.info-box{margin:12pt 0;padding:10pt 12pt;border:1pt solid #e2e8f0;border-left:3pt solid #64748b;background:#f8fafc;}",
  ".card,.kpi{margin:12pt 0;padding:10pt 12pt;border:1pt solid #e2e8f0;background:#fff;}",
  "figure{margin:12pt 0;}",
  "hr{border:none;border-top:1pt solid #e2e8f0;margin:18pt 0;}",
  "dl{margin:10pt 0;}",
  "dt{font-weight:600;color:#0f172a;margin-top:8pt;}",
  "dd{margin:2pt 0 8pt 16pt;}",
  "body{padding:0;margin:0;}",
  "body > :first-child,section > :first-child{margin-top:0;}",
  "section,article{margin:0 0 14pt;}",
  "h1{break-after:avoid;page-break-after:avoid;}",
  "h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid;break-inside:avoid;page-break-inside:avoid;}",
  "h2:not(:first-child),h3:not(:first-child){margin-top:20pt;padding-top:2pt;}",
  "p,li{orphans:3;widows:3;}",
  "ul,ol{break-inside:avoid-page;page-break-inside:avoid;}",
  "table{table-layout:fixed;word-break:break-word;break-inside:auto;page-break-inside:auto;}",
  "thead{display:table-header-group;}",
  "tfoot{display:table-footer-group;}",
  "tr{page-break-inside:avoid;break-inside:avoid;}",
  "th,td{word-wrap:break-word;}",
  "img{max-width:100%;height:auto;break-inside:avoid;page-break-inside:avoid;}",
  "figure,blockquote,.callout,.infocard,.info-box,dl{break-inside:avoid;page-break-inside:avoid;}",
  ".card,.keep-together,.kpi,.signature-block{break-inside:avoid;page-break-inside:avoid;}",
  ".cover-page,.title-page{break-after:page;page-break-after:always;}",
  ".cover-page > :first-child,.title-page > :first-child{margin-top:0;}"
].join("");

type DocumentSourceFilePayload = RuntimeDocumentSourceFile;

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
export class RuntimeDocumentProviderAdapterService {
  private readonly logger = new Logger(RuntimeDocumentProviderAdapterService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly sandboxClientService: SandboxClientService
  ) {}

  async run(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
  }): Promise<RuntimeDocumentJobRunResult> {
    const provider = input.request.job.provider;
    if (provider !== "sandbox" && provider !== "gamma") {
      throw new BadRequestException(`Unsupported document provider "${String(provider)}".`);
    }

    if (provider === "gamma") {
      const credential = this.resolveDocumentCredential(input.bundle, provider);
      if (credential === null) {
        throw new BadRequestException(
          `Document provider "${provider}" is not configured in the assistant runtime bundle.`
        );
      }
      if (credential.configured !== true) {
        throw new BadRequestException(
          `Document provider "${provider}" is not configured with an active admin credential.`
        );
      }
      return this.runGammaPath(input, credential);
    }

    // sandbox path — no external credential required
    const filename = this.resolveRequestedFilename(input.request, input.request.job.outputFormat);

    // Mode B: create_data_document → model-writes-code path (ADR-123 Slice 6).
    // Does NOT go through the HTML→WeasyPrint pipeline.
    const descriptorMode = input.request.directToolExecution.descriptorMode;
    if (descriptorMode === "create_data_document") {
      return this.runCodeDocumentPath({ bundle: input.bundle, request: input.request, filename });
    }

    // Revise path: when descriptorMode is "revise_document" and previousVersionRenderedHtml
    // is present, branch into either structured revise (large/structured versions) or
    // patch-revise (fast_small / compact HTML) instead of full create-time regeneration.
    // Both are bounded worker paths with one sandbox render and no create-path retry loop.
    const previousVersionRenderedHtml =
      typeof input.request.previousVersionRenderedHtml === "string" &&
      input.request.previousVersionRenderedHtml.length > 0
        ? input.request.previousVersionRenderedHtml
        : null;
    if (descriptorMode === "revise_document" && previousVersionRenderedHtml !== null) {
      if (this.shouldUseStructuredRevisePath(input.request, previousVersionRenderedHtml)) {
        return this.runStructuredPdfRevise({
          bundle: input.bundle,
          request: input.request,
          filename,
          previousVersionRenderedHtml
        });
      }
      return this.runPdfPatchRevise({
        bundle: input.bundle,
        request: input.request,
        filename,
        previousVersionRenderedHtml
      });
    }

    const sourceFiles = input.request.sourceFiles ?? [];
    const totalInlinedSourceBytes = sourceFiles.reduce(
      (sum, entry) => sum + (entry.text === null ? 0 : Buffer.byteLength(entry.text, "utf8")),
      0
    );
    const hasExtractableSourceText = sourceFiles.some(
      (file) => typeof file.text === "string" && file.text.trim().length > 0
    );
    const contentIntent = this.resolveDocumentContentIntent(input.request);
    const useDirectSourceTransfer =
      descriptorMode === "create_pdf_document" &&
      hasExtractableSourceText &&
      this.shouldUseDirectSourceTransfer(input.request);
    const createEditStrategy = resolveEditStrategyForCreate({
      totalInlinedSourceBytes
    });
    const useStructuredSourcePreservingCreate =
      descriptorMode === "create_pdf_document" &&
      hasExtractableSourceText &&
      createEditStrategy === "structured_large" &&
      contentIntent !== "rewrite_content" &&
      !useDirectSourceTransfer;
    if (useDirectSourceTransfer) {
      this.logger.log(
        `[document-pdf-route-direct-source-transfer] jobId=${input.request.job.id} totalInlinedSourceBytes=${String(totalInlinedSourceBytes)} explicitVerbatimRequest=true`
      );
    }
    if (useStructuredSourcePreservingCreate) {
      this.logger.log(
        `[document-pdf-route-structured-source-create] jobId=${input.request.job.id} totalInlinedSourceBytes=${String(totalInlinedSourceBytes)} transferMode=${String(input.request.directToolExecution.request.transferMode ?? "unset")} contentIntent=${String(contentIntent ?? "unset")}`
      );
    }
    const timeoutMs = this.resolveWorkerTimeoutMs(input.bundle);
    let lastProviderFailure: {
      code: string | null;
      status: number | null;
      message: string;
      retryable: boolean;
      providerStatus: Record<string, unknown> | null;
    } | null = null;
    let lastValidationFailure: {
      code: string;
      message: string;
      metadata: Record<string, unknown>;
    } | null = null;
    let successfulProviderResult: {
      bytesBase64: string;
      mimeType: string;
      billingFacts?: RuntimeOutputArtifact["billingFacts"];
    } | null = null;
    let capturedRenderedHtml: string | null = null;
    let capturedStructureJson: PersaiDocumentStructureSnapshot | null = null;
    let capturedStyleProfileJson: PersaiDocumentStyleProfile | null = null;
    let capturedEditStrategy: PersaiDocumentEditStrategy | null = null;
    let accumulatedWorkerUsage: RuntimeUsageSnapshot | null = null;

    this.logger.log(
      `[document-pdf-start] jobId=${input.request.job.id} filename=${filename} timeoutMs=${String(timeoutMs)} maxAttempts=${String(DOCUMENT_PDF_MAX_RENDER_ATTEMPTS)} useDirectSourceTransfer=${String(useDirectSourceTransfer)} useStructuredSourcePreservingCreate=${String(useStructuredSourcePreservingCreate)} contentIntent=${String(contentIntent ?? "unset")} editStrategy=${createEditStrategy}`
    );
    for (let attempt = 1; attempt <= DOCUMENT_PDF_MAX_RENDER_ATTEMPTS; attempt += 1) {
      let htmlContent: string;
      if (useDirectSourceTransfer) {
        const directTransferResult = this.buildDirectSourceTransferHtml({
          sourceFiles,
          structuredSnapshot: createEditStrategy === "structured_large"
        });
        htmlContent = directTransferResult.htmlContent;
        capturedRenderedHtml = htmlContent;
        if (directTransferResult.structure !== null && directTransferResult.style !== null) {
          capturedStructureJson = directTransferResult.structure;
          capturedStyleProfileJson = directTransferResult.style;
          capturedEditStrategy = createEditStrategy;
        }
        this.logger.log(
          `[document-pdf-direct-source-transfer-html-ready] jobId=${input.request.job.id} attempt=${String(attempt)} htmlBytes=${String(htmlContent.length)} bodyTextLength=${String(directTransferResult.bodyTextLength)} structured=${String(directTransferResult.structure !== null)}`
        );
      } else if (useStructuredSourcePreservingCreate) {
        const structuredCreateResult = this.buildStructuredSourcePreservingCreateHtml({
          sourceFiles,
          request: input.request
        });
        htmlContent = structuredCreateResult.htmlContent;
        capturedRenderedHtml = htmlContent;
        capturedStructureJson = structuredCreateResult.structure;
        capturedStyleProfileJson = structuredCreateResult.style;
        capturedEditStrategy = createEditStrategy;
        this.logger.log(
          `[document-pdf-structured-source-create-ready] jobId=${input.request.job.id} attempt=${String(attempt)} htmlBytes=${String(htmlContent.length)} bodyTextLength=${String(structuredCreateResult.bodyTextLength)} sourceTextChars=${String(structuredCreateResult.sourceTextChars)}`
        );
      } else {
        // Single-shot path.
        try {
          const generation = await this.generatePdfHtmlContent({
            bundle: input.bundle,
            request: input.request,
            filename,
            sourceFiles,
            attempt
          });
          htmlContent = generation.htmlContent;
          capturedRenderedHtml = htmlContent;
          accumulatedWorkerUsage = mergeUsageSnapshots(accumulatedWorkerUsage, generation.usage);
          this.logger.log(
            `[document-pdf-html-ready] jobId=${input.request.job.id} attempt=${String(attempt)} htmlBytes=${String(htmlContent.length)} bodyTextLength=${String(generation.bodyTextLength)}`
          );
          if (generation.isTruncated) {
            this.logger.warn(
              `[document-pdf-single-shot-truncated] jobId=${input.request.job.id} attempt=${String(attempt)} bodyTextLength=${String(generation.bodyTextLength)} htmlBytes=${String(htmlContent.length)} willRetry=${String(attempt < DOCUMENT_PDF_MAX_RENDER_ATTEMPTS)}`
            );
            lastValidationFailure = {
              code: "document_single_shot_truncated",
              message: `Single-shot output was truncated (bodyTextLength=${String(generation.bodyTextLength)}).`,
              metadata: {
                attempt,
                bodyTextLength: generation.bodyTextLength,
                htmlBytes: htmlContent.length
              }
            };
            if (attempt >= DOCUMENT_PDF_MAX_RENDER_ATTEMPTS) {
              break;
            }
            continue;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof ProviderGatewayTimeoutError) {
            this.logger.warn(
              `[document-pdf-single-shot-timeout] jobId=${input.request.job.id} attempt=${String(attempt)} timeoutMs=${String(error.timeoutMs)} willRetry=${String(attempt < DOCUMENT_PDF_MAX_RENDER_ATTEMPTS)}`
            );
            lastValidationFailure = {
              code: "document_single_shot_timeout",
              message: `Single-shot LLM call timed out after ${String(error.timeoutMs)}ms.`,
              metadata: {
                attempt,
                timeoutMs: error.timeoutMs,
                stage: "html_generation"
              }
            };
            if (attempt >= DOCUMENT_PDF_MAX_RENDER_ATTEMPTS) {
              break;
            }
            continue;
          }
          this.logger.warn(
            `[document-pdf-html-generation-failed] jobId=${input.request.job.id} attempt=${String(attempt)} message=${message}`
          );
          lastValidationFailure = {
            code: "document_html_generation_failed",
            message,
            metadata: {
              attempt,
              maxAttempts: DOCUMENT_PDF_MAX_RENDER_ATTEMPTS,
              stage: "html_generation"
            }
          };
          if (attempt >= DOCUMENT_PDF_MAX_RENDER_ATTEMPTS) {
            break;
          }
          continue;
        }
      }
      if (
        createEditStrategy === "structured_large" &&
        capturedStructureJson === null &&
        capturedStyleProfileJson === null
      ) {
        const snapshot = this.captureStructuredSnapshotFromHtml(htmlContent);
        capturedStructureJson = snapshot.structure;
        capturedStyleProfileJson = snapshot.style;
        capturedEditStrategy = createEditStrategy;
      }
      const renderResult = await this.renderHtmlToPdf({
        bundle: input.bundle,
        html: htmlContent,
        filename,
        jobId: input.request.job.id,
        chatId: input.request.job.chatId
      });
      if (!renderResult.ok) {
        this.logger.warn(
          `[document-pdf-render-failed] jobId=${input.request.job.id} attempt=${String(attempt)} code=${renderResult.code} retryable=${String(renderResult.retryable)} message=${renderResult.message}`
        );
        lastProviderFailure = {
          code: renderResult.code,
          status: null,
          message: renderResult.message,
          retryable: renderResult.retryable,
          providerStatus: null
        };
        break;
      }
      const pdfBuffer = renderResult.bytes;
      this.logger.log(
        `[document-pdf-render-ok] jobId=${input.request.job.id} attempt=${String(attempt)} pdfBytes=${String(pdfBuffer.length)}`
      );
      const validationFailure = await this.validateGeneratedPdfArtifact(pdfBuffer, {
        jobId: input.request.job.id,
        attempt
      });
      if (validationFailure === null) {
        lastValidationFailure = null;
        successfulProviderResult = {
          bytesBase64: pdfBuffer.toString("base64"),
          mimeType: "application/pdf",
          billingFacts: null
        };
        this.logger.log(
          `[document-pdf-success] jobId=${input.request.job.id} attempt=${String(attempt)} pdfBytes=${String(pdfBuffer.length)}`
        );
        break;
      }
      lastValidationFailure = {
        ...validationFailure,
        metadata: {
          ...validationFailure.metadata,
          attempt,
          maxAttempts: DOCUMENT_PDF_MAX_RENDER_ATTEMPTS
        }
      };
      this.logger.warn(
        `[document-pdf-validation-failed] jobId=${input.request.job.id} attempt=${String(attempt)} code=${validationFailure.code} message=${validationFailure.message}`
      );
      if (attempt >= DOCUMENT_PDF_MAX_RENDER_ATTEMPTS) {
        break;
      }
    }

    if (lastProviderFailure !== null) {
      return {
        assistantText: null,
        artifacts: [],
        usage: null,
        toolInvocations: [
          {
            name: "document",
            iteration: 1,
            ok: false,
            executionMode: "worker"
          }
        ],
        rawText: null,
        providerStatus: {
          provider,
          state: "failed",
          errorCode: lastProviderFailure.code ?? "provider_document_generation_failed",
          retryable: lastProviderFailure.retryable,
          httpStatus: lastProviderFailure.status,
          message: lastProviderFailure.message,
          outputFormat: input.request.job.outputFormat,
          requestedName: filename,
          sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
          ...(lastProviderFailure.providerStatus === null
            ? {}
            : { providerFailure: lastProviderFailure.providerStatus })
        }
      };
    }

    if (successfulProviderResult === null || lastValidationFailure !== null) {
      return {
        assistantText: null,
        artifacts: [],
        usage: null,
        toolInvocations: [
          {
            name: "document",
            iteration: 1,
            ok: false,
            executionMode: "worker"
          }
        ],
        rawText: null,
        providerStatus: {
          provider,
          state: "invalid_output",
          errorCode: lastValidationFailure?.code ?? "document_pdf_invalid_output",
          retryable: false,
          message:
            lastValidationFailure?.message ??
            "Rendered PDF output was invalid and could not be delivered honestly.",
          outputFormat: input.request.job.outputFormat,
          requestedName: filename,
          sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
          validation: lastValidationFailure?.metadata ?? {},
          providerFailure: null
        }
      };
    }
    const artifact = await this.persistGeneratedArtifact({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      handle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceQuotaBytes: input.bundle.governance.quota?.workspaceQuotaBytes ?? null,
      sharedQuotaBytes: input.bundle.governance.quota?.sharedQuotaBytes ?? null,
      filename,
      requestPrompt: input.request.directToolExecution.request.prompt,
      requestedName: input.request.directToolExecution.request.requestedName ?? null,
      buffer: Buffer.from(successfulProviderResult.bytesBase64, "base64"),
      mimeType: successfulProviderResult.mimeType,
      billingFacts: successfulProviderResult.billingFacts ?? null
    });

    // Worker intentionally returns assistantText: null. The user-facing
    // completion message is generated exactly once in the API layer by
    // AssistantDocumentJobDeliveryService.resolveCompletionAssistantText
    // after the document is delivered to the chat, using full chat history
    // as context. Generating it here as well would (a) produce a duplicate
    // LLM call for every document job (visible in provider logs as two
    // independent framing requests with different outputs for the same
    // job) and (b) misuse the background-task-evaluation prompt, which
    // ADR-112 reserves for Background Task Evaluation and must never be
    // appended to a normal user-visible chat turn.
    return {
      assistantText: null,
      artifacts: [artifact],
      usage: accumulatedWorkerUsage,
      billingFacts: artifact.billingFacts ?? null,
      toolInvocations: [
        {
          name: "document",
          iteration: 1,
          ok: true,
          executionMode: "worker"
        }
      ],
      rawText: null,
      renderedHtml: capturedRenderedHtml,
      editStrategy: capturedEditStrategy ?? "fast_small",
      ...(capturedStructureJson !== null
        ? {
            structureJson: capturedStructureJson as unknown as Record<string, unknown>,
            styleProfileJson: capturedStyleProfileJson as unknown as Record<string, unknown> | null,
            structureVersion: PERSAI_DOCUMENT_STRUCTURE_VERSION
          }
        : {}),
      providerStatus: {
        provider: "sandbox",
        state: "success",
        outputFormat: input.request.job.outputFormat,
        requestedName: filename,
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt)
      }
    };
  }

  /**
   * ADR-097 Slice 2 — SEARCH/REPLACE patch-revise loop for PDF documents.
   *
   * One LLM call (classification: document_pdf_patch_revise) → validates JSON
   * envelope → applies patches in array order → repairHtmlDocument → sandbox render.
   * No retry loop. No fallback. One shot; fail honestly on any violation.
   */
  private async runPdfPatchRevise(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    filename: string;
    previousVersionRenderedHtml: string;
  }): Promise<RuntimeDocumentJobRunResult> {
    const providerSelection = this.resolveDocumentGenerationProviderSelection(input.bundle);
    const maxOutputTokens = this.resolveMaxOutputTokens(input.bundle, providerSelection);

    this.logger.log(
      `[document-pdf-patch-revise-start] jobId=${input.request.job.id} provider=${providerSelection.provider} model=${providerSelection.model} maxOutputTokens=${String(maxOutputTokens)} previousHtmlBytes=${String(input.previousVersionRenderedHtml.length)}`
    );

    // Build the LLM request for patch-revise.
    const patchRequest = this.buildPdfPatchReviseRequest(input, providerSelection, maxOutputTokens);
    let rawText: string;
    let patchReviseUsage: RuntimeUsageSnapshot | null = null;
    try {
      const response = await this.providerGatewayClientService.generateText(patchRequest);
      rawText = response.text ?? "";
      patchReviseUsage = response.usage ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[document-pdf-patch-revise-llm-failed] jobId=${input.request.job.id} message=${message}`
      );
      return this.buildDocumentReviseFailResult(input, {
        errorCode: "document_pdf_patch_revise_invalid_envelope",
        retryable: true,
        message: `Patch-revise LLM call failed: ${message}`
      });
    }

    this.logger.log(
      `[document-pdf-patch-revise-raw] jobId=${input.request.job.id} rawLength=${String(rawText.length)} preview=${JSON.stringify(rawText.slice(0, 300))}`
    );

    // Parse the JSON envelope.
    let patches: Array<{ search: string; replace: string }>;
    try {
      patches = this.parsePatchReviseEnvelope(rawText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[document-pdf-patch-revise-envelope-invalid] jobId=${input.request.job.id} message=${message}`
      );
      return this.buildDocumentReviseFailResult(input, {
        errorCode: "document_pdf_patch_revise_invalid_envelope",
        retryable: false,
        message: `Patch envelope invalid: ${message}`
      });
    }

    this.logger.log(
      `[document-pdf-patch-revise-patches-parsed] jobId=${input.request.job.id} patchCount=${String(patches.length)}`
    );

    // Apply patches in order.
    let workingHtml = input.previousVersionRenderedHtml;
    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i]!;
      const searchBlock = patch.search;
      const replaceBlock = patch.replace;

      if (searchBlock.length === 0) {
        return this.buildDocumentReviseFailResult(input, {
          errorCode: "document_pdf_patch_revise_invalid_envelope",
          retryable: false,
          message: `Patch #${String(i)}: search block is empty.`
        });
      }

      const firstIdx = workingHtml.indexOf(searchBlock);
      if (firstIdx === -1) {
        const excerpt = searchBlock.slice(0, 120);
        this.logger.warn(
          `[document-pdf-patch-revise-not-found] jobId=${input.request.job.id} patchIndex=${String(i)} excerpt=${JSON.stringify(excerpt)}`
        );
        return this.buildDocumentReviseFailResult(input, {
          errorCode: "document_pdf_patch_revise_search_not_found",
          retryable: false,
          message: new DocumentPdfPatchReviseSearchNotFoundError(i, excerpt).message
        });
      }
      const secondIdx = workingHtml.indexOf(searchBlock, firstIdx + 1);
      if (secondIdx !== -1) {
        const excerpt = searchBlock.slice(0, 120);
        this.logger.warn(
          `[document-pdf-patch-revise-ambiguous] jobId=${input.request.job.id} patchIndex=${String(i)} excerpt=${JSON.stringify(excerpt)}`
        );
        return this.buildDocumentReviseFailResult(input, {
          errorCode: "document_pdf_patch_revise_search_ambiguous",
          retryable: false,
          message: new DocumentPdfPatchReviseSearchAmbiguousError(i, excerpt).message
        });
      }

      workingHtml =
        workingHtml.slice(0, firstIdx) +
        replaceBlock +
        workingHtml.slice(firstIdx + searchBlock.length);
    }

    // Run repairHtmlDocument.
    let repaired: { html: string; bodyTextLength: number };
    try {
      repaired = this.repairHtmlDocument(workingHtml);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[document-pdf-patch-revise-repair-failed] jobId=${input.request.job.id} message=${message}`
      );
      return this.buildDocumentReviseFailResult(input, {
        errorCode: "document_pdf_patch_revise_repair_failed",
        retryable: false,
        message: `HTML repair failed after patch application: ${message}`
      });
    }

    const repairedHtml = repaired.html;
    this.logger.log(
      `[document-pdf-patch-revise-repaired] jobId=${input.request.job.id} repairedBytes=${String(repairedHtml.length)} bodyTextLength=${String(repaired.bodyTextLength)}`
    );

    // Render via sandbox WeasyPrint.
    const renderResult = await this.renderHtmlToPdf({
      bundle: input.bundle,
      html: repairedHtml,
      filename: input.filename,
      jobId: input.request.job.id,
      chatId: input.request.job.chatId
    });
    if (!renderResult.ok) {
      this.logger.warn(
        `[document-pdf-patch-revise-render-failed] jobId=${input.request.job.id} code=${renderResult.code}`
      );
      return this.buildDocumentReviseFailResult(input, {
        errorCode: renderResult.code,
        retryable: renderResult.retryable,
        message: renderResult.message
      });
    }

    const pdfBuffer = renderResult.bytes;
    const validationFailure = await this.validateGeneratedPdfArtifact(pdfBuffer, {
      jobId: input.request.job.id,
      attempt: 1
    });
    if (validationFailure !== null) {
      this.logger.warn(
        `[document-pdf-patch-revise-validation-failed] jobId=${input.request.job.id} code=${validationFailure.code} message=${validationFailure.message}`
      );
      return this.buildDocumentReviseFailResult(input, {
        errorCode: validationFailure.code,
        retryable: false,
        message: validationFailure.message
      });
    }

    const artifact = await this.persistGeneratedArtifact({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      handle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceQuotaBytes: input.bundle.governance.quota?.workspaceQuotaBytes ?? null,
      sharedQuotaBytes: input.bundle.governance.quota?.sharedQuotaBytes ?? null,
      filename: input.filename,
      requestPrompt: input.request.directToolExecution.request.prompt,
      requestedName: input.request.directToolExecution.request.requestedName ?? null,
      buffer: pdfBuffer,
      mimeType: "application/pdf",
      billingFacts: null
    });

    this.logger.log(
      `[document-pdf-patch-revise-success] jobId=${input.request.job.id} pdfBytes=${String(pdfBuffer.length)} renderedHtmlBytes=${String(repairedHtml.length)}`
    );

    return {
      assistantText: null,
      artifacts: [artifact],
      usage: patchReviseUsage,
      billingFacts: artifact.billingFacts ?? null,
      toolInvocations: [{ name: "document", iteration: 1, ok: true, executionMode: "worker" }],
      rawText: null,
      renderedHtml: repairedHtml,
      editStrategy: "fast_small",
      providerStatus: {
        provider: "sandbox",
        state: "success",
        outputFormat: input.request.job.outputFormat,
        requestedName: input.filename,
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt)
      }
    };
  }

  private shouldUseStructuredRevisePath(
    request: RuntimeDocumentJobRunRequest,
    previousVersionRenderedHtml: string
  ): boolean {
    if (request.previousVersionEditStrategy === "fast_small") {
      return false;
    }
    if (
      shouldUseStructuredDocumentPath({
        editStrategy: request.previousVersionEditStrategy ?? null,
        structureJson: request.previousVersionStructureJson ?? null
      })
    ) {
      return true;
    }
    return previousVersionRenderedHtml.length > LARGE_DOCUMENT_STRUCTURE_THRESHOLD_BYTES;
  }

  private resolveDocumentEditOperation(
    request: RuntimeDocumentJobRunRequest
  ): PersaiDocumentInternalOperation {
    const contentIntent = this.resolveDocumentContentIntent(request);
    const explicit = request.directToolExecution.request.editOperation;
    if (contentIntent === "preserve_content") {
      return "style_only";
    }
    if (
      explicit === "style_only" ||
      explicit === "content_patch" ||
      explicit === "section_rewrite"
    ) {
      return explicit;
    }
    const metadata = request.directToolExecution.request.metadata;
    const metadataOperation = metadata?.editOperation;
    if (
      metadataOperation === "style_only" ||
      metadataOperation === "content_patch" ||
      metadataOperation === "section_rewrite"
    ) {
      return metadataOperation;
    }
    if (metadata?.preserveText === true || metadata?.styleOnly === true) {
      return "style_only";
    }
    if (contentIntent === "rewrite_content") {
      return "content_patch";
    }
    return "style_only";
  }

  private resolveDocumentContentIntent(
    request: RuntimeDocumentJobRunRequest
  ): DocumentContentIntent | null {
    const explicit = request.directToolExecution.request.contentIntent;
    if (explicit === "preserve_content" || explicit === "rewrite_content") {
      return explicit;
    }
    const metadata = request.directToolExecution.request.metadata;
    const metadataIntent = metadata?.contentIntent;
    if (metadataIntent === "preserve_content" || metadataIntent === "rewrite_content") {
      return metadataIntent;
    }
    return null;
  }

  private resolveStructuredReviseState(input: {
    request: RuntimeDocumentJobRunRequest;
    previousVersionRenderedHtml: string;
  }): {
    structure: PersaiDocumentStructureSnapshot;
    style: PersaiDocumentStyleProfile;
    editStrategy: PersaiDocumentEditStrategy;
    lazyUpgraded: boolean;
  } {
    const persistedStructure = parsePersaiDocumentStructureSnapshot(
      input.request.previousVersionStructureJson ?? null
    );
    const persistedStyle =
      parsePersaiDocumentStyleProfile(input.request.previousVersionStyleProfileJson ?? null) ??
      createDefaultStyleProfile();
    if (persistedStructure !== null) {
      return {
        structure: persistedStructure,
        style: persistedStyle,
        editStrategy: input.request.previousVersionEditStrategy ?? "structured_large",
        lazyUpgraded: false
      };
    }
    const upgraded = this.captureStructuredSnapshotFromHtml(input.previousVersionRenderedHtml);
    const upgradedStyle =
      parsePersaiDocumentStyleProfile(input.request.previousVersionStyleProfileJson ?? null) ??
      upgraded.style;
    return {
      structure: upgraded.structure,
      style: upgradedStyle,
      editStrategy: "structured_large",
      lazyUpgraded: true
    };
  }

  private async runStructuredPdfRevise(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    filename: string;
    previousVersionRenderedHtml: string;
  }): Promise<RuntimeDocumentJobRunResult> {
    const providerSelection = this.resolveDocumentGenerationProviderSelection(input.bundle);
    const maxOutputTokens = this.resolveMaxOutputTokens(input.bundle, providerSelection);
    const operation = this.resolveDocumentEditOperation(input.request);
    const reviseState = this.resolveStructuredReviseState(input);
    const beforeTextFingerprint = extractStructurePlainText(reviseState.structure);

    this.logger.log(
      `[document-pdf-structured-revise-start] jobId=${input.request.job.id} operation=${operation} lazyUpgraded=${String(reviseState.lazyUpgraded)} sectionCount=${String(reviseState.structure.sections.length)}`
    );

    let nextStructure = reviseState.structure;
    let nextStyle = reviseState.style;
    let workerUsage: RuntimeUsageSnapshot | null = null;

    try {
      if (operation === "style_only") {
        const stylePatchResult = await this.generateStructuredStylePatch({
          bundle: input.bundle,
          request: input.request,
          providerSelection,
          maxOutputTokens,
          style: reviseState.style,
          structure: reviseState.structure
        });
        workerUsage = stylePatchResult.usage;
        nextStyle = mergeStyleProfile(reviseState.style, stylePatchResult.patch);
      } else {
        const sectionPatchesResult = await this.generateStructuredSectionPatches({
          bundle: input.bundle,
          request: input.request,
          providerSelection,
          maxOutputTokens,
          operation,
          structure: reviseState.structure,
          style: reviseState.style
        });
        workerUsage = sectionPatchesResult.usage;
        nextStructure = applySectionPatches(reviseState.structure, sectionPatchesResult.patches);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[document-pdf-structured-revise-llm-failed] jobId=${input.request.job.id} operation=${operation} message=${message}`
      );
      return this.buildDocumentReviseFailResult(input, {
        errorCode: "document_structured_revise_invalid_envelope",
        retryable: true,
        message: `Structured revise LLM call failed: ${message}`
      });
    }

    if (operation === "style_only") {
      const afterTextFingerprint = extractStructurePlainText(nextStructure);
      if (afterTextFingerprint !== beforeTextFingerprint) {
        return this.buildDocumentReviseFailResult(input, {
          errorCode: "document_structured_style_only_text_changed",
          retryable: false,
          message: "Style-only revise changed document text content."
        });
      }
    }

    const rendered = renderStructureToHtml(nextStructure, nextStyle);
    let repaired: { html: string; bodyTextLength: number };
    try {
      repaired = this.repairHtmlDocument(rendered);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.buildDocumentReviseFailResult(input, {
        errorCode: "document_structured_revise_repair_failed",
        retryable: false,
        message: `Structured revise HTML repair failed: ${message}`
      });
    }

    const renderResult = await this.renderHtmlToPdf({
      bundle: input.bundle,
      html: repaired.html,
      filename: input.filename,
      jobId: input.request.job.id,
      chatId: input.request.job.chatId
    });
    if (!renderResult.ok) {
      return this.buildDocumentReviseFailResult(input, {
        errorCode: renderResult.code,
        retryable: renderResult.retryable,
        message: renderResult.message
      });
    }

    const pdfBuffer = renderResult.bytes;
    const validationFailure = await this.validateGeneratedPdfArtifact(pdfBuffer, {
      jobId: input.request.job.id,
      attempt: 1
    });
    if (validationFailure !== null) {
      return this.buildDocumentReviseFailResult(input, {
        errorCode: validationFailure.code,
        retryable: false,
        message: validationFailure.message
      });
    }

    const artifact = await this.persistGeneratedArtifact({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      handle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceQuotaBytes: input.bundle.governance.quota?.workspaceQuotaBytes ?? null,
      sharedQuotaBytes: input.bundle.governance.quota?.sharedQuotaBytes ?? null,
      filename: input.filename,
      requestPrompt: input.request.directToolExecution.request.prompt,
      requestedName: input.request.directToolExecution.request.requestedName ?? null,
      buffer: pdfBuffer,
      mimeType: "application/pdf",
      billingFacts: null
    });

    this.logger.log(
      `[document-pdf-structured-revise-success] jobId=${input.request.job.id} operation=${operation} pdfBytes=${String(pdfBuffer.length)}`
    );

    return {
      assistantText: null,
      artifacts: [artifact],
      usage: workerUsage,
      billingFacts: artifact.billingFacts ?? null,
      toolInvocations: [{ name: "document", iteration: 1, ok: true, executionMode: "worker" }],
      rawText: null,
      renderedHtml: repaired.html,
      structureJson: nextStructure as unknown as Record<string, unknown>,
      styleProfileJson: nextStyle as unknown as Record<string, unknown>,
      editStrategy: "structured_large",
      structureVersion: PERSAI_DOCUMENT_STRUCTURE_VERSION,
      providerStatus: {
        provider: "sandbox",
        state: "success",
        outputFormat: input.request.job.outputFormat,
        requestedName: input.filename,
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
        structuredReviseOperation: operation,
        structuredReviseLazyUpgraded: reviseState.lazyUpgraded
      }
    };
  }

  private async generateStructuredStylePatch(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    providerSelection: ProviderSelection;
    maxOutputTokens: number;
    style: PersaiDocumentStyleProfile;
    structure: PersaiDocumentStructureSnapshot;
  }): Promise<{ patch: Record<string, unknown>; usage: RuntimeUsageSnapshot | null }> {
    const response = await this.providerGatewayClientService.generateText({
      provider: input.providerSelection.provider,
      model: input.providerSelection.model,
      systemPrompt: this.buildDocumentWorkerSystemPrompt(),
      developerInstructions: [
        'Return ONLY JSON: { "mode": "document_style_patch", "stylePatch": { ...partial style fields... } }',
        "Change typography/layout/colors only. Do not change section text.",
        "Do not add commentary or markdown fences."
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "document_style_patch_request",
                  revisionPrompt: input.request.directToolExecution.request.prompt,
                  revisionInstructions:
                    input.request.directToolExecution.request.instructions ?? null,
                  currentStyle: input.style,
                  sectionHeadings: input.structure.sections.map((section) => ({
                    id: section.id,
                    heading: section.heading
                  }))
                },
                null,
                2
              )
            }
          ]
        }
      ],
      maxOutputTokens: Math.min(input.maxOutputTokens, 4_000),
      requestMetadata: {
        runtimeSessionId: `document-job:${input.request.job.id}`,
        runtimeRequestId: `document-style-patch:${input.request.job.id}`,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "document_style_patch"
      },
      timeoutMsHint: DOCUMENT_CLASSIFICATION_TIMEOUT_MS
    });
    const rawText = (response.text ?? "").trim();
    const envelope = this.parseStructuredJsonEnvelope(rawText, "document_style_patch");
    const stylePatch = envelope.stylePatch;
    if (stylePatch === null || typeof stylePatch !== "object" || Array.isArray(stylePatch)) {
      throw new Error('Structured style patch envelope must include object "stylePatch".');
    }
    return { patch: stylePatch as Record<string, unknown>, usage: response.usage ?? null };
  }

  private async generateStructuredSectionPatches(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    providerSelection: ProviderSelection;
    maxOutputTokens: number;
    operation: PersaiDocumentInternalOperation;
    structure: PersaiDocumentStructureSnapshot;
    style: PersaiDocumentStyleProfile;
  }): Promise<{
    patches: Array<{
      sectionId: string;
      blocks?: PersaiDocumentStructureSnapshot["sections"][number]["blocks"];
      heading?: string | null;
    }>;
    usage: RuntimeUsageSnapshot | null;
  }> {
    const targetSectionIds = input.request.directToolExecution.request.targetSectionIds ?? [];
    const sections =
      targetSectionIds.length > 0
        ? input.structure.sections.filter((section) => targetSectionIds.includes(section.id))
        : input.structure.sections;
    const response = await this.providerGatewayClientService.generateText({
      provider: input.providerSelection.provider,
      model: input.providerSelection.model,
      systemPrompt: this.buildDocumentWorkerSystemPrompt(),
      developerInstructions: [
        'Return ONLY JSON: { "mode": "document_section_patch_revise", "sections": [ { "sectionId": "...", "heading": "...", "blocks": [ { "id": "...", "type": "paragraph"|"heading", "html": "..." } ] } ] }',
        "Patch only the sections included in the request payload.",
        "Preserve untouched sections exactly.",
        "Do not add commentary or markdown fences."
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "document_section_patch_request",
                  operation: input.operation,
                  revisionPrompt: input.request.directToolExecution.request.prompt,
                  revisionInstructions:
                    input.request.directToolExecution.request.instructions ?? null,
                  targetSectionIds,
                  documentStructure: {
                    sections: sections.map((section) => ({
                      id: section.id,
                      heading: section.heading,
                      blocks: section.blocks
                    }))
                  },
                  styleProfile: input.style
                },
                null,
                2
              )
            }
          ]
        }
      ],
      maxOutputTokens: Math.min(input.maxOutputTokens, 16_000),
      requestMetadata: {
        runtimeSessionId: `document-job:${input.request.job.id}`,
        runtimeRequestId: `document-section-patch:${input.request.job.id}`,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "document_section_patch_revise"
      },
      timeoutMsHint: DOCUMENT_CLASSIFICATION_TIMEOUT_MS
    });
    const rawText = (response.text ?? "").trim();
    const envelope = this.parseStructuredJsonEnvelope(rawText, "document_section_patch_revise");
    if (!Array.isArray(envelope.sections)) {
      throw new Error('Structured section patch envelope must include array "sections".');
    }
    const patches: Array<{
      sectionId: string;
      blocks?: PersaiDocumentStructureSnapshot["sections"][number]["blocks"];
      heading?: string | null;
    }> = [];
    for (const entry of envelope.sections) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      if (typeof row.sectionId !== "string") {
        continue;
      }
      patches.push({
        sectionId: row.sectionId,
        ...(row.heading === null || typeof row.heading === "string"
          ? { heading: row.heading }
          : {}),
        ...(Array.isArray(row.blocks) ? { blocks: row.blocks as never } : {})
      });
    }
    if (patches.length === 0) {
      throw new Error("Structured section patch envelope returned no valid section patches.");
    }
    return { patches, usage: response.usage ?? null };
  }

  private parseStructuredJsonEnvelope(
    rawText: string,
    expectedMode: string
  ): Record<string, unknown> {
    const unfenced = this.stripMarkdownFences(rawText.trim());
    const objectStart = unfenced.indexOf("{");
    const objectEnd = unfenced.lastIndexOf("}");
    if (objectStart === -1 || objectEnd <= objectStart) {
      throw new Error("No JSON object found in structured document model output.");
    }
    const parsed = JSON.parse(unfenced.slice(objectStart, objectEnd + 1)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Structured document envelope is not a JSON object.");
    }
    const envelope = parsed as Record<string, unknown>;
    if (envelope.mode !== expectedMode) {
      throw new Error(
        `Structured document envelope mode must be "${expectedMode}", got: ${JSON.stringify(envelope.mode)}`
      );
    }
    return envelope;
  }

  private captureStructuredSnapshotFromHtml(html: string): {
    structure: PersaiDocumentStructureSnapshot;
    style: PersaiDocumentStyleProfile;
  } {
    return {
      structure: buildStructureFromRenderedHtml(html),
      style: createDefaultStyleProfile()
    };
  }

  private buildDocumentReviseFailResult(
    input: {
      request: RuntimeDocumentJobRunRequest;
      filename: string;
    },
    failure: { errorCode: string; retryable: boolean; message: string }
  ): RuntimeDocumentJobRunResult {
    return {
      assistantText: null,
      artifacts: [],
      usage: null,
      toolInvocations: [{ name: "document", iteration: 1, ok: false, executionMode: "worker" }],
      rawText: null,
      providerStatus: {
        provider: "sandbox",
        state: "failed",
        errorCode: failure.errorCode,
        retryable: failure.retryable,
        message: failure.message,
        outputFormat: input.request.job.outputFormat,
        requestedName: input.filename,
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt)
      }
    };
  }

  /**
   * Parse the strict JSON envelope returned by the patch-revise LLM call.
   * Accepts the raw model text, strips optional markdown fences, then
   * validates the { mode, patches: [{search, replace}] } shape.
   */
  private parsePatchReviseEnvelope(rawText: string): Array<{ search: string; replace: string }> {
    const trimmed = rawText.trim();
    const unfenced = this.stripMarkdownFences(trimmed);
    const objectStart = unfenced.indexOf("{");
    const objectEnd = unfenced.lastIndexOf("}");
    if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
      throw new DocumentPdfPatchReviseInvalidEnvelopeError("No JSON object found in model output.");
    }
    const objectSlice = unfenced.slice(objectStart, objectEnd + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(objectSlice);
    } catch {
      throw new DocumentPdfPatchReviseInvalidEnvelopeError(
        "Failed to parse JSON envelope from model output."
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new DocumentPdfPatchReviseInvalidEnvelopeError("Envelope is not a JSON object.");
    }
    const envelope = parsed as Record<string, unknown>;
    if (envelope.mode !== "document_pdf_patch_revise") {
      throw new DocumentPdfPatchReviseInvalidEnvelopeError(
        `Envelope mode must be "document_pdf_patch_revise", got: ${JSON.stringify(envelope.mode)}`
      );
    }
    if (!Array.isArray(envelope.patches)) {
      throw new DocumentPdfPatchReviseInvalidEnvelopeError('Envelope must have a "patches" array.');
    }
    const patches: Array<{ search: string; replace: string }> = [];
    for (let i = 0; i < envelope.patches.length; i++) {
      const patch = envelope.patches[i];
      if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
        throw new DocumentPdfPatchReviseInvalidEnvelopeError(
          `patches[${String(i)}] must be an object.`
        );
      }
      const patchObj = patch as Record<string, unknown>;
      if (typeof patchObj.search !== "string") {
        throw new DocumentPdfPatchReviseInvalidEnvelopeError(
          `patches[${String(i)}].search must be a string.`
        );
      }
      if (typeof patchObj.replace !== "string") {
        throw new DocumentPdfPatchReviseInvalidEnvelopeError(
          `patches[${String(i)}].replace must be a string.`
        );
      }
      patches.push({ search: patchObj.search, replace: patchObj.replace });
    }
    return patches;
  }

  private buildPdfPatchReviseRequest(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
      previousVersionRenderedHtml: string;
    },
    providerSelection: ProviderSelection,
    maxOutputTokens: number
  ): import("@persai/runtime-contract").ProviderGatewayTextGenerateRequest {
    const docRequest = input.request.directToolExecution.request;
    const sourceFiles = input.request.sourceFiles ?? [];
    const sourceFileContext =
      sourceFiles.length > 0 && sourceFiles.some((f) => f.text !== null)
        ? sourceFiles
            .filter((f) => f.text !== null)
            .map(
              (f, idx) =>
                `--- Source attachment ${String(idx + 1)} (${f.filename ?? "file"}, ${f.mimeType}) ---\n${f.text!}`
            )
            .join("\n\n")
        : null;

    const revisionIntent = [
      `Revision request: ${docRequest.prompt}`,
      docRequest.instructions ? `Additional instructions: ${docRequest.instructions}` : null,
      sourceFileContext
        ? `\n\nSource attachment delta (for reference):\n${sourceFileContext}`
        : null
    ]
      .filter((x) => x !== null)
      .join("\n");

    const systemPrompt = [
      "You are a precise HTML patch editor for a PDF document generation pipeline.",
      "You will receive the FULL HTML of an existing PDF document and a revision request.",
      "You MUST return ONLY a JSON envelope in this exact shape — no prose, no markdown, no preamble:",
      '{"mode":"document_pdf_patch_revise","patches":[{"search":"...","replace":"..."}]}',
      "",
      "Rules you MUST follow:",
      "- Each `search` must match the previous HTML EXACTLY (whitespace and tags preserved).",
      "- Each `search` must be UNIQUE inside the previous HTML (no ambiguous matches). Include enough surrounding context to make it unique.",
      "- Patches are applied in array order; later patches operate on the result of earlier patches.",
      "- To insert content without removing, duplicate the surrounding anchor in `search` and in `replace`.",
      '- To delete content, set `replace` to empty string "".',
      "- If the requested change is structurally cardinal (e.g. completely rewrite), return ONE patch whose `search` is the entire <body>...</body> content.",
      "- Do NOT invent new content unrelated to the revision request.",
      "- Do NOT change the document structure outside the requested change.",
      "- Do NOT include ```json``` markdown fences or any wrapper text around the JSON.",
      "- The JSON must be valid and parseable as-is."
    ].join("\n");

    const userContent = [
      "=== PREVIOUS HTML (read-only source) ===",
      input.previousVersionRenderedHtml,
      "",
      "=== REVISION REQUEST ===",
      revisionIntent,
      "",
      "Return the JSON envelope with the SEARCH/REPLACE patches to apply."
    ].join("\n");

    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt,
      messages: [{ role: "user", content: userContent }],
      maxOutputTokens,
      requestMetadata: {
        classification: "document_pdf_patch_revise",
        runtimeRequestId: input.request.job.id,
        runtimeSessionId: input.request.job.chatId,
        toolLoopIteration: null,
        compactionToolCode: null
      },
      // ADR-097 Slice 3: patch-revise may produce a large HTML body (full document replacement);
      // raise the timeout to match document_html_generation.
      timeoutMsHint: DOCUMENT_CLASSIFICATION_TIMEOUT_MS
    };
  }

  private async runGammaPath(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
    },
    credential: AssistantRuntimeBundleToolCredentialRef
  ): Promise<RuntimeDocumentJobRunResult> {
    const timeoutMs = this.resolveWorkerTimeoutMs(input.bundle);
    const filename = this.resolveRequestedFilename(input.request, input.request.job.outputFormat);
    const gammaInput = this.renderGammaInput(input.request);
    const providerOutcome = await this.providerGatewayClientService.generateDocumentOutcome(
      {
        htmlContent: gammaInput,
        filename,
        credential: {
          toolCode: "document",
          secretId: credential.secretRef.id,
          providerId: "gamma"
        },
        providerOptions: {
          // Gamma path only runs for presentations; coerce to its pdf|pptx union.
          outputFormat: input.request.job.outputFormat === "pptx" ? "pptx" : "pdf",
          presentationOptions: this.buildGammaPresentationOptions(input.request)
        }
      },
      { timeoutMs }
    );
    if (!providerOutcome.ok) {
      return {
        assistantText: null,
        artifacts: [],
        usage: null,
        toolInvocations: [
          {
            name: "document",
            iteration: 1,
            ok: false,
            executionMode: "worker"
          }
        ],
        rawText: null,
        providerStatus: {
          provider: "gamma",
          state: "failed",
          errorCode: providerOutcome.code ?? "provider_document_generation_failed",
          retryable: providerOutcome.retryable,
          httpStatus: providerOutcome.status,
          message: providerOutcome.message,
          outputFormat: input.request.job.outputFormat,
          requestedName: filename,
          sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
          ...(providerOutcome.providerStatus === null
            ? {}
            : { providerFailure: providerOutcome.providerStatus })
        }
      };
    }
    const providerResult = providerOutcome.result;
    const artifact = await this.persistGeneratedArtifact({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      handle: input.bundle.metadata.assistantHandle,
      siblingHandles: input.bundle.metadata.siblingAssistantHandles,
      workspaceQuotaBytes: input.bundle.governance.quota?.workspaceQuotaBytes ?? null,
      sharedQuotaBytes: input.bundle.governance.quota?.sharedQuotaBytes ?? null,
      filename,
      requestPrompt: input.request.directToolExecution.request.prompt,
      requestedName: input.request.directToolExecution.request.requestedName ?? null,
      buffer: Buffer.from(providerResult.bytesBase64, "base64"),
      mimeType: providerResult.mimeType,
      billingFacts: providerResult.billingFacts ?? null
    });
    // Same rationale as the PDF path: worker returns assistantText: null
    // and the user-facing completion text is generated exactly once in
    // AssistantDocumentJobDeliveryService after delivery, with full chat
    // history as context. See the PDF return statement for the full note.
    return {
      assistantText: null,
      artifacts: [artifact],
      usage: null,
      billingFacts: artifact.billingFacts ?? null,
      toolInvocations: [
        {
          name: "document",
          iteration: 1,
          ok: true,
          executionMode: "worker"
        }
      ],
      rawText: null,
      providerStatus: {
        ...providerResult.providerStatus,
        outputFormat: input.request.job.outputFormat,
        requestedName: filename,
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt)
      }
    };
  }

  private resolveDocumentCredential(
    bundle: AssistantRuntimeBundle,
    provider: SupportedDocumentProvider
  ): AssistantRuntimeBundleToolCredentialRef | null {
    const primary = bundle.governance.toolCredentialRefs.document ?? null;
    const chain = primary === null ? [] : [primary, ...(primary.fallbacks ?? [])];
    for (const candidate of chain) {
      if (candidate.providerId === provider) {
        return candidate;
      }
    }
    return null;
  }

  private resolveRequestedFilename(
    request: RuntimeDocumentJobRunRequest,
    outputFormat: "pdf" | "pptx" | "xlsx" | "docx"
  ): string {
    const requested = request.directToolExecution.request.requestedName?.trim() ?? "";
    const base =
      requested.length > 0 ? requested.replace(/[\\/:*?"<>|]+/g, " ").trim() : "document";
    const extension =
      outputFormat === "pptx"
        ? "pptx"
        : outputFormat === "xlsx"
          ? "xlsx"
          : outputFormat === "docx"
            ? "docx"
            : "pdf";
    const normalizedBase = this.stripMatchingExtensionSuffix(base, extension);
    return `${normalizedBase.length > 0 ? normalizedBase : "document"}.${extension}`;
  }

  private stripMatchingExtensionSuffix(
    value: string,
    extension: "pdf" | "pptx" | "xlsx" | "docx"
  ): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return "";
    }
    const suffixPattern = new RegExp(`\\.${extension}$`, "i");
    return normalized.replace(suffixPattern, "").trim();
  }

  private renderGammaInput(request: RuntimeDocumentJobRunRequest): string {
    const parts = [
      request.directToolExecution.request.prompt,
      request.directToolExecution.request.instructions ?? "",
      request.job.sourceUserMessageText,
      this.renderSourceFilesForProviderInput(request.sourceFiles ?? []),
      typeof request.directToolExecution.request.outline === "string"
        ? request.directToolExecution.request.outline
        : request.directToolExecution.request.outline === null ||
            request.directToolExecution.request.outline === undefined
          ? ""
          : JSON.stringify(request.directToolExecution.request.outline, null, 2)
    ]
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return parts.join("\n\n");
  }

  private renderSourceFilesForProviderInput(sourceFiles: RuntimeDocumentSourceFile[]): string {
    const rendered = sourceFiles
      .map((sourceFile, index) => {
        const label = sourceFile.filename ?? `attachment-${String(index + 1)}`;
        if (sourceFile.text !== null && sourceFile.text.trim().length > 0) {
          return `Source file: ${label}\nMIME: ${sourceFile.mimeType}\n\n${sourceFile.text.trim()}`;
        }
        if (sourceFile.note !== null && sourceFile.note.trim().length > 0) {
          return `Source file: ${label}\nMIME: ${sourceFile.mimeType}\nExtraction note: ${sourceFile.note.trim()}`;
        }
        return null;
      })
      .filter((entry): entry is string => entry !== null);
    return rendered.length === 0
      ? ""
      : `Extracted source files:\n\n${rendered.join("\n\n---\n\n")}`;
  }

  private buildGammaPresentationOptions(request: RuntimeDocumentJobRunRequest): NonNullable<
    Extract<
      RuntimeDocumentJobRunRequest["directToolExecution"],
      { toolCode: "document" }
    >["request"]
  > extends never
    ? never
    : {
        textMode: "generate";
        numCards: number;
        cardSplit: "auto" | "inputTextBreaks";
        additionalInstructions: string | null;
        textOptions: {
          amount: "brief" | "medium" | "detailed";
          language: string;
          tone: string | null;
          audience: string | null;
        };
        imageOptions: {
          source: "aiGenerated" | "webFreeToUseCommercially" | "pictographic" | "noImages";
          style?: string | null;
          stylePreset?: "illustration" | "lineArt" | "custom" | null;
        } | null;
        cardOptions: {
          dimensions: "16x9";
        };
        themeId?: string | null;
      } {
    const docRequest = request.directToolExecution.request;
    const language = this.resolveGammaLanguageCode(request);
    const visualDensity = docRequest.visualDensity ?? "balanced";
    const visualStyle = docRequest.visualStyle ?? this.resolveGammaVisualStyleFromTopic(request);
    const imagePolicy = docRequest.imagePolicy ?? "ai_generated";
    const additionalInstructions = this.buildGammaAdditionalInstructions(request, {
      visualStyle,
      imagePolicy,
      visualDensity
    });

    const gammaThemeId =
      typeof docRequest.gammaThemeId === "string" && docRequest.gammaThemeId.trim().length > 0
        ? docRequest.gammaThemeId.trim()
        : null;

    const numCards = this.estimateGammaCardCount(request, visualDensity);
    this.logger.log(
      `[gamma-presentation] resolved numCards=${String(numCards)} targetSlideCount=${String(
        docRequest.targetSlideCount ?? "null"
      )} requestedOutputFormat=${docRequest.outputFormat ?? "null"} jobOutputFormat=${
        request.job.outputFormat
      } visualDensity=${visualDensity} themeId=${gammaThemeId ?? "auto"}`
    );

    return {
      textMode: "generate",
      numCards,
      cardSplit: this.resolveGammaCardSplit(docRequest.outline),
      additionalInstructions,
      ...(gammaThemeId === null ? {} : { themeId: gammaThemeId }),
      textOptions: {
        amount:
          visualDensity === "text_heavy"
            ? "detailed"
            : visualDensity === "visual_heavy"
              ? "medium"
              : "medium",
        language,
        tone: this.resolveGammaTone(request, visualStyle),
        audience: this.resolveGammaAudience(request)
      },
      imageOptions: this.resolveGammaImageOptions({ visualStyle, imagePolicy }),
      cardOptions: {
        dimensions: "16x9"
      }
    };
  }

  private buildGammaAdditionalInstructions(
    request: RuntimeDocumentJobRunRequest,
    input: {
      visualStyle:
        | "professional_modern"
        | "bold_editorial"
        | "minimal_clean"
        | "illustrated_storytelling";
      imagePolicy: "ai_generated" | "web_free_to_use" | "pictographic" | "text_only";
      visualDensity: "balanced" | "visual_heavy" | "text_heavy";
    }
  ): string {
    const instructions: string[] = [];
    instructions.push(
      "Design this as a polished presentation, not a text memo pasted onto slides."
    );
    instructions.push(
      input.visualDensity === "visual_heavy"
        ? "Prefer fewer, fuller image-led cards with substantive bullets, labels, and diagrams instead of many sparse title-only slides."
        : input.visualDensity === "text_heavy"
          ? "Keep the deck readable and content-rich, but still avoid text walls and preserve visual hierarchy."
          : "Prefer fewer, fuller slides with substantive bullets, comparisons, and visuals instead of many sparse title-only cards."
    );
    instructions.push(this.describeGammaVisualStyle(input.visualStyle));
    instructions.push(
      input.imagePolicy === "text_only"
        ? "Do not add extra images unless they are already explicitly provided in the source content."
        : "Use visuals deliberately—comparisons, process flows, timelines, labeled diagrams, grids, and image-led explainer cards—so the deck feels presentation-native rather than document-like."
    );
    instructions.push(
      "Do not create empty hero slides, title-plus-two-words cards, or decorative section dividers with almost no content."
    );
    instructions.push(
      "Each card should earn its place with real teaching or storytelling value: a clear point, supporting bullets, and a visual when it improves comprehension."
    );
    instructions.push(
      "Favor punchy slide titles, comparisons, timelines, grids, callouts, and section-divider cards only when they carry meaningful content."
    );
    if (typeof request.directToolExecution.request.instructions === "string") {
      const trimmed = request.directToolExecution.request.instructions.trim();
      if (trimmed.length > 0) {
        instructions.push(`User guidance: ${trimmed}`);
      }
    }
    const sourceFiles = request.sourceFiles ?? [];
    if (sourceFiles.some((sourceFile) => sourceFile.text !== null)) {
      instructions.push(
        "Use the extracted source file text supplied in the input as primary content when the user asks to rebuild, convert, summarize, or restyle an attached document."
      );
    }
    if (sourceFiles.some((sourceFile) => sourceFile.text === null)) {
      instructions.push(
        "Some source files could not be extracted; do not pretend their contents were read, and rely only on extracted text plus the user's written prompt."
      );
    }
    return instructions.join(" ");
  }

  private describeGammaVisualStyle(
    style: "professional_modern" | "bold_editorial" | "minimal_clean" | "illustrated_storytelling"
  ): string {
    switch (style) {
      case "bold_editorial":
        return "Use bold editorial layouts, large headlines, dramatic contrast, and dynamic compositions.";
      case "minimal_clean":
        return "Use a minimal clean aesthetic with restrained copy, generous spacing, and calm modern layouts.";
      case "illustrated_storytelling":
        return "Use a cohesive illustrated storytelling look with expressive visuals and narrative card sequencing.";
      case "professional_modern":
      default:
        return "Use a professional modern look with crisp business-ready layouts, clean hierarchy, and visually confident slides.";
    }
  }

  private resolveGammaImageOptions(input: {
    visualStyle:
      | "professional_modern"
      | "bold_editorial"
      | "minimal_clean"
      | "illustrated_storytelling";
    imagePolicy: "ai_generated" | "web_free_to_use" | "pictographic" | "text_only";
  }): {
    source: "aiGenerated" | "webFreeToUseCommercially" | "pictographic" | "noImages";
    style?: string | null;
    stylePreset?: "illustration" | "lineArt" | "custom" | null;
  } | null {
    switch (input.imagePolicy) {
      case "text_only":
        return { source: "noImages" };
      case "web_free_to_use":
        return { source: "webFreeToUseCommercially" };
      case "pictographic":
        return { source: "pictographic" };
      case "ai_generated":
      default:
        return {
          source: "aiGenerated",
          style: this.resolveGammaImageStyle(input.visualStyle),
          stylePreset:
            input.visualStyle === "illustrated_storytelling"
              ? "illustration"
              : input.visualStyle === "minimal_clean"
                ? "lineArt"
                : "custom"
        };
    }
  }

  private resolveGammaImageStyle(
    visualStyle:
      | "professional_modern"
      | "bold_editorial"
      | "minimal_clean"
      | "illustrated_storytelling"
  ): string {
    switch (visualStyle) {
      case "bold_editorial":
        return "bold editorial, cinematic lighting, dramatic compositions, premium brand presentation";
      case "minimal_clean":
        return "minimal clean, restrained palette, elegant simple compositions, modern presentation design";
      case "illustrated_storytelling":
        return "cohesive editorial illustration, narrative scenes, expressive but polished, presentation-ready";
      case "professional_modern":
      default:
        return "professional modern, polished business visuals, clean compositions, premium startup deck aesthetic";
    }
  }

  private resolveGammaTone(
    request: RuntimeDocumentJobRunRequest,
    visualStyle:
      | "professional_modern"
      | "bold_editorial"
      | "minimal_clean"
      | "illustrated_storytelling"
  ): string {
    const instructionTone = request.directToolExecution.request.instructions?.trim() ?? "";
    if (instructionTone.length > 0) {
      return instructionTone.slice(0, 500);
    }
    switch (visualStyle) {
      case "bold_editorial":
        return "confident, punchy, high-contrast";
      case "minimal_clean":
        return "clear, calm, concise";
      case "illustrated_storytelling":
        return "engaging, human, story-driven";
      case "professional_modern":
      default:
        return "professional, polished, concise";
    }
  }

  private resolveGammaAudience(request: RuntimeDocumentJobRunRequest): string | null {
    const normalized = this.collectGammaTopicText(request);
    if (normalized.includes("investor")) return "investors";
    if (normalized.includes("board")) return "board members and executives";
    if (normalized.includes("sales")) return "customers and prospects";
    if (normalized.includes("training")) return "learners and team members";
    if (
      normalized.includes("school") ||
      normalized.includes("student") ||
      normalized.includes("college") ||
      normalized.includes("ученик") ||
      normalized.includes("школ")
    ) {
      return "students and learners";
    }
    return null;
  }

  private collectGammaTopicText(request: RuntimeDocumentJobRunRequest): string {
    return [
      request.directToolExecution.request.prompt,
      request.directToolExecution.request.instructions ?? "",
      request.job.sourceUserMessageText,
      this.renderSourceFilesForProviderInput(request.sourceFiles ?? [])
    ]
      .join(" ")
      .toLowerCase();
  }

  private resolveGammaVisualStyleFromTopic(
    request: RuntimeDocumentJobRunRequest
  ): "professional_modern" | "bold_editorial" | "minimal_clean" | "illustrated_storytelling" {
    const normalized = this.collectGammaTopicText(request);
    if (
      normalized.includes("food") ||
      normalized.includes("recipe") ||
      normalized.includes("lifestyle") ||
      normalized.includes("travel") ||
      normalized.includes("еда") ||
      normalized.includes("рецепт")
    ) {
      return "illustrated_storytelling";
    }
    if (
      normalized.includes("school") ||
      normalized.includes("student") ||
      normalized.includes("biology") ||
      normalized.includes("science class") ||
      normalized.includes("lesson") ||
      normalized.includes("учеб") ||
      normalized.includes("школ") ||
      normalized.includes("биолог")
    ) {
      return "illustrated_storytelling";
    }
    if (
      normalized.includes("startup") ||
      normalized.includes("saas") ||
      normalized.includes("software") ||
      normalized.includes("product") ||
      normalized.includes("business") ||
      normalized.includes("tech") ||
      normalized.includes("engineering")
    ) {
      return "professional_modern";
    }
    if (
      normalized.includes("minimal") ||
      normalized.includes("clean") ||
      normalized.includes("simple")
    ) {
      return "minimal_clean";
    }
    if (
      normalized.includes("bold") ||
      normalized.includes("editorial") ||
      normalized.includes("brand")
    ) {
      return "bold_editorial";
    }
    return "professional_modern";
  }

  private inferGammaTopicProfile(request: RuntimeDocumentJobRunRequest): {
    prefersLongForm: boolean;
  } {
    // We deliberately removed the `prefersCompactDeck` branch that used to
    // collapse "school"/"учеб"/"обзор" decks down to 3-5 cards. A typical
    // school deck is 7-10 slides, not 3, and the topic word alone is not a
    // reason to ship a stub. We still honor an explicit long-form signal
    // (report/thesis/quarterly/annual) because those genuinely warrant a
    // larger card cap.
    const normalized = this.collectGammaTopicText(request);
    const longFormTopic =
      normalized.includes("report") ||
      normalized.includes("thesis") ||
      normalized.includes("roadmap") ||
      normalized.includes("quarter") ||
      normalized.includes("annual") ||
      normalized.includes("отчет") ||
      normalized.includes("доклад");
    return { prefersLongForm: longFormTopic };
  }

  private resolveGammaLanguageCode(request: RuntimeDocumentJobRunRequest): string {
    const locale = request.directToolExecution.request.metadata?.locale;
    if (typeof locale === "string" && locale.trim().length > 0) {
      return locale.trim().toLowerCase();
    }
    const bundleLocale = request.runtimeBundleDocument.includes('"locale":"ru"') ? "ru" : null;
    if (bundleLocale !== null) {
      return bundleLocale;
    }
    return "en";
  }

  private estimateGammaCardCount(
    request: RuntimeDocumentJobRunRequest,
    visualDensity: "balanced" | "visual_heavy" | "text_heavy"
  ): number {
    // Authoritative source of truth: when the typed `targetSlideCount` field
    // is present we trust it. The runtime tool already validates and clamps
    // the value to [1, 30] so we only re-clamp defensively here. No regex /
    // text parsing of the user prompt — that path was removed deliberately.
    const targetSlideCount = this.readTargetSlideCount(
      request.directToolExecution.request.targetSlideCount
    );
    if (targetSlideCount !== null) {
      return targetSlideCount;
    }
    // Fallback path when the model omitted `targetSlideCount`. Defaults are
    // tuned for a real-world chat deck, not a stub. A short prompt like
    // "Сделай презентацию про круговорот воды для школы" has no signal that
    // the user wants 3 slides — that was an artefact of a too-aggressive
    // compact-topic heuristic. The defaults below produce a 7-10 slide deck
    // unless an outline or genuinely long input clearly says otherwise.
    const topicProfile = this.inferGammaTopicProfile(request);
    const minCards = topicProfile.prefersLongForm ? 8 : 7;
    const maxCards = topicProfile.prefersLongForm ? 16 : 12;
    const defaultCards = topicProfile.prefersLongForm ? 10 : 8;
    const outline = request.directToolExecution.request.outline;
    if (Array.isArray(outline)) {
      const count = outline.filter((entry) => entry !== null).length;
      if (count > 0) {
        return Math.max(minCards, Math.min(maxCards, count));
      }
    }
    if (typeof outline === "string") {
      const splitCount = outline.split(/\n---\n/g).filter((part) => part.trim().length > 0).length;
      if (splitCount > 1) {
        return Math.max(minCards, Math.min(maxCards, splitCount));
      }
    }
    const baseText = this.renderGammaInput(request);
    // For short user prompts (typical chat ask), the text-length heuristic
    // collapses to `minCards` and we end up with a bland 4-slide deck. Use
    // the explicit default-card target instead and only let the heuristic
    // grow the deck when the seed text is genuinely long.
    if (baseText.length < 600) {
      return defaultCards;
    }
    const approx =
      visualDensity === "visual_heavy"
        ? Math.ceil(baseText.length / 950)
        : visualDensity === "text_heavy"
          ? Math.ceil(baseText.length / 1100)
          : Math.ceil(baseText.length / 750);
    return Math.max(defaultCards, Math.min(maxCards, approx));
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

  private resolveGammaCardSplit(outline: unknown): "auto" | "inputTextBreaks" {
    if (typeof outline === "string" && outline.includes("\n---\n")) {
      return "inputTextBreaks";
    }
    return "auto";
  }

  private async generatePdfHtmlContent(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    filename: string;
    sourceFiles: DocumentSourceFilePayload[];
    attempt: number;
  }): Promise<{
    htmlContent: string;
    bodyTextLength: number;
    isTruncated: boolean;
    usage: RuntimeUsageSnapshot | null;
  }> {
    const providerSelection = this.resolveDocumentGenerationProviderSelection(input.bundle);
    const maxOutputTokens = this.resolveMaxOutputTokens(input.bundle, providerSelection);
    if (input.sourceFiles.length > 0) {
      const inlinedCount = input.sourceFiles.filter((entry) => entry.text !== null).length;
      const totalBytes = input.sourceFiles.reduce(
        (sum, entry) => sum + (entry.text === null ? 0 : Buffer.byteLength(entry.text, "utf8")),
        0
      );
      this.logger.log(
        `[document-pdf-source-attachments] jobId=${input.request.job.id} attempt=${String(
          input.attempt
        )} attachments=${String(input.sourceFiles.length)} inlinedTextFiles=${String(
          inlinedCount
        )} inlinedBytes=${String(totalBytes)}`
      );
    }
    const response = await this.providerGatewayClientService.generateText(
      this.buildPdfContentRequest({ ...input }, providerSelection, maxOutputTokens)
    );
    const rawText = response.text ?? "";
    this.logger.log(
      `[document-pdf-html-raw] jobId=${input.request.job.id} attempt=${String(input.attempt)} provider=${providerSelection.provider} model=${providerSelection.model} rawLength=${String(rawText.length)} preview=${JSON.stringify(rawText.slice(0, 200))}`
    );
    const extracted = this.extractHtmlFromModelOutput(rawText);
    if (extracted === null) {
      throw new Error(
        "Document HTML generation produced no recognizable HTML in the model output."
      );
    }
    // Truncation detection must happen on the pre-repaired HTML because
    // repairHtmlDocument (parse5) always synthesises closing </body></html>
    // tags — checking the repaired output would never detect a cut-off.
    const hasHtmlCloseInExtracted = /<\/html\s*>/i.test(extracted);
    const hasBodyCloseInExtracted = /<\/body\s*>/i.test(extracted);
    const repaired = this.repairHtmlDocument(extracted);
    this.logger.log(
      `[document-pdf-html-pagination] jobId=${input.request.job.id} attempt=${String(input.attempt)} paginationEnhanced=${String(repaired.paginationEnhanced)} theadPromoted=${String(repaired.theadPromoted)}`
    );
    // bodyTextShort = body text is below 50% of the minimum threshold,
    // indicating the model cut off very early rather than producing a
    // legitimately short but complete document.
    const bodyTextShort =
      repaired.bodyTextLength < DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH * TRUNCATION_BODY_TEXT_FRACTION;
    // Truncation fires when: (a) the LLM explicitly reported truncation via
    // response.truncated === true (ADR-122 Slice 3 propagation), OR (b) closing
    // tags are missing AND body text is very short (provider cut off mid-generation).
    const isTruncated =
      response.truncated === true ||
      (!hasHtmlCloseInExtracted && !hasBodyCloseInExtracted && bodyTextShort);
    if (!isTruncated && repaired.bodyTextLength < DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH) {
      throw new Error(
        `Document HTML generation produced too little body text (length=${String(
          repaired.bodyTextLength
        )}, minimum=${String(DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH)}).`
      );
    }
    return {
      htmlContent: repaired.html,
      bodyTextLength: repaired.bodyTextLength,
      isTruncated,
      usage: response.usage ?? null
    };
  }

  private buildPdfContentRequest(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
      filename: string;
      attempt: number;
      sourceFiles: DocumentSourceFilePayload[];
    },
    providerSelection: ProviderSelection,
    maxOutputTokens: number
  ): ProviderGatewayTextGenerateRequest {
    const bundle = input.bundle;
    const request = input.request;
    const isSimplifiedRetry = input.attempt >= 2;
    const hasInlinedSource = input.sourceFiles.some((entry) => entry.text !== null);
    const baseInstructions = [
      "You are generating the real user-facing content for a PersAI PDF document job.",
      "Return ONLY the HTML document. Do not add any preamble, JSON envelope, markdown code fences, or commentary.",
      "Begin your response with <!DOCTYPE html> and end it with </html>.",
      "The HTML body must contain the actual document content, not meta commentary about the request.",
      "Do not include sections titled Prompt, Instructions, Source User Message, Outline, PersAI Document Draft, or any internal/debug labels.",
      "Do not mention templates, providers, job ids, system prompts, or internal architecture.",
      "Write the document in the user's apparent language unless the request clearly asks for another language.",
      "Default to a restrained editorial document style on a white page background: strong heading hierarchy, calm spacing, readable body copy, and light structural accents only where they help scanning.",
      "Unless the user explicitly asks for bold branding, loud colors, or full-page backgrounds, avoid full-bleed colored pages, heavy gradients, and decorative color blocks.",
      "Use semantic structure with coherent headings (<h1>/<h2>/<h3>), paragraphs, lists, blockquotes, and simple tables when helpful.",
      'Use <blockquote> for quoted material, <section class="callout"> or <div class="card"> for short highlighted facts/KPIs/summary boxes, and keep tables clean with <thead>/<tbody> when a table has a header row.',
      "Close every tag you open. Never leave dangling <td>, <tr>, <ul>, <p>, or other elements unclosed.",
      "Do not embed external scripts, iframes, remote stylesheets, or remote images.",
      ...(hasInlinedSource
        ? [
            "SOURCE FILES: the user attached one or more source files. Their actual text content is included in the `sourceFiles[].text` field of this prompt.",
            "When the user asks to rebuild, convert, restyle, translate, summarize, or otherwise transform an attached file, you MUST use the provided source text as the document body. Do NOT invent placeholder content, generic templates, or test data.",
            "When `documentRequest.prompt` requests presentation/formatting changes (colors, layout, structure), apply them to the actual source content from `sourceFiles[].text`, do not replace the content with a fresh assistant-generated draft.",
            "Preserve the user's headings, sections, numbered lists, table structure, and overall information from the source files; only restructure or restyle if the prompt explicitly asks for that."
          ]
        : []),
      ...(input.sourceFiles.some((entry) => entry.text === null)
        ? [
            "UNPARSEABLE SOURCE FILES: some attached files are listed under `sourceFiles[]` with `text: null` (e.g. images, archives, encrypted/scanned PDFs without selectable text, oversized files). The worker tried to extract their text and could not — the matching `note` explains why. Do NOT pretend you have read those files; if the user explicitly asked to rebuild from one of them, briefly tell them what blocked the extraction (per the `note`) and ask for a smaller / unencrypted / OCR-ed version, or paste of the relevant excerpt."
          ]
        : []),
      "Pagination guidance (the renderer applies print-CSS automatically; you do NOT add inline styles for these):",
      '- If the document has a cover/title page, wrap it as <section class="cover-page">...</section>. It will start on its own printed page automatically.',
      "- For long tables, ALWAYS put the header row inside <thead> with <th> cells, and data rows inside <tbody>. The header repeats on every printed page automatically.",
      "- Do NOT put summary/total rows in <tfoot> unless they must repeat on every page; put them as the last <tbody> row instead.",
      '- Wrap small blocks that must stay together on one page (KPI cards, signature blocks, info boxes, definition lists, short quotes) in <section class="keep-together">, <section class="callout">, or <div class="card">.',
      "- Group each major section under <section> with its heading and first paragraph/list/table together so page breaks do not leave a heading stranded at the bottom of a page.",
      '- Do NOT insert manual page breaks like <div style="page-break-before:always"> or empty spacer divs. The renderer handles page breaks via CSS.',
      "- Keep lists, quotes, tables, and callout/card blocks compact enough to respect print margins; prefer splitting long sections across pages at natural subsection boundaries instead of mid-paragraph."
    ];
    const retryInstructions = isSimplifiedRetry
      ? [
          "RETRY MODE: keep the document compact (roughly one to two pages of body).",
          "Avoid nested tables, complex inline styles, or multi-column layouts. Use a flat structure of <h1>/<h2>/<p>/<ul>/<table>.",
          "Prefer short paragraphs and concise bullet points over long prose."
        ]
      : [];
    const developerInstructions = [[...baseInstructions, ...retryInstructions].join("\n")]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n");

    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildDocumentWorkerSystemPrompt(),
      ...(developerInstructions.length === 0 ? {} : { developerInstructions }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "document_pdf_html_generation",
                  attempt: input.attempt,
                  simplifiedRetry: isSimplifiedRetry,
                  currentTimeIso: new Date().toISOString(),
                  documentRequest: {
                    descriptorMode: request.directToolExecution.descriptorMode,
                    prompt: request.directToolExecution.request.prompt,
                    instructions: request.directToolExecution.request.instructions ?? null,
                    requestedName: request.directToolExecution.request.requestedName ?? null,
                    outline: request.directToolExecution.request.outline ?? null,
                    outputFormat: request.job.outputFormat,
                    filename: input.filename
                  },
                  sourceUserMessage: {
                    text: request.job.sourceUserMessageText,
                    createdAt: request.job.sourceUserMessageCreatedAt
                  },
                  sourceFiles: input.sourceFiles.map((entry) => ({
                    filename: entry.filename,
                    mimeType: entry.mimeType,
                    sizeBytes: entry.sizeBytes,
                    text: entry.text,
                    note: entry.note
                  })),
                  assistant: {
                    name: bundle.persona.displayName,
                    userLocale: bundle.userContext.locale,
                    userTimezone: bundle.userContext.timezone
                  }
                },
                null,
                2
              )
            }
          ]
        }
      ],
      maxOutputTokens,
      requestMetadata: {
        runtimeSessionId: `document-job:${request.job.id}`,
        runtimeRequestId: `document-html:${request.job.id}:attempt-${String(input.attempt)}`,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "document_html_generation"
      },
      // ADR-097 Slice 3: raise LLM timeout for document_html_generation to support 64k token output.
      timeoutMsHint: DOCUMENT_CLASSIFICATION_TIMEOUT_MS
    };
  }

  private async validateGeneratedPdfArtifact(
    buffer: Buffer,
    context: { jobId: string; attempt: number }
  ): Promise<{
    code: string;
    message: string;
    metadata: Record<string, unknown>;
  } | null> {
    if (buffer.length === 0) {
      return {
        code: "document_pdf_empty",
        message: "Document provider returned an empty PDF payload.",
        metadata: {
          bytes: 0
        }
      };
    }
    if (buffer.length < PDF_VALIDATION_MIN_BYTES) {
      return {
        code: "document_pdf_too_small",
        message: "Rendered PDF payload is too small to be trusted as a real document.",
        metadata: {
          bytes: buffer.length,
          minBytes: PDF_VALIDATION_MIN_BYTES
        }
      };
    }
    const head = buffer.subarray(0, 8).toString("utf8");
    if (!head.startsWith("%PDF-")) {
      return {
        code: "document_pdf_missing_magic",
        message: "Rendered PDF payload does not start with the %PDF- magic header.",
        metadata: {
          bytes: buffer.length,
          headHex: buffer.subarray(0, 8).toString("hex")
        }
      };
    }
    const tail = buffer
      .subarray(Math.max(0, buffer.length - PDF_VALIDATION_TAIL_INSPECTION_BYTES))
      .toString("utf8");
    if (!tail.includes("%%EOF")) {
      return {
        code: "document_pdf_missing_eof",
        message: "Rendered PDF payload is missing the trailing %%EOF marker.",
        metadata: {
          bytes: buffer.length,
          tailTrailerPreview: tail.slice(-200)
        }
      };
    }
    const rawText = this.normalizeExtractedPdfText(buffer.toString("utf8"));
    const extraction = await this.extractPdfText(buffer);
    if (extraction.text === null) {
      this.logger.warn(
        `[document-pdf-text-extraction-soft-fail] jobId=${context.jobId} attempt=${String(
          context.attempt
        )} bytes=${String(buffer.length)} error=${extraction.error ?? "unknown"}. Relying on byte/structure checks only.`
      );
    }
    const candidateText = extraction.text ?? rawText;
    const hasDebugMarkers =
      this.looksLikeDebugDraft(rawText) || this.looksLikeDebugDraft(candidateText);
    if (hasDebugMarkers) {
      return {
        code: "document_pdf_debug_output",
        message:
          "Rendered PDF contains PersAI debug-draft content instead of the real document body.",
        metadata: {
          rawPreview: rawText.slice(0, 240),
          extractedPreview: candidateText.slice(0, 240)
        }
      };
    }
    if (extraction.text !== null) {
      const alnumCount = extraction.text.match(/[0-9A-Za-z\u0400-\u04FF]/g)?.length ?? 0;
      if (
        extraction.text.length < PDF_VALIDATION_MIN_TEXT_LENGTH ||
        alnumCount < PDF_VALIDATION_MIN_ALNUM_COUNT
      ) {
        return {
          code: "document_pdf_emptyish_output",
          message:
            "Rendered PDF does not contain enough real document text to be delivered honestly.",
          metadata: {
            extractedLength: extraction.text.length,
            alnumCount,
            extractedPreview: extraction.text.slice(0, 240)
          }
        };
      }
    }
    return null;
  }

  /**
   * Validates an Office Open XML artifact (xlsx or docx) by checking the
   * ZIP local-file-header magic bytes (PK\x03\x04) and a non-trivial minimum
   * size. Does NOT attempt to parse the ZIP; that would require a full Office
   * library. The magic check is sufficient to catch empty files, truncated
   * downloads, and obviously wrong content (e.g. a Python error traceback).
   */
  private validateGeneratedOfficeArtifact(
    buffer: Buffer,
    context: { jobId: string; mimeType: string }
  ): { code: string; message: string; metadata: Record<string, unknown> } | null {
    const OFFICE_VALIDATION_MIN_BYTES = 512;
    if (buffer.length === 0) {
      return {
        code: "document_office_empty",
        message: "Office document provider returned an empty payload.",
        metadata: { bytes: 0, mimeType: context.mimeType }
      };
    }
    if (buffer.length < OFFICE_VALIDATION_MIN_BYTES) {
      return {
        code: "document_office_too_small",
        message: "Office document payload is too small to be a real Office file.",
        metadata: {
          bytes: buffer.length,
          minBytes: OFFICE_VALIDATION_MIN_BYTES,
          mimeType: context.mimeType
        }
      };
    }
    // ZIP local-file-header magic: 50 4B 03 04
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
      return {
        code: "document_office_missing_magic",
        message:
          "Office document payload does not start with the ZIP local-file-header (PK\\x03\\x04). The Python program likely failed to write a valid file.",
        metadata: {
          bytes: buffer.length,
          headHex: buffer.subarray(0, 8).toString("hex"),
          mimeType: context.mimeType
        }
      };
    }
    return null;
  }

  private looksLikeDebugDraft(text: string): boolean {
    const normalized = text.toLowerCase();
    if (!normalized.includes("persai document draft")) {
      return false;
    }
    return (
      normalized.includes("source user message") ||
      normalized.includes("prompt") ||
      normalized.includes("instructions") ||
      normalized.includes("outline")
    );
  }

  private async extractPdfText(
    buffer: Buffer
  ): Promise<{ text: string | null; error: string | null }> {
    try {
      return {
        text: this.normalizeExtractedPdfText(await this.parsePdfBuffer(buffer)),
        error: null
      };
    } catch (error) {
      return {
        text: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async parsePdfBuffer(buffer: Buffer): Promise<string> {
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

  private normalizeExtractedPdfText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private async persistGeneratedArtifact(input: {
    assistantId: string;
    workspaceId: string;
    handle: string;
    siblingHandles: readonly string[];
    workspaceQuotaBytes: number | null;
    sharedQuotaBytes: number | null;
    filename: string;
    requestPrompt: string;
    requestedName: string | null;
    buffer: Buffer;
    mimeType: string;
    billingFacts?: RuntimeOutputArtifact["billingFacts"];
  }): Promise<RuntimeOutputArtifact> {
    const extension = this.extensionForMimeType(input.mimeType);
    if (extension === null) {
      throw new Error(`Document provider returned unsupported MIME type "${input.mimeType}".`);
    }
    if (input.buffer.length === 0) {
      throw new Error("Document provider returned an empty document payload.");
    }
    const slugSourceText =
      input.requestedName?.trim() || input.requestPrompt.trim() || input.filename || "document";
    return writeRuntimeOutboundArtifact({
      sandboxClient: this.sandboxClientService,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      handle: input.handle,
      siblingHandles: input.siblingHandles,
      workspaceQuotaBytes: input.workspaceQuotaBytes,
      sharedQuotaBytes: input.sharedQuotaBytes,
      buffer: input.buffer,
      mimeType: input.mimeType,
      slugSourceText,
      filenameHint: input.filename,
      kind: "file",
      sourceToolCode: "document",
      billingFacts: input.billingFacts ?? null
    });
  }

  private extensionForMimeType(mimeType: string): "pdf" | "pptx" | "xlsx" | "docx" | null {
    if (mimeType === "application/pdf") {
      return "pdf";
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      return "pptx";
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return "xlsx";
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return "docx";
    }
    return null;
  }

  private resolveWorkerTimeoutMs(bundle: AssistantRuntimeBundle): number {
    const configured =
      bundle.runtime.workerTools.tools.find((tool) => tool.toolCode === "document")?.timeoutMs ??
      null;
    return Number.isInteger(configured) && Number(configured) > 0
      ? Number(configured)
      : DEFAULT_DOCUMENT_TIMEOUT_MS;
  }

  /**
   * ADR-122 Slice 2: Resolve the effective max output tokens for document
   * generation calls by delegating to the unified resolveModelOutputBudget
   * helper. Reads admin-managed maxOutputTokens and contextWindow from the
   * matching routing slot (live from Slice 1). Documents do not use thinking,
   * so thinkingBudget is 0. inputTokensEstimate is null (skips context guard)
   * because document requests are large variable-length prompts that are not
   * cheaply estimated at this call site.
   */
  private resolveMaxOutputTokens(
    bundle: AssistantRuntimeBundle,
    providerSelection: ProviderSelection
  ): number {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const modelSlots = this.asObject(routing?.modelSlots);
    const allSlots = modelSlots
      ? Object.values(modelSlots)
          .map((slot) => this.asObject(slot))
          .filter((slot): slot is Record<string, unknown> => slot !== null)
      : [];
    // Prefer a slot whose modelKey matches the destination model EXACTLY so we
    // never return a different model's ceiling (e.g. the normalReply gpt-5 128k
    // capability for a gpt-4o-mini document call, which would 400 on OpenAI).
    // Fall back to a provider-wide match only when no exact-model slot carries
    // capability fields.
    const exactModelSlots = allSlots.filter(
      (slot) => this.asNonEmptyString(slot.modelKey) === providerSelection.model
    );
    const providerSlots = allSlots.filter(
      (slot) =>
        this.asNonEmptyString(slot.modelKey) !== providerSelection.model &&
        this.asNonEmptyString(slot.providerKey) === providerSelection.provider
    );
    for (const slot of [...exactModelSlots, ...providerSlots]) {
      const maxOutputTokens =
        typeof slot.maxOutputTokens === "number" && Number.isFinite(slot.maxOutputTokens)
          ? slot.maxOutputTokens
          : null;
      const contextWindow =
        typeof slot.contextWindow === "number" && Number.isFinite(slot.contextWindow)
          ? slot.contextWindow
          : null;
      if (maxOutputTokens !== null || contextWindow !== null) {
        return resolveModelOutputBudget(
          { maxOutputTokens, contextWindow },
          { inputTokensEstimate: null, thinkingBudget: 0 }
        );
      }
    }
    // No matching slot with capability fields: use the sanity cap as the
    // conservative default via resolveModelOutputBudget (OUTPUT_BUDGET_FALLBACK).
    return resolveModelOutputBudget(
      { maxOutputTokens: null, contextWindow: null },
      { inputTokensEstimate: null, thinkingBudget: 0 }
    );
  }

  private resolveProviderSelection(
    bundle: AssistantRuntimeBundle,
    modelRole: PersaiRuntimeModelRole
  ): ProviderSelection {
    const direct = this.resolveModelSlotSelection(bundle, modelRole);
    if (direct !== null) {
      return direct;
    }
    const normal = this.resolveModelSlotSelection(bundle, "normal_reply");
    if (normal !== null) {
      return normal;
    }
    const primaryPath = this.asObject(
      this.asObject(bundle.runtime.runtimeProviderRouting)?.primaryPath
    );
    const primaryProvider = this.asNativeManagedProvider(primaryPath?.providerKey);
    const primaryModel = this.asNonEmptyString(primaryPath?.modelKey);
    if (primaryProvider !== null && primaryModel !== null) {
      return { provider: primaryProvider, model: primaryModel };
    }
    const profilePrimary = this.asObject(
      this.asObject(bundle.runtime.runtimeProviderProfile)?.primary
    );
    const profileProvider = this.asNativeManagedProvider(profilePrimary?.provider);
    const profileModel = this.asNonEmptyString(profilePrimary?.model);
    if (profileProvider !== null && profileModel !== null) {
      return { provider: profileProvider, model: profileModel };
    }
    throw new BadRequestException(
      "Runtime bundle does not declare a provider/model for document generation."
    );
  }

  private resolveModelSlotSelection(
    bundle: AssistantRuntimeBundle,
    modelRole: PersaiRuntimeModelRole
  ): ProviderSelection | null {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const modelSlots = this.asObject(routing?.modelSlots);
    const slotKey =
      modelRole === "premium_reply"
        ? "premiumReply"
        : modelRole === "reasoning"
          ? "reasoning"
          : modelRole === "system_tool"
            ? "systemTool"
            : modelRole === "retrieval"
              ? "retrieval"
              : "normalReply";
    const slot = this.asObject(modelSlots?.[slotKey]);
    const provider = this.asNativeManagedProvider(slot?.providerKey);
    const model = this.asNonEmptyString(slot?.modelKey);
    return provider !== null && model !== null ? { provider, model } : null;
  }

  private resolveDocumentGenerationProviderSelection(
    bundle: AssistantRuntimeBundle
  ): ProviderSelection {
    const systemTool = this.resolveModelSlotSelection(bundle, "system_tool");
    if (systemTool !== null) {
      return systemTool;
    }
    return this.resolveProviderSelection(bundle, "premium_reply");
  }

  private buildDocumentWorkerSystemPrompt(): string {
    return [
      "You are a non-conversational document generation worker inside PersAI.",
      "Ignore chat persona tone, greetings, relationship framing, and follow-up suggestions unless the explicit document request requires them in the document body itself.",
      "Produce only the exact structured output requested for this document stage."
    ].join(" ");
  }

  private shouldUseDirectSourceTransfer(request: RuntimeDocumentJobRunRequest): boolean {
    return request.directToolExecution.request.transferMode === "verbatim";
  }

  private buildStructuredSourcePreservingCreateHtml(input: {
    sourceFiles: DocumentSourceFilePayload[];
    request: RuntimeDocumentJobRunRequest;
  }): {
    htmlContent: string;
    bodyTextLength: number;
    sourceTextChars: number;
    structure: PersaiDocumentStructureSnapshot;
    style: PersaiDocumentStyleProfile;
  } {
    const extractedText = input.sourceFiles
      .map((sourceFile) => sourceFile.text ?? "")
      .filter((text) => text.trim().length > 0)
      .join("\n\n")
      .trim();
    if (extractedText.length === 0) {
      throw new Error(
        "Structured source-preserving create requested but no extracted source text is available."
      );
    }
    const structure = buildStructureFromExtractedText(extractedText);
    const style =
      input.request.directToolExecution.request.transferMode === "transform"
        ? createTransformStyleProfile()
        : createDefaultStyleProfile();
    const rawHtml = renderStructureToHtml(structure, style);
    const repaired = this.repairHtmlDocument(rawHtml);
    if (repaired.bodyTextLength < DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH) {
      throw new Error(
        `Structured source-preserving create produced too little body text (length=${String(
          repaired.bodyTextLength
        )}, minimum=${String(DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH)}).`
      );
    }
    return {
      htmlContent: repaired.html,
      bodyTextLength: repaired.bodyTextLength,
      sourceTextChars: extractedText.length,
      structure,
      style
    };
  }

  private buildDirectSourceTransferHtml(input: {
    sourceFiles: DocumentSourceFilePayload[];
    structuredSnapshot: boolean;
  }): {
    htmlContent: string;
    bodyTextLength: number;
    structure: PersaiDocumentStructureSnapshot | null;
    style: PersaiDocumentStyleProfile | null;
  } {
    const extractedText = input.sourceFiles
      .map((sourceFile) => sourceFile.text ?? "")
      .filter((text) => text.trim().length > 0)
      .join("\n\n")
      .trim();
    if (extractedText.length === 0) {
      throw new Error(
        "Direct source transfer requested but no extracted source text is available."
      );
    }
    if (input.structuredSnapshot) {
      const structure = buildStructureFromExtractedText(extractedText);
      const style = createDefaultStyleProfile();
      const rawHtml = renderStructureToHtml(structure, style);
      const repaired = this.repairHtmlDocument(rawHtml);
      if (repaired.bodyTextLength < DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH) {
        throw new Error(
          `Direct source transfer produced too little body text (length=${String(
            repaired.bodyTextLength
          )}, minimum=${String(DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH)}).`
        );
      }
      return {
        htmlContent: repaired.html,
        bodyTextLength: repaired.bodyTextLength,
        structure,
        style
      };
    }
    const rawHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><article>${this.renderVerbatimSourceText(extractedText)}</article></body></html>`;
    const repaired = this.repairHtmlDocument(rawHtml);
    if (repaired.bodyTextLength < DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH) {
      throw new Error(
        `Direct source transfer produced too little body text (length=${String(
          repaired.bodyTextLength
        )}, minimum=${String(DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH)}).`
      );
    }
    return {
      htmlContent: repaired.html,
      bodyTextLength: repaired.bodyTextLength,
      structure: null,
      style: null
    };
  }

  private renderVerbatimSourceText(text: string): string {
    const blocks = text
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);
    if (blocks.length === 0) {
      return `<p>${this.escapeHtml(text.trim())}</p>`;
    }
    return blocks
      .map((block) => {
        if (this.looksLikeStandaloneHeading(block)) {
          return `<h2>${this.escapeHtml(block)}</h2>`;
        }
        const lines = block
          .split("\n")
          .map((line) => this.escapeHtml(line.trimEnd()))
          .filter((line) => line.length > 0);
        return `<p>${lines.join("<br>")}</p>`;
      })
      .join("\n");
  }

  private looksLikeStandaloneHeading(block: string): boolean {
    if (block.includes("\n") || block.length > 120) {
      return false;
    }
    if (/^\d+([.)]|\.)\s/.test(block)) {
      return false;
    }
    if (/[.!?;:]$/.test(block)) {
      return false;
    }
    return block === block.toUpperCase();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Pulls the HTML document out of whatever the model returned.
   *
   * Accepts:
   * - raw HTML starting with <!DOCTYPE html>, <html>, <body>, <section>, <article>, <main>, <div>, <table>, <h1>, <h2>
   * - HTML wrapped in ```html``` or ``` ``` markdown fences
   * - JSON envelopes like {"htmlContent": "..."} (defensive: some models still
   *   reflexively wrap raw HTML in a JSON object even when the prompt asks for
   *   raw HTML)
   * - HTML wrapped in surrounding quotes / escaped JSON-style strings
   *
   * Returns null only when nothing recognizable is found.
   */
  private extractHtmlFromModelOutput(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const unfenced = this.stripMarkdownFences(trimmed);
    const candidate = this.unquoteAndUnescape(unfenced);
    const direct = this.locateHtmlStart(candidate);
    if (direct !== null) {
      return this.trimToHtmlEnd(direct);
    }
    const jsonRecovered = this.tryRecoverHtmlFromJsonEnvelope(candidate);
    if (jsonRecovered !== null) {
      return this.trimToHtmlEnd(jsonRecovered);
    }
    return null;
  }

  private stripMarkdownFences(value: string): string {
    const match = value.match(/^```(?:html|json|xml)?\s*([\s\S]*?)\s*```\s*$/i);
    return match?.[1]?.trim() ?? value;
  }

  private unquoteAndUnescape(value: string): string {
    let normalized = value.trim();
    if (
      (normalized.startsWith('"') && normalized.endsWith('"') && normalized.length > 2) ||
      (normalized.startsWith("'") && normalized.endsWith("'") && normalized.length > 2)
    ) {
      normalized = normalized.slice(1, -1).trim();
    }
    if (normalized.includes("\\n") || normalized.includes('\\"')) {
      normalized = normalized
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, "\\")
        .trim();
    }
    return normalized;
  }

  private locateHtmlStart(value: string): string | null {
    const lower = value.toLowerCase();
    const candidates = [
      lower.indexOf("<!doctype html"),
      lower.indexOf("<html"),
      lower.indexOf("<body"),
      lower.search(/<(section|article|main|div|table|h1|h2)\b/)
    ].filter((idx) => idx !== -1);
    if (candidates.length === 0) {
      return null;
    }
    const startIdx = Math.min(...candidates);
    return value.slice(startIdx).trim();
  }

  private trimToHtmlEnd(value: string): string {
    const closingIdx = value.toLowerCase().lastIndexOf("</html>");
    if (closingIdx === -1) {
      return value.trim();
    }
    return value.slice(0, closingIdx + "</html>".length).trim();
  }

  private tryRecoverHtmlFromJsonEnvelope(value: string): string | null {
    const trimmed = value.trim();
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
      return null;
    }
    const objectSlice = trimmed.slice(objectStart, objectEnd + 1);
    try {
      const parsed = JSON.parse(objectSlice) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const inner = (parsed as Record<string, unknown>).htmlContent;
        if (typeof inner === "string" && inner.trim().length > 0) {
          return this.locateHtmlStart(inner) ?? this.unquoteAndUnescape(inner);
        }
      }
    } catch {
      // ignore — fall back to substring extraction
    }
    const keyIdx = trimmed.indexOf('"htmlContent"');
    if (keyIdx === -1) {
      return null;
    }
    const colonIdx = trimmed.indexOf(":", keyIdx);
    if (colonIdx === -1) {
      return null;
    }
    const afterColon = trimmed.slice(colonIdx + 1).trimStart();
    if (afterColon.startsWith('"')) {
      const innerStart = colonIdx + 1 + (trimmed.slice(colonIdx + 1).length - afterColon.length);
      const tail = trimmed.slice(innerStart + 1);
      const innerEnd = tail.lastIndexOf('"');
      if (innerEnd > 0) {
        const inner = tail.slice(0, innerEnd);
        return this.locateHtmlStart(inner) ?? this.unquoteAndUnescape(inner);
      }
    }
    return this.locateHtmlStart(afterColon);
  }

  /**
   * Backend HTML repair pass.
   *
   * Uses parse5 (a forgiving HTML5 parser) to:
   * - parse whatever HTML fragment we got from the model,
   * - implicitly create <html>/<head>/<body> wrappers if missing,
   * - close any tags the model forgot to close,
   * - drop nothing — parse5 keeps content even when structure is broken,
   * - re-serialize back into clean, well-formed HTML the sandbox renderer can render.
   *
   * Also injects a baseline print CSS so any HTML the model gives us renders as
   * a real document (typography, headings, lists, tables) instead of an
   * unstyled wall of text. Returns the visible body text length so callers can
   * reject obviously empty documents before sending to the render engine.
   */
  private repairHtmlDocument(htmlInput: string): {
    html: string;
    bodyTextLength: number;
    paginationEnhanced: boolean;
    theadPromoted: number;
  } {
    const activeCss = DOCUMENT_HTML_ENHANCED_PRINT_CSS;
    const paginationEnhanced = true;
    let parse5: {
      parse: (html: string) => Parse5Document;
      serialize: (node: Parse5Node) => string;
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      parse5 = require("parse5") as {
        parse: (html: string) => Parse5Document;
        serialize: (node: Parse5Node) => string;
      };
    } catch (error) {
      this.logger.warn(
        `[document-pdf-html-repair-soft-fail] parse5 unavailable, falling back to passthrough: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      const fallback = this.wrapHtmlInBoilerplate(htmlInput, activeCss);
      const fallbackText = this.extractPlainTextFromHtmlPassthrough(htmlInput);
      return {
        html: fallback,
        bodyTextLength: fallbackText.length,
        paginationEnhanced,
        theadPromoted: 0
      };
    }
    const document = parse5.parse(htmlInput);
    const body = this.findFirstNodeByTagName(document, "body");
    const head = this.findFirstNodeByTagName(document, "head");
    if (head !== null && !this.hasStyleChild(head)) {
      this.appendStyleNodeToHead(head, activeCss);
    }
    // For long tables, Chromium only repeats the header row across pages when
    // it is wrapped in <thead>. Models often forget the <thead> wrapper and
    // put the header row directly into <tbody> (or under <table> with no
    // tbody). Auto-promote the first row to <thead> when it contains only
    // <th> cells and no <thead> exists yet. Tables that already have <thead>
    // or whose first row is not header-only are left untouched.
    const theadPromoted = paginationEnhanced ? this.promoteImplicitTheads(document) : 0;
    const bodyText = body === null ? "" : this.collectVisibleTextFromNode(body);
    const bodyTextLength = bodyText.replace(/\s+/g, " ").trim().length;
    let serialized = parse5.serialize(document).trim();
    if (!/^<!doctype/i.test(serialized)) {
      serialized = `<!DOCTYPE html>\n${serialized}`;
    }
    if (!/<style/i.test(serialized)) {
      serialized = serialized.replace(/<\/head>/i, `<style>${activeCss}</style></head>`);
    }
    return { html: serialized, bodyTextLength, paginationEnhanced, theadPromoted };
  }

  private wrapHtmlInBoilerplate(value: string, css: string): string {
    const normalized = value.trim();
    const lower = normalized.toLowerCase();
    if (lower.startsWith("<!doctype")) {
      return normalized;
    }
    if (lower.startsWith("<html")) {
      return `<!DOCTYPE html>\n${normalized}`;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${normalized}</body></html>`;
  }

  private extractPlainTextFromHtmlPassthrough(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private findFirstNodeByTagName(node: Parse5Node, tagName: string): Parse5Node | null {
    if (node.tagName === tagName) {
      return node;
    }
    for (const child of node.childNodes ?? []) {
      const found = this.findFirstNodeByTagName(child, tagName);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  private hasStyleChild(node: Parse5Node): boolean {
    for (const child of node.childNodes ?? []) {
      if (child.tagName === "style") {
        return true;
      }
    }
    return false;
  }

  private appendStyleNodeToHead(head: Parse5Node, css: string): void {
    const styleNode: Parse5Node = {
      nodeName: "style",
      tagName: "style",
      attrs: [],
      namespaceURI: "http://www.w3.org/1999/xhtml",
      childNodes: [
        {
          nodeName: "#text",
          value: css,
          parentNode: null
        }
      ],
      parentNode: head
    };
    const firstChild = styleNode.childNodes?.[0];
    if (firstChild !== undefined) {
      firstChild.parentNode = styleNode;
    }
    head.childNodes = [...(head.childNodes ?? []), styleNode];
  }

  /**
   * For every <table> in the document, if it has no <thead> but its first row
   * (anywhere — either directly under <table> or under an existing <tbody>)
   * contains only <th> cells, wrap that row in a new <thead>. Returns the
   * number of tables that were modified so callers can log/test the effect.
   *
   * Why: WeasyPrint / Chromium only repeats the table header on every printed
   * page when the header row is inside <thead>. Models routinely forget the
   * <thead> wrapper. This safe, syntactic auto-promote fixes the common case
   * without changing any visible content.
   *
   * Safety:
   * - tables with an existing <thead> are left untouched (no double-wrap),
   * - tables whose first row mixes <th> and <td> are left untouched (it is
   *   probably a data row with a leading header cell, not a header row),
   * - tables whose first row has any non-<th> non-whitespace child are left
   *   untouched.
   */
  private promoteImplicitTheads(node: Parse5Node): number {
    let promoted = 0;
    if (node.tagName === "table") {
      const hasExistingThead = (node.childNodes ?? []).some((child) => child.tagName === "thead");
      if (!hasExistingThead) {
        const firstRowLocation = this.findFirstRowOfTable(node);
        if (firstRowLocation !== null && this.isHeaderOnlyRow(firstRowLocation.row)) {
          this.wrapRowInThead(node, firstRowLocation);
          promoted += 1;
        }
      }
    }
    for (const child of node.childNodes ?? []) {
      promoted += this.promoteImplicitTheads(child);
    }
    return promoted;
  }

  private findFirstRowOfTable(table: Parse5Node): { row: Parse5Node; parent: Parse5Node } | null {
    for (const child of table.childNodes ?? []) {
      if (child.tagName === "tr") {
        return { row: child, parent: table };
      }
      if (child.tagName === "tbody") {
        for (const grandChild of child.childNodes ?? []) {
          if (grandChild.tagName === "tr") {
            return { row: grandChild, parent: child };
          }
        }
      }
    }
    return null;
  }

  private isHeaderOnlyRow(row: Parse5Node): boolean {
    let sawHeaderCell = false;
    for (const child of row.childNodes ?? []) {
      if (child.nodeName === "#text") {
        if (typeof child.value === "string" && child.value.trim().length > 0) {
          return false;
        }
        continue;
      }
      if (child.tagName === "th") {
        sawHeaderCell = true;
        continue;
      }
      // Any other element (td, span, etc.) disqualifies this row as a header.
      return false;
    }
    return sawHeaderCell;
  }

  private wrapRowInThead(
    table: Parse5Node,
    location: { row: Parse5Node; parent: Parse5Node }
  ): void {
    const theadNode: Parse5Node = {
      nodeName: "thead",
      tagName: "thead",
      attrs: [],
      namespaceURI: "http://www.w3.org/1999/xhtml",
      childNodes: [location.row],
      parentNode: table
    };
    location.row.parentNode = theadNode;
    if (location.parent === table) {
      const remainingChildren = (table.childNodes ?? []).filter((child) => child !== location.row);
      table.childNodes = [theadNode, ...remainingChildren];
    } else {
      const parent = location.parent;
      parent.childNodes = (parent.childNodes ?? []).filter((child) => child !== location.row);
      const tableChildren = table.childNodes ?? [];
      const parentIndex = tableChildren.indexOf(parent);
      const insertIndex = parentIndex >= 0 ? parentIndex : tableChildren.length;
      const next = [...tableChildren];
      next.splice(insertIndex, 0, theadNode);
      table.childNodes = next;
    }
  }

  private collectVisibleTextFromNode(node: Parse5Node): string {
    if (node.nodeName === "#text") {
      return typeof node.value === "string" ? node.value : "";
    }
    if (
      node.tagName === "script" ||
      node.tagName === "style" ||
      node.tagName === "noscript" ||
      node.tagName === "template"
    ) {
      return "";
    }
    let collected = "";
    for (const child of node.childNodes ?? []) {
      collected += `${this.collectVisibleTextFromNode(child)} `;
    }
    return collected;
  }

  private normalizeOptionalText(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asNativeManagedProvider(value: unknown): NativeManagedProvider | null {
    return value === "openai" || value === "anthropic" ? value : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private hashPrompt(prompt: string): string {
    let hash = 0;
    for (let index = 0; index < prompt.length; index += 1) {
      hash = (hash * 31 + prompt.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
  }

  private async renderHtmlToPdf(input: {
    bundle: AssistantRuntimeBundle;
    html: string;
    filename: string;
    jobId: string;
    chatId: string;
  }): Promise<
    | { ok: true; bytes: Buffer; mimeType: "application/pdf" }
    | { ok: false; code: string; message: string; retryable: boolean }
  > {
    // Render policy: start from bundle sandbox policy and override for render operation.
    // Uses ephemeral pod (runtimeSessionId: null) so renders never contend the user's session workspace.
    const basePolicy =
      (input.bundle.runtime.sandbox as RuntimeSandboxPolicy | null | undefined) ??
      DEFAULT_RUNTIME_SANDBOX_POLICY;
    const renderPolicy: RuntimeSandboxPolicy = {
      ...basePolicy,
      enabled: true,
      maxProcessRuntimeMs: 90_000,
      maxCpuMsPerJob: 90_000,
      maxSingleFileWriteBytes: Math.max(basePolicy.maxSingleFileWriteBytes, 50 * 1024 * 1024),
      maxWorkspaceBytesPerJob: Math.max(basePolicy.maxWorkspaceBytesPerJob, 64 * 1024 * 1024)
    };
    let result: RuntimeSandboxJobResult;
    try {
      result = await this.sandboxClientService.waitForCompletion({
        assistantId: input.bundle.metadata.assistantId,
        assistantHandle: input.bundle.metadata.assistantHandle,
        siblingHandles: input.bundle.metadata.siblingAssistantHandles,
        workspaceId: input.bundle.metadata.workspaceId,
        runtimeRequestId: input.jobId,
        runtimeSessionId: null,
        toolCode: "render_html_to_pdf",
        policy: renderPolicy,
        args: { htmlContent: input.html, outputFileName: input.filename }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: "sandbox_render_failed", message, retryable: true };
    }
    if (result.status !== "completed" || result.exitCode !== 0) {
      const message =
        result.violationMessage ?? result.stderr ?? result.reason ?? "WeasyPrint render failed.";
      return {
        ok: false,
        code: result.violationCode ?? "sandbox_render_failed",
        message,
        retryable: result.status === "failed"
      };
    }
    const producedPdf = result.files.find(
      (f) => f.relativePath.toLowerCase().endsWith(".pdf") || f.mimeType === "application/pdf"
    );
    if (producedPdf === undefined) {
      return {
        ok: false,
        code: "sandbox_render_no_pdf",
        message: "WeasyPrint completed but produced no PDF file.",
        retryable: false
      };
    }
    const bytes = await this.mediaObjectStorage.downloadObject(producedPdf.storagePath);
    if (bytes === null) {
      return {
        ok: false,
        code: "sandbox_render_download_failed",
        message: "Failed to download rendered PDF from object storage.",
        retryable: true
      };
    }
    return { ok: true, bytes, mimeType: "application/pdf" };
  }

  /**
   * ADR-123 Slice 6 — Documents mode B: model-writes-code path.
   *
   * The LLM authors a self-contained Python 3 program that writes exactly one
   * Office/data file to /workspace/<targetFilename>. Source files are made
   * available to the program via the sandbox workspace (sandbox-first, two-tier
   * ingestion — see buildDataDocumentSourcePlan); their content is NEVER inlined
   * into the LLM prompt, so document size is unbounded by the output-token
   * budget. The program is executed inside the sandbox. On non-zero exit, one
   * self-repair attempt is made (LLM call with stderr feedback). After two
   * failures the job terminates with a non-retryable document_code_failed code.
   */
  private async runCodeDocumentPath(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    filename: string;
  }): Promise<RuntimeDocumentJobRunResult> {
    const { bundle, request, filename } = input;
    const jobId = request.job.id;
    const outputFormat = request.job.outputFormat as "pdf" | "xlsx" | "docx";
    this.logger.log(
      `[document-code-path] jobId=${jobId} outputFormat=${outputFormat} filename=${filename}`
    );

    const mimeForFormat = (fmt: string): string => {
      if (fmt === "xlsx") {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
      if (fmt === "docx") {
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      }
      return "application/pdf";
    };
    const targetMime = mimeForFormat(outputFormat);

    const providerSelection = this.resolveDocumentGenerationProviderSelection(bundle);
    const maxOutputTokens = this.resolveMaxOutputTokens(bundle, providerSelection);

    // Sandbox-first, two-tier source ingestion. Decides per source whether to
    // mount the raw file (Tier 1) or also provide an OCR text sidecar (Tier 2).
    const sourcePlan = await this.buildDataDocumentSourcePlan(request);
    this.logger.log(
      `[document-code-source-plan] jobId=${jobId} mounts=${String(
        sourcePlan.sourceMounts.length
      )} sidecars=${String(sourcePlan.textSidecars.length)}`
    );

    // First LLM call: generate the Python program (references mounted paths only).
    let programSource = await this.generateDocumentCode({
      bundle,
      request,
      filename,
      sourceDescriptors: sourcePlan.descriptors,
      providerSelection,
      maxOutputTokens,
      previousProgram: null,
      previousStderr: null,
      attempt: 1
    });

    // Sandbox execution attempt 1.
    const execResult1 = await this.executeDocumentCodeInSandbox({
      bundle,
      request,
      programSource,
      filename,
      jobId,
      sourcePlan
    });

    if (execResult1.ok) {
      return this.finalizeCodeDocumentResult({
        bundle,
        request,
        filename,
        targetMime,
        producedFile: execResult1.producedFile
      });
    }

    // Self-repair: one LLM call with stderr, then one more sandbox exec.
    this.logger.warn(
      `[document-code-path-repair] jobId=${jobId} attempt=1 exitCode=${String(
        execResult1.exitCode
      )} stderr=${String(execResult1.stderr).slice(0, 500)} — attempting self-repair`
    );
    programSource = await this.generateDocumentCode({
      bundle,
      request,
      filename,
      sourceDescriptors: sourcePlan.descriptors,
      providerSelection,
      maxOutputTokens,
      previousProgram: programSource,
      previousStderr: execResult1.stderr,
      attempt: 2
    });

    const execResult2 = await this.executeDocumentCodeInSandbox({
      bundle,
      request,
      programSource,
      filename,
      jobId,
      sourcePlan
    });

    if (execResult2.ok) {
      return this.finalizeCodeDocumentResult({
        bundle,
        request,
        filename,
        targetMime,
        producedFile: execResult2.producedFile
      });
    }

    // Both attempts failed — terminal failure, non-retryable at the provider level.
    this.logger.error(
      `[document-code-path-failed] jobId=${jobId} attempt=2 exitCode=${String(
        execResult2.exitCode
      )} stderr=${String(execResult2.stderr).slice(0, 500)}`
    );
    return this.buildCodeDocumentFailResult({
      request,
      filename,
      errorCode: "document_code_failed",
      message:
        "The data document program failed to produce a valid file after two attempts. The request cannot be retried automatically."
    });
  }

  /**
   * ADR-123 Slice 6 — sandbox-first, two-tier source ingestion plan.
   *
   * TIER 1 (default): mount the raw source file into the exec workspace so the
   * model's Python program reads it natively (pdfplumber/openpyxl/pandas/
   * python-docx). No source text is inlined into the LLM prompt → no token bound.
   *
   * TIER 2 (fallback): when a PDF has no extractable text layer (scanned) or the
   * source is an image, also provide an OCR text sidecar. The OCR text is taken
   * from sourceFiles[].text — the output of the EXISTING extraction/OCR pipeline
   * which already runs at the API scheduler (apps/api document-extraction). The
   * sandbox cannot reach the external OCR (deny-all egress), so OCR is never run
   * inside the sandbox. The text-layer decision is made here in the worker using
   * the already-present pdf-parse probe (no sandbox round-trip).
   */
  private async buildDataDocumentSourcePlan(request: RuntimeDocumentJobRunRequest): Promise<{
    inputPaths: string[];
    sourceMounts: Array<{ storagePath: string; mountPath: string }>;
    textSidecars: Array<{ mountPath: string; text: string }>;
    descriptors: string[];
  }> {
    const plan = {
      inputPaths: [] as string[],
      sourceMounts: [] as Array<{ storagePath: string; mountPath: string }>,
      textSidecars: [] as Array<{ mountPath: string; text: string }>,
      descriptors: [] as string[]
    };
    const attachments = request.attachments ?? [];
    const sourceFiles = request.sourceFiles ?? [];
    const usedNames = new Set<string>();
    for (const attachment of attachments) {
      const mime = attachment.mimeType.trim().toLowerCase();
      let baseName = this.sanitizeSourceBasename(attachment.displayName, attachment.attachmentId);
      while (usedNames.has(baseName.toLowerCase())) {
        baseName = `${randomUUID().slice(0, 4)}_${baseName}`;
      }
      usedNames.add(baseName.toLowerCase());
      const mountPath = `sources/${baseName}`;
      const wsPath = `/workspace/${mountPath}`;
      const matchedSource =
        sourceFiles.find((entry) => entry.attachmentId === attachment.attachmentId) ?? null;
      const ocrText =
        matchedSource?.text !== null &&
        matchedSource?.text !== undefined &&
        matchedSource.text.trim().length > 0
          ? matchedSource.text.trim()
          : null;
      const mountableStoragePath =
        typeof attachment.storagePath === "string" && attachment.storagePath.trim().length > 0
          ? attachment.storagePath.trim()
          : null;
      const isPdf = mime === "application/pdf" || mime === "application/x-pdf";
      const isImage = mime.startsWith("image/");

      // Without a mountable storage path we cannot mount the raw file.
      // Fall back to the extracted-text sidecar when available.
      if (mountableStoragePath === null) {
        if (ocrText !== null) {
          const sidecarPath = `sources/${baseName}.txt`;
          plan.textSidecars.push({ mountPath: sidecarPath, text: ocrText });
          plan.descriptors.push(
            `/workspace/${sidecarPath} — extracted text of "${
              attachment.displayName ?? baseName
            }" (raw file not mountable). Read this text file.`
          );
        }
        continue;
      }

      plan.inputPaths.push(mountableStoragePath);
      plan.sourceMounts.push({ storagePath: mountableStoragePath, mountPath });

      if (isPdf) {
        const probe = await this.probePdfTextLayer(attachment.storagePath);
        if (probe.hasTextLayer) {
          plan.descriptors.push(
            `${wsPath} — PDF WITH a text layer (digital). Read it directly with pdfplumber (import pdfplumber).`
          );
        } else if (ocrText !== null) {
          const sidecarPath = `${mountPath}.ocr.txt`;
          plan.textSidecars.push({ mountPath: sidecarPath, text: ocrText });
          plan.descriptors.push(
            `${wsPath} — scanned PDF (NO text layer). An OCR text sidecar is provided at /workspace/${sidecarPath}; read the sidecar (the scan has no layout to preserve).`
          );
        } else {
          plan.descriptors.push(
            `${wsPath} — scanned PDF (NO text layer) and OCR text is unavailable. Do not fabricate its contents; rely on the document request.`
          );
        }
      } else if (isImage) {
        if (ocrText !== null) {
          const sidecarPath = `${mountPath}.ocr.txt`;
          plan.textSidecars.push({ mountPath: sidecarPath, text: ocrText });
          plan.descriptors.push(
            `${wsPath} — image. An OCR text sidecar is provided at /workspace/${sidecarPath}; read the sidecar for its text content.`
          );
        } else {
          plan.descriptors.push(
            `${wsPath} — image (no OCR text available). Embed it with Pillow only if relevant.`
          );
        }
      } else if (
        mime.includes("spreadsheet") ||
        mime === "text/csv" ||
        baseName.toLowerCase().endsWith(".csv") ||
        baseName.toLowerCase().endsWith(".xlsx")
      ) {
        plan.descriptors.push(
          `${wsPath} — spreadsheet/tabular source. Read with openpyxl or pandas (pandas.read_excel / read_csv).`
        );
      } else if (mime.includes("wordprocessingml") || baseName.toLowerCase().endsWith(".docx")) {
        plan.descriptors.push(`${wsPath} — Word document. Read with python-docx (import docx).`);
      } else {
        plan.descriptors.push(
          `${wsPath} — source file. Read it with the appropriate Python library or as text.`
        );
      }
    }
    return plan;
  }

  /**
   * Cheap PDF text-layer probe using the already-present pdf-parse dependency.
   * A digital PDF yields hundreds+ of alphanumeric characters; a scanned PDF
   * yields ~none. Returns hasTextLayer=false on any download/parse failure so
   * the caller falls back to the OCR sidecar tier.
   */
  private async probePdfTextLayer(
    objectKey: string
  ): Promise<{ hasTextLayer: boolean; chars: number }> {
    try {
      const bytes = await this.mediaObjectStorage.downloadObject(objectKey);
      if (bytes === null) {
        return { hasTextLayer: false, chars: 0 };
      }
      const extraction = await this.extractPdfText(bytes);
      const text = extraction.text ?? "";
      const alnum = text.match(/[0-9A-Za-z\u0400-\u04FF]/g)?.length ?? 0;
      return { hasTextLayer: alnum >= DATA_DOC_PDF_TEXT_LAYER_MIN_ALNUM, chars: alnum };
    } catch {
      return { hasTextLayer: false, chars: 0 };
    }
  }

  private sanitizeSourceBasename(filename: string | null, attachmentId: string): string {
    const raw = (filename ?? "").trim();
    const sanitized = raw
      .replace(/[\\/]+/g, "_")
      .replace(/[:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .trim();
    if (sanitized.length > 0) {
      return sanitized;
    }
    return `source_${attachmentId.slice(0, 8)}`;
  }

  private async generateDocumentCode(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    filename: string;
    sourceDescriptors: string[];
    providerSelection: ProviderSelection;
    maxOutputTokens: number;
    previousProgram: string | null;
    previousStderr: string | null;
    attempt: number;
  }): Promise<string> {
    const { request, filename, providerSelection, maxOutputTokens, sourceDescriptors } = input;
    const outputFormat = request.job.outputFormat as string;
    const libraryHint =
      outputFormat === "xlsx"
        ? "openpyxl"
        : outputFormat === "docx"
          ? "python-docx (import docx)"
          : "weasyprint (for PDF from HTML)";
    const userPayload = {
      classification: "document_code_generation",
      mode: "document_code_generation",
      documentRequest: {
        prompt: request.directToolExecution.request.prompt,
        instructions: request.directToolExecution.request.instructions ?? null,
        outputFormat,
        requestedName: request.directToolExecution.request.requestedName ?? null,
        sourceUserMessageText: request.job.sourceUserMessageText
      },
      outputFileName: filename,
      ...(sourceDescriptors.length > 0 ? { sourceFiles: sourceDescriptors } : {}),
      ...(input.previousProgram !== null
        ? {
            previousProgram: input.previousProgram,
            previousStderr: input.previousStderr ?? ""
          }
        : {})
    };
    const repairClause =
      input.previousProgram !== null
        ? [
            "The previous program failed. The failed program is in `previousProgram` and the stderr is in `previousStderr`.",
            "Output ONLY a corrected, complete Python 3 program. Do NOT repeat the old program unless fully corrected."
          ].join(" ")
        : null;
    const sourceClause =
      sourceDescriptors.length > 0
        ? [
            "SOURCE FILES: the source file(s) are mounted in the sandbox workspace. Their paths and how to read each one are listed in `sourceFiles` of the payload.",
            "Read the actual content from those mounted files inside your program. The file content is NOT included in this prompt and there is no size limit on it.",
            "Do NOT fabricate source content; read it from the mounted paths."
          ].join(" ")
        : null;
    const developerInstructions = [
      "You are generating a self-contained Python 3 program for a PersAI data document job.",
      "Output ONLY a single Python 3 program with no markdown fences, no prose, no preamble.",
      `The program MUST write exactly one file to the absolute path /workspace/${filename} using the preinstalled ${libraryHint} library.`,
      "Preinstalled: openpyxl, python-docx, pandas, matplotlib, weasyprint, reportlab, Pillow, pdfplumber.",
      "Do NOT use pip install or import any library that is not in the preinstalled list.",
      "Do NOT make network requests (egress is deny-all).",
      "The program must be deterministic and must not print the document content to stdout.",
      ...(sourceClause !== null ? [sourceClause] : []),
      ...(repairClause !== null ? [repairClause] : [])
    ].join(" ");
    const response = await this.providerGatewayClientService.generateText({
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildDocumentWorkerSystemPrompt(),
      developerInstructions,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: JSON.stringify(userPayload, null, 2) }]
        }
      ],
      maxOutputTokens,
      requestMetadata: {
        runtimeSessionId: `document-job:${request.job.id}`,
        runtimeRequestId: `document-code:${request.job.id}:attempt-${String(input.attempt)}`,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "document_code_generation"
      },
      timeoutMsHint: DOCUMENT_CLASSIFICATION_TIMEOUT_MS
    });
    const rawText = (response.text ?? "").trim();
    this.logger.log(
      `[document-code-gen] jobId=${request.job.id} attempt=${String(input.attempt)} provider=${providerSelection.provider} model=${providerSelection.model} rawLength=${String(rawText.length)} preview=${JSON.stringify(rawText.slice(0, 200))}`
    );
    // Strip markdown fences if the model disobeys the no-fence instruction.
    const fenceStripped = rawText
      .replace(/^```[\w]*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim();
    return fenceStripped.length > 0 ? fenceStripped : rawText;
  }

  private async executeDocumentCodeInSandbox(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    programSource: string;
    filename: string;
    jobId: string;
    sourcePlan: {
      inputPaths: string[];
      sourceMounts: Array<{ storagePath: string; mountPath: string }>;
      textSidecars: Array<{ mountPath: string; text: string }>;
      descriptors: string[];
    };
  }): Promise<
    | { ok: true; producedFile: RuntimeSandboxProducedFile }
    | { ok: false; exitCode: number | null; stderr: string | null }
  > {
    const basePolicy =
      (input.bundle.runtime.sandbox as RuntimeSandboxPolicy | null | undefined) ??
      DEFAULT_RUNTIME_SANDBOX_POLICY;
    const codePolicy: RuntimeSandboxPolicy = {
      ...basePolicy,
      enabled: true,
      maxProcessRuntimeMs: 120_000,
      maxCpuMsPerJob: 120_000,
      maxSingleFileWriteBytes: Math.max(basePolicy.maxSingleFileWriteBytes, 50 * 1024 * 1024),
      maxWorkspaceBytesPerJob: Math.max(basePolicy.maxWorkspaceBytesPerJob, 64 * 1024 * 1024)
    };
    let result: RuntimeSandboxJobResult;
    try {
      result = await this.sandboxClientService.waitForCompletion({
        assistantId: input.bundle.metadata.assistantId,
        assistantHandle: input.bundle.metadata.assistantHandle,
        siblingHandles: input.bundle.metadata.siblingAssistantHandles,
        workspaceId: input.bundle.metadata.workspaceId,
        runtimeRequestId: input.jobId,
        runtimeSessionId: null,
        toolCode: "execute_document_code",
        policy: codePolicy,
        args: {
          programSource: input.programSource,
          outputFileName: input.filename,
          sourceMounts: input.sourcePlan.sourceMounts,
          textSidecars: input.sourcePlan.textSidecars,
          inputPaths: input.sourcePlan.inputPaths
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[document-code-sandbox-error] jobId=${input.jobId} error=${message}`);
      return { ok: false, exitCode: null, stderr: message };
    }
    if (result.status !== "completed" || result.exitCode !== 0) {
      return {
        ok: false,
        exitCode: result.exitCode,
        stderr: result.stderr ?? result.violationMessage ?? result.reason ?? null
      };
    }
    const producedFile = result.files.find(
      (f) =>
        f.relativePath.toLowerCase() === input.filename.toLowerCase() ||
        f.relativePath.toLowerCase().endsWith(`/${input.filename.toLowerCase()}`)
    );
    if (producedFile === undefined) {
      return {
        ok: false,
        exitCode: 0,
        stderr: `No output file matching "${input.filename}" in sandbox result.`
      };
    }
    return { ok: true, producedFile };
  }

  private async finalizeCodeDocumentResult(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    filename: string;
    targetMime: string;
    producedFile: RuntimeSandboxProducedFile;
  }): Promise<RuntimeDocumentJobRunResult> {
    const { bundle, request, filename, targetMime, producedFile } = input;
    const jobId = request.job.id;

    const bytes = await this.mediaObjectStorage.downloadObject(producedFile.storagePath);
    if (bytes === null) {
      return this.buildCodeDocumentFailResult({
        request,
        filename,
        errorCode: "document_code_download_failed",
        message: "Failed to download the produced data document from object storage.",
        retryable: true
      });
    }

    // Validate the produced artifact (xlsx/docx → ZIP magic; pdf → %PDF validator).
    const validationFailure =
      targetMime === "application/pdf"
        ? await this.validateGeneratedPdfArtifact(bytes, { jobId, attempt: 1 })
        : this.validateGeneratedOfficeArtifact(bytes, { jobId, mimeType: targetMime });
    if (validationFailure !== null) {
      this.logger.error(
        `[document-code-validation-failed] jobId=${jobId} code=${validationFailure.code} message=${validationFailure.message}`
      );
      return this.buildCodeDocumentFailResult({
        request,
        filename,
        errorCode: validationFailure.code,
        message: validationFailure.message
      });
    }

    const artifact = await this.persistGeneratedArtifact({
      assistantId: bundle.metadata.assistantId,
      workspaceId: bundle.metadata.workspaceId,
      handle: bundle.metadata.assistantHandle,
      siblingHandles: bundle.metadata.siblingAssistantHandles,
      workspaceQuotaBytes: bundle.governance.quota?.workspaceQuotaBytes ?? null,
      sharedQuotaBytes: bundle.governance.quota?.sharedQuotaBytes ?? null,
      filename,
      requestPrompt: request.directToolExecution.request.prompt,
      requestedName: request.directToolExecution.request.requestedName ?? null,
      buffer: bytes,
      mimeType: targetMime
    });

    this.logger.log(
      `[document-code-path-done] jobId=${jobId} filename=${filename} bytes=${String(bytes.length)}`
    );
    return {
      assistantText: null,
      artifacts: [artifact],
      usage: null,
      billingFacts: artifact.billingFacts ?? null,
      toolInvocations: [{ name: "document", iteration: 1, ok: true, executionMode: "worker" }],
      rawText: null,
      renderedHtml: null,
      providerStatus: {
        provider: "sandbox",
        state: "success",
        outputFormat: request.job.outputFormat,
        requestedName: filename,
        sourcePromptHash: this.hashPrompt(request.directToolExecution.request.prompt)
      }
    };
  }

  private buildCodeDocumentFailResult(input: {
    request: RuntimeDocumentJobRunRequest;
    filename: string;
    errorCode: string;
    message: string;
    retryable?: boolean;
  }): RuntimeDocumentJobRunResult {
    return {
      assistantText: null,
      artifacts: [],
      usage: null,
      toolInvocations: [{ name: "document", iteration: 1, ok: false, executionMode: "worker" }],
      rawText: null,
      providerStatus: {
        provider: "sandbox",
        state: "failed",
        errorCode: input.errorCode,
        retryable: input.retryable === true,
        message: input.message,
        outputFormat: input.request.job.outputFormat,
        requestedName: input.filename,
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt)
      }
    };
  }
}
