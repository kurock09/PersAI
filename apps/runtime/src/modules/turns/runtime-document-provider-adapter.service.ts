import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import type {
  PersaiRuntimeModelRole,
  ProviderGatewayTextGenerateRequest,
  RuntimeDocumentGammaCompanionOriginal,
  RuntimeDocumentJobRunRequest,
  RuntimeDocumentJobRunResult,
  RuntimeDocumentSourceFile,
  RuntimeOutputArtifact
} from "@persai/runtime-contract";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";

type SupportedDocumentProvider = "pdfmonkey" | "gamma";
type NativeManagedProvider = "openai" | "anthropic";
type ProviderSelection = { provider: NativeManagedProvider; model: string };

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
const DEFAULT_DOCUMENT_TIMEOUT_MS = 6 * 60 * 1000;
const PDFMONKEY_TEMPLATE_MISSING_CODE = "document_template_not_configured";
const DOCUMENT_HTML_MAX_OUTPUT_TOKENS = 16_000;
const DOCUMENT_PDF_MAX_RENDER_ATTEMPTS = 3;
const PDF_VALIDATION_MIN_BYTES = 1_024;
const PDF_VALIDATION_MIN_TEXT_LENGTH = 80;
const PDF_VALIDATION_MIN_ALNUM_COUNT = 24;
const DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH = 120;
const PDF_VALIDATION_TAIL_INSPECTION_BYTES = 2_048;
// Legacy baseline used as the kill-switch fallback when enhanced pagination is
// explicitly disabled via RUNTIME_DOCUMENT_ENHANCED_PAGINATION=off. Keep this
// in sync with the pre-pagination baseline behavior so an off-switch reverts to
// the exact previous render.
const DOCUMENT_HTML_EDITORIAL_STYLE_CSS = [
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
  "dd{margin:2pt 0 8pt 16pt;}"
].join("");

const DOCUMENT_HTML_BASELINE_PRINT_CSS = `${DOCUMENT_HTML_EDITORIAL_STYLE_CSS}body{padding:32px 48px;}`;

// Enhanced print CSS: restrained editorial typography + Chromium pagination rules.
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
  DOCUMENT_HTML_EDITORIAL_STYLE_CSS,
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
const DOCUMENT_HTML_ENHANCED_PAGINATION_ENV_KEY = "RUNTIME_DOCUMENT_ENHANCED_PAGINATION";

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
    private readonly runtimeAssistantFileRegistryService: RuntimeAssistantFileRegistryService
  ) {}

  async run(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
  }): Promise<RuntimeDocumentJobRunResult> {
    const provider = input.request.job.provider;
    if (provider !== "pdfmonkey" && provider !== "gamma") {
      throw new BadRequestException(`Unsupported document provider "${String(provider)}".`);
    }

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

    if (provider === "gamma") {
      return this.runGammaPath(input, credential);
    }

    const templateId = this.readPdfMonkeyTemplateId(input.bundle);
    if (templateId === null) {
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
          state: "template_not_configured",
          errorCode: PDFMONKEY_TEMPLATE_MISSING_CODE,
          retryable: false,
          outputFormat: input.request.job.outputFormat,
          requestedName: input.request.directToolExecution.request.requestedName ?? null,
          sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
          assistantFileRegistryAvailable:
            typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function"
        }
      };
    }
    const filename = this.resolveRequestedFilename(input.request, input.request.job.outputFormat);
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
      providerStatus: Record<string, unknown>;
    } | null = null;

    this.logger.log(
      `[document-pdf-start] jobId=${input.request.job.id} filename=${filename} templateId=${templateId} timeoutMs=${String(timeoutMs)} maxAttempts=${String(DOCUMENT_PDF_MAX_RENDER_ATTEMPTS)}`
    );
    for (let attempt = 1; attempt <= DOCUMENT_PDF_MAX_RENDER_ATTEMPTS; attempt += 1) {
      let htmlContent: string;
      try {
        const generation = await this.generatePdfHtmlContent({
          bundle: input.bundle,
          request: input.request,
          filename,
          attempt
        });
        htmlContent = generation.htmlContent;
        this.logger.log(
          `[document-pdf-html-ready] jobId=${input.request.job.id} attempt=${String(attempt)} htmlBytes=${String(htmlContent.length)} bodyTextLength=${String(generation.bodyTextLength)}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
      const providerOutcome = await this.providerGatewayClientService.generateDocumentOutcome(
        {
          htmlContent,
          filename,
          credential: {
            toolCode: "document",
            secretId: credential.secretRef.id,
            providerId: "pdfmonkey"
          },
          providerOptions: {
            pdfmonkeyTemplateId: templateId,
            outputFormat: "pdf"
          }
        },
        { timeoutMs }
      );
      if (!providerOutcome.ok) {
        this.logger.warn(
          `[document-pdf-provider-failed] jobId=${input.request.job.id} attempt=${String(attempt)} status=${String(providerOutcome.status)} code=${String(providerOutcome.code)} retryable=${String(providerOutcome.retryable)} message=${providerOutcome.message}`
        );
        lastProviderFailure = {
          code: providerOutcome.code ?? "provider_document_generation_failed",
          status: providerOutcome.status,
          message: providerOutcome.message,
          retryable: providerOutcome.retryable,
          providerStatus: providerOutcome.providerStatus
        };
        break;
      }
      const providerResult = providerOutcome.result;
      const pdfBuffer = Buffer.from(providerResult.bytesBase64, "base64");
      this.logger.log(
        `[document-pdf-provider-ok] jobId=${input.request.job.id} attempt=${String(attempt)} pdfBytes=${String(pdfBuffer.length)} providerDocumentId=${providerResult.documentId}`
      );
      const validationFailure = await this.validateGeneratedPdfArtifact(pdfBuffer, {
        jobId: input.request.job.id,
        attempt
      });
      if (validationFailure === null) {
        lastValidationFailure = null;
        successfulProviderResult = providerResult;
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
          assistantFileRegistryAvailable:
            typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function",
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
          assistantFileRegistryAvailable:
            typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function",
          validation: lastValidationFailure?.metadata ?? {},
          providerFailure: successfulProviderResult?.providerStatus ?? null
        }
      };
    }
    const artifact = await this.persistGeneratedArtifact({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      sessionId: input.request.job.chatId,
      requestId: input.request.job.id,
      filename,
      buffer: Buffer.from(successfulProviderResult.bytesBase64, "base64"),
      mimeType: successfulProviderResult.mimeType
    });

    // Worker intentionally returns assistantText: null. The user-facing
    // completion message is generated exactly once in the API layer by
    // AssistantDocumentJobDeliveryService.resolveCompletionAssistantText
    // after the document is delivered to the chat, using full chat history
    // as context. Generating it here as well would (a) produce a duplicate
    // LLM call for every document job (visible in provider logs as two
    // independent framing requests with different outputs for the same
    // job) and (b) misuse `bundle.promptConstructor.ordinary.sections.heartbeat`,
    // which ADR-077 explicitly reserves for Background Task Evaluation
    // and must never be appended to a normal user-visible chat turn.
    return {
      assistantText: null,
      artifacts: [artifact],
      usage: null,
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
        ...successfulProviderResult.providerStatus,
        outputFormat: input.request.job.outputFormat,
        requestedName: filename,
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
        assistantFileRegistryAvailable:
          typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function"
      }
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
          outputFormat: input.request.job.outputFormat,
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
          assistantFileRegistryAvailable:
            typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function",
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
      sessionId: input.request.job.chatId,
      requestId: input.request.job.id,
      filename,
      buffer: Buffer.from(providerResult.bytesBase64, "base64"),
      mimeType: providerResult.mimeType
    });
    const companionOriginal =
      input.request.job.outputFormat === "pdf"
        ? await this.tryBuildGammaCompanionOriginal({
            request: input.request,
            credential,
            timeoutMs,
            htmlContent: gammaInput
          })
        : null;
    // Same rationale as the PDF path: worker returns assistantText: null
    // and the user-facing completion text is generated exactly once in
    // AssistantDocumentJobDeliveryService after delivery, with full chat
    // history as context. See the PDF return statement for the full note.
    return {
      assistantText: null,
      artifacts: [artifact],
      usage: null,
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
        sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
        assistantFileRegistryAvailable:
          typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function",
        ...(companionOriginal === null ? {} : { companionOriginal })
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

  private readPdfMonkeyTemplateId(bundle: AssistantRuntimeBundle): string | null {
    const templateId = bundle.governance.documentProviderConfig?.pdfmonkeyTemplateId;
    return typeof templateId === "string" && templateId.trim().length > 0
      ? templateId.trim()
      : null;
  }

  private async tryBuildGammaCompanionOriginal(input: {
    request: RuntimeDocumentJobRunRequest;
    credential: AssistantRuntimeBundleToolCredentialRef;
    timeoutMs: number;
    htmlContent: string;
  }): Promise<RuntimeDocumentGammaCompanionOriginal> {
    const filename = this.resolveRequestedFilename(input.request, "pptx");
    try {
      const outcome = await this.providerGatewayClientService.generateDocumentOutcome(
        {
          htmlContent: input.htmlContent,
          filename,
          credential: {
            toolCode: "document",
            secretId: input.credential.secretRef.id,
            providerId: "gamma"
          },
          providerOptions: {
            outputFormat: "pptx",
            presentationOptions: this.buildGammaPresentationOptions(input.request)
          }
        },
        { timeoutMs: input.timeoutMs }
      );
      if (!outcome.ok) {
        return {
          format: "pptx",
          status: "unavailable",
          filename,
          errorCode: outcome.code ?? "provider_document_generation_failed",
          message: outcome.message,
          retryable: outcome.retryable,
          ...(outcome.providerStatus === null ? {} : { providerFailure: outcome.providerStatus })
        };
      }
      if (outcome.result.provider !== "gamma") {
        return {
          format: "pptx",
          status: "unavailable",
          filename,
          errorCode: "provider_document_generation_failed",
          message: "Gamma companion original returned an unexpected provider result."
        };
      }
      return {
        format: "pptx",
        status: "ready",
        generationId: outcome.result.providerStatus.generationId,
        gammaId: outcome.result.providerStatus.gammaId,
        gammaUrl: outcome.result.providerStatus.gammaUrl,
        exportUrl: outcome.result.providerStatus.exportUrl,
        filename,
        outputType: "pptx",
        updatedAt: outcome.result.providerStatus.updatedAt
      };
    } catch (error) {
      return {
        format: "pptx",
        status: "unavailable",
        filename,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private resolveRequestedFilename(
    request: RuntimeDocumentJobRunRequest,
    outputFormat: "pdf" | "pptx"
  ): string {
    const requested = request.directToolExecution.request.requestedName?.trim() ?? "";
    const base =
      requested.length > 0 ? requested.replace(/[\\/:*?"<>|]+/g, " ").trim() : "document";
    const extension = outputFormat === "pptx" ? "pptx" : "pdf";
    const normalizedBase = this.stripMatchingExtensionSuffix(base, extension);
    return `${normalizedBase.length > 0 ? normalizedBase : "document"}.${extension}`;
  }

  private stripMatchingExtensionSuffix(value: string, extension: "pdf" | "pptx"): string {
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
      )} visualDensity=${visualDensity} themeId=${gammaThemeId ?? "auto"}`
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
    prefersCompactDeck: boolean;
  } {
    const normalized = this.collectGammaTopicText(request);
    const compactTopic =
      normalized.includes("school") ||
      normalized.includes("student") ||
      normalized.includes("lesson") ||
      normalized.includes("biology") ||
      normalized.includes("overview") ||
      normalized.includes("intro") ||
      normalized.includes("basics") ||
      normalized.includes("кратк") ||
      normalized.includes("обзор") ||
      normalized.includes("школ") ||
      normalized.includes("учеб");
    const longFormTopic =
      normalized.includes("report") ||
      normalized.includes("thesis") ||
      normalized.includes("roadmap") ||
      normalized.includes("quarter") ||
      normalized.includes("annual") ||
      normalized.includes("отчет") ||
      normalized.includes("доклад");
    return { prefersCompactDeck: compactTopic && !longFormTopic };
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
    const topicProfile = this.inferGammaTopicProfile(request);
    const minCards = topicProfile.prefersCompactDeck ? 3 : 4;
    const maxCards = topicProfile.prefersCompactDeck ? 5 : 12;
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
    const approx =
      visualDensity === "visual_heavy"
        ? Math.ceil(baseText.length / 950)
        : visualDensity === "text_heavy"
          ? Math.ceil(baseText.length / 1100)
          : Math.ceil(baseText.length / 750);
    return Math.max(minCards, Math.min(maxCards, approx));
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
    attempt: number;
  }): Promise<{ htmlContent: string; bodyTextLength: number }> {
    const providerSelection = this.resolveProviderSelection(input.bundle, "premium_reply");
    const sourceFiles = input.request.sourceFiles ?? [];
    if (sourceFiles.length > 0) {
      const inlinedCount = sourceFiles.filter((entry) => entry.text !== null).length;
      const totalBytes = sourceFiles.reduce(
        (sum, entry) => sum + (entry.text === null ? 0 : Buffer.byteLength(entry.text, "utf8")),
        0
      );
      this.logger.log(
        `[document-pdf-source-attachments] jobId=${input.request.job.id} attempt=${String(
          input.attempt
        )} attachments=${String(sourceFiles.length)} inlinedTextFiles=${String(
          inlinedCount
        )} inlinedBytes=${String(totalBytes)}`
      );
    }
    const response = await this.providerGatewayClientService.generateText(
      this.buildPdfContentRequest({ ...input, sourceFiles }, providerSelection)
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
    const repaired = this.repairHtmlDocument(extracted);
    if (repaired.bodyTextLength < DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH) {
      throw new Error(
        `Document HTML generation produced too little body text (length=${String(
          repaired.bodyTextLength
        )}, minimum=${String(DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH)}).`
      );
    }
    this.logger.log(
      `[document-pdf-html-pagination] jobId=${input.request.job.id} attempt=${String(input.attempt)} paginationEnhanced=${String(repaired.paginationEnhanced)} theadPromoted=${String(repaired.theadPromoted)}`
    );
    return { htmlContent: repaired.html, bodyTextLength: repaired.bodyTextLength };
  }

  private buildPdfContentRequest(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
      filename: string;
      attempt: number;
      sourceFiles: DocumentSourceFilePayload[];
    },
    providerSelection: ProviderSelection
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
      "Do not mention templates, PDFMonkey, providers, job ids, system prompts, or internal architecture.",
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
    const developerInstructions = [
      this.normalizeOptionalText(bundle.promptConstructor.ordinary.sections.heartbeat),
      [...baseInstructions, ...retryInstructions].join("\n")
    ]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n");

    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.normalizeOptionalText(bundle.promptConstructor.ordinary.systemPrompt),
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
      maxOutputTokens: DOCUMENT_HTML_MAX_OUTPUT_TOKENS,
      requestMetadata: {
        runtimeSessionId: `document-job:${request.job.id}`,
        runtimeRequestId: `document-html:${request.job.id}:attempt-${String(input.attempt)}`,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "document_html_generation"
      }
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
    sessionId: string;
    requestId: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<RuntimeOutputArtifact> {
    const extension = this.extensionForMimeType(input.mimeType);
    if (extension === null) {
      throw new Error(`Document provider returned unsupported MIME type "${input.mimeType}".`);
    }
    if (input.buffer.length === 0) {
      throw new Error("Document provider returned an empty document payload.");
    }
    const artifactId = randomUUID();
    const objectKey = this.mediaObjectStorage.buildRuntimeOutputObjectKey({
      assistantId: input.assistantId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      artifactId,
      extension
    });
    const stored = await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer: input.buffer,
      mimeType: input.mimeType
    });
    const file = await this.runtimeAssistantFileRegistryService.ensureAttachmentBackedFile({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      origin: "runtime_output",
      referenceId: artifactId,
      objectKey: stored.objectKey,
      filename: input.filename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes
    });
    const runtimeFileRef = this.runtimeAssistantFileRegistryService.toRuntimeFileRef(file);
    return {
      artifactId,
      fileRef: runtimeFileRef.fileRef,
      file: runtimeFileRef,
      kind: "file",
      sourceToolCode: "document",
      objectKey: stored.objectKey,
      mimeType: stored.mimeType,
      filename: input.filename,
      sizeBytes: stored.sizeBytes,
      voiceNote: false
    };
  }

  private extensionForMimeType(mimeType: string): "pdf" | "pptx" | null {
    if (mimeType === "application/pdf") {
      return "pdf";
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      return "pptx";
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
   * - re-serialize back into clean, well-formed HTML PDFMonkey can render.
   *
   * Also injects a baseline print CSS so any HTML the model gives us renders as
   * a real document (typography, headings, lists, tables) instead of an
   * unstyled wall of text. Returns the visible body text length so callers can
   * reject obviously empty documents before sending them to PDFMonkey.
   */
  private repairHtmlDocument(htmlInput: string): {
    html: string;
    bodyTextLength: number;
    paginationEnhanced: boolean;
    theadPromoted: number;
  } {
    const activeCss = this.resolveActivePrintCss();
    const paginationEnhanced = activeCss === DOCUMENT_HTML_ENHANCED_PRINT_CSS;
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

  private resolveActivePrintCss(): string {
    const flag = process.env[DOCUMENT_HTML_ENHANCED_PAGINATION_ENV_KEY];
    return flag === "off" || flag === "false" || flag === "0"
      ? DOCUMENT_HTML_BASELINE_PRINT_CSS
      : DOCUMENT_HTML_ENHANCED_PRINT_CSS;
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
   * Why: PDFMonkey / Chromium only repeats the table header on every printed
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
}
