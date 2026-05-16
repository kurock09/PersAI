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
const DOCUMENT_COMPLETION_MAX_OUTPUT_TOKENS = 220;
const DOCUMENT_PDF_MAX_RENDER_ATTEMPTS = 3;
const PDF_VALIDATION_MIN_BYTES = 1_024;
const PDF_VALIDATION_MIN_TEXT_LENGTH = 80;
const PDF_VALIDATION_MIN_ALNUM_COUNT = 24;
const DOCUMENT_HTML_MIN_BODY_TEXT_LENGTH = 120;
const PDF_VALIDATION_TAIL_INSPECTION_BYTES = 2_048;
const DOCUMENT_HTML_DEFAULT_PRINT_CSS =
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.5;padding:32px 48px;}h1{font-size:24pt;margin:0 0 16pt;}h2{font-size:16pt;margin:24pt 0 8pt;}h3{font-size:13pt;margin:18pt 0 6pt;}p,li{font-size:11pt;margin:6pt 0;}ul,ol{padding-left:20pt;}table{border-collapse:collapse;width:100%;margin:12pt 0;}th,td{border:1px solid #d0d0d0;padding:6pt 10pt;text-align:left;font-size:10pt;vertical-align:top;}th{background:#f4f4f4;}';

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
    const filename = this.resolveRequestedFilename(input.request);
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

    return {
      assistantText: await this.generateDocumentCompletionText({
        bundle: input.bundle,
        request: input.request,
        provider: "pdfmonkey",
        outputFormat: "pdf",
        filename
      }),
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
    const filename = this.resolveRequestedFilename(input.request);
    const providerOutcome = await this.providerGatewayClientService.generateDocumentOutcome(
      {
        htmlContent: this.renderGammaInput(input.request),
        filename,
        credential: {
          toolCode: "document",
          secretId: credential.secretRef.id,
          providerId: "gamma"
        },
        providerOptions: {
          outputFormat: "pptx",
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
    return {
      assistantText: await this.generateDocumentCompletionText({
        bundle: input.bundle,
        request: input.request,
        provider: "gamma",
        outputFormat: "pptx",
        filename
      }),
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
          typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function"
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

  private resolveRequestedFilename(request: RuntimeDocumentJobRunRequest): string {
    const requested = request.directToolExecution.request.requestedName?.trim() ?? "";
    const base =
      requested.length > 0 ? requested.replace(/[\\/:*?"<>|]+/g, " ").trim() : "document";
    const extension = request.job.outputFormat === "pptx" ? "pptx" : "pdf";
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
      } {
    const docRequest = request.directToolExecution.request;
    const language = this.resolveGammaLanguageCode(request);
    const visualDensity = docRequest.visualDensity ?? "visual_heavy";
    const visualStyle = docRequest.visualStyle ?? "professional_modern";
    const imagePolicy = docRequest.imagePolicy ?? "ai_generated";
    const additionalInstructions = this.buildGammaAdditionalInstructions(request, {
      visualStyle,
      imagePolicy,
      visualDensity
    });

    return {
      textMode: "generate",
      numCards: this.estimateGammaCardCount(request, visualDensity),
      cardSplit: this.resolveGammaCardSplit(docRequest.outline),
      additionalInstructions,
      textOptions: {
        amount:
          visualDensity === "visual_heavy"
            ? "brief"
            : visualDensity === "text_heavy"
              ? "detailed"
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
        ? "Prefer image-led cards, short copy blocks, clear hierarchy, and strong visual contrast."
        : input.visualDensity === "text_heavy"
          ? "Keep the deck readable and content-rich, but still avoid text walls and preserve visual hierarchy."
          : "Balance concise text with clear visuals, varied layouts, and strong slide-to-slide rhythm."
    );
    instructions.push(this.describeGammaVisualStyle(input.visualStyle));
    instructions.push(
      input.imagePolicy === "text_only"
        ? "Do not add extra images unless they are already explicitly provided in the source content."
        : "Use visuals deliberately so the deck feels image-rich and presentation-native rather than document-like."
    );
    instructions.push(
      "Favor punchy slide titles, comparisons, timelines, grids, callouts, and section-divider cards when helpful."
    );
    if (typeof request.directToolExecution.request.instructions === "string") {
      const trimmed = request.directToolExecution.request.instructions.trim();
      if (trimmed.length > 0) {
        instructions.push(`User guidance: ${trimmed}`);
      }
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
    const normalized = [
      request.directToolExecution.request.prompt,
      request.directToolExecution.request.instructions ?? "",
      request.job.sourceUserMessageText
    ]
      .join(" ")
      .toLowerCase();
    if (normalized.includes("investor")) return "investors";
    if (normalized.includes("board")) return "board members and executives";
    if (normalized.includes("sales")) return "customers and prospects";
    if (normalized.includes("training")) return "learners and team members";
    return null;
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
    const outline = request.directToolExecution.request.outline;
    if (Array.isArray(outline)) {
      const count = outline.filter((entry) => entry !== null).length;
      if (count > 0) {
        return Math.max(6, Math.min(14, count));
      }
    }
    if (typeof outline === "string") {
      const splitCount = outline.split(/\n---\n/g).filter((part) => part.trim().length > 0).length;
      if (splitCount > 1) {
        return Math.max(6, Math.min(14, splitCount));
      }
    }
    const baseText = this.renderGammaInput(request);
    const approx =
      visualDensity === "visual_heavy"
        ? Math.ceil(baseText.length / 450)
        : visualDensity === "text_heavy"
          ? Math.ceil(baseText.length / 850)
          : Math.ceil(baseText.length / 650);
    return Math.max(6, Math.min(14, approx));
  }

  private resolveGammaCardSplit(outline: unknown): "auto" | "inputTextBreaks" {
    if (typeof outline === "string" && outline.includes("\n---\n")) {
      return "inputTextBreaks";
    }
    return "auto";
  }

  private renderOutline(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return `<pre>${this.escapeHtml(value)}</pre>`;
    }
    if (Array.isArray(value)) {
      const items = value
        .map((entry) =>
          typeof entry === "string"
            ? this.escapeHtml(entry)
            : this.escapeHtml(JSON.stringify(entry))
        )
        .filter((entry) => entry.length > 0);
      if (items.length === 0) {
        return "";
      }
      return `<ul>${items.map((entry) => `<li>${entry}</li>`).join("")}</ul>`;
    }
    if (typeof value === "object") {
      return `<pre>${this.escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
    }
    return "";
  }

  private async generatePdfHtmlContent(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    filename: string;
    attempt: number;
  }): Promise<{ htmlContent: string; bodyTextLength: number }> {
    const providerSelection = this.resolveProviderSelection(input.bundle, "premium_reply");
    const response = await this.providerGatewayClientService.generateText(
      this.buildPdfContentRequest(input, providerSelection)
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
    return { htmlContent: repaired.html, bodyTextLength: repaired.bodyTextLength };
  }

  private buildPdfContentRequest(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
      filename: string;
      attempt: number;
    },
    providerSelection: ProviderSelection
  ): ProviderGatewayTextGenerateRequest {
    const bundle = input.bundle;
    const request = input.request;
    const isSimplifiedRetry = input.attempt >= 2;
    const baseInstructions = [
      "You are generating the real user-facing content for a PersAI PDF document job.",
      "Return ONLY the HTML document. Do not add any preamble, JSON envelope, markdown code fences, or commentary.",
      "Begin your response with <!DOCTYPE html> and end it with </html>.",
      "The HTML body must contain the actual document content, not meta commentary about the request.",
      "Do not include sections titled Prompt, Instructions, Source User Message, Outline, PersAI Document Draft, or any internal/debug labels.",
      "Do not mention templates, PDFMonkey, providers, job ids, system prompts, or internal architecture.",
      "Write the document in the user's apparent language unless the request clearly asks for another language.",
      "Use coherent headings (<h1>/<h2>/<h3>), paragraphs, lists, and simple tables when helpful.",
      "Close every tag you open. Never leave dangling <td>, <tr>, <ul>, <p>, or other elements unclosed.",
      "Do not embed external scripts, iframes, remote stylesheets, or remote images."
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

  private async generateDocumentCompletionText(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
    provider: SupportedDocumentProvider;
    outputFormat: "pdf" | "pptx";
    filename: string;
  }): Promise<string | null> {
    try {
      const providerSelection = this.resolveProviderSelection(input.bundle, "premium_reply");
      const response = await this.providerGatewayClientService.generateText(
        this.buildDocumentCompletionRequest(input, providerSelection)
      );
      const parsed = this.parseJsonObject(response.text, "document_completion_framing");
      if (parsed.assistantText === null) {
        return null;
      }
      const assistantText =
        typeof parsed.assistantText === "string" ? parsed.assistantText.trim() : "";
      return assistantText.length > 0 ? assistantText : null;
    } catch {
      return null;
    }
  }

  private buildDocumentCompletionRequest(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
      provider: SupportedDocumentProvider;
      outputFormat: "pdf" | "pptx";
      filename: string;
    },
    providerSelection: ProviderSelection
  ): ProviderGatewayTextGenerateRequest {
    const bundle = input.bundle;
    const request = input.request;
    const developerInstructions = [
      this.normalizeOptionalText(bundle.promptConstructor.ordinary.sections.heartbeat),
      [
        "You are framing the successful completion of a finished PersAI async document job.",
        "Backend state already owns the job, rendered file, delivery idempotency, and quota truth.",
        "Write only optional user-facing completion text.",
        "Do not claim the document was already sent, attached, uploaded, or delivered.",
        "Do not mention internal tools, templates, providers, or job ids.",
        "Keep the message short, calm, and in the user's language.",
        "If no extra text is needed, you may return assistantText as null."
      ].join("\n")
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
                  mode: "document_completion_framing",
                  currentTimeIso: new Date().toISOString(),
                  job: {
                    id: request.job.id,
                    descriptorMode: request.directToolExecution.descriptorMode,
                    outputFormat: input.outputFormat,
                    provider: input.provider,
                    filename: input.filename
                  },
                  documentRequest: {
                    prompt: request.directToolExecution.request.prompt,
                    instructions: request.directToolExecution.request.instructions ?? null,
                    requestedName: request.directToolExecution.request.requestedName ?? null
                  },
                  sourceUserMessage: {
                    text: request.job.sourceUserMessageText,
                    createdAt: request.job.sourceUserMessageCreatedAt
                  },
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
      maxOutputTokens: DOCUMENT_COMPLETION_MAX_OUTPUT_TOKENS,
      outputSchema: {
        name: "document_job_completion",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["assistantText"],
          properties: {
            assistantText: {
              type: ["string", "null"]
            }
          }
        }
      },
      requestMetadata: {
        runtimeSessionId: `document-job:${request.job.id}`,
        runtimeRequestId: `document-completion:${request.job.id}`,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "document_job_completion"
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse") as (
        buf: Buffer,
        opts?: { max?: number }
      ) => Promise<{ text?: string }>;
      const result = await pdfParse(buffer, { max: 100 });
      return {
        text: this.normalizeExtractedPdfText(result.text ?? ""),
        error: null
      };
    } catch (error) {
      return {
        text: null,
        error: error instanceof Error ? error.message : String(error)
      };
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

  private parseJsonObject(
    text: string | null,
    operation: "document_completion_framing"
  ): Record<string, unknown> {
    if (text === null || text.trim().length === 0) {
      throw new Error(`${operation} returned empty output.`);
    }
    const normalized = this.unwrapJsonCodeFence(text.trim());
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      const extractedObject = this.extractJsonObjectCandidate(normalized);
      if (extractedObject !== null) {
        try {
          parsed = JSON.parse(extractedObject);
        } catch {
          throw new Error(`${operation} returned an invalid JSON object.`);
        }
      } else {
        throw new Error(`${operation} returned an invalid JSON object.`);
      }
    }
    const row = this.asObject(parsed);
    if (row === null) {
      throw new Error(`${operation} returned an invalid JSON object.`);
    }
    return row;
  }

  private extractJsonObjectCandidate(value: string): string | null {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    return value.slice(start, end + 1);
  }

  private unwrapJsonCodeFence(value: string): string {
    const fenceMatch = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch?.[1]?.trim() ?? value;
  }

  /**
   * Pulls the HTML document out of whatever the model returned.
   *
   * Accepts:
   * - raw HTML starting with <!DOCTYPE html>, <html>, <body>, <section>, <article>, <main>, <div>, <table>, <h1>, <h2>
   * - HTML wrapped in ```html``` or ``` ``` markdown fences
   * - JSON envelopes like {"htmlContent": "..."} (legacy fallback for older prompts)
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
  private repairHtmlDocument(htmlInput: string): { html: string; bodyTextLength: number } {
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
      const fallback = this.wrapHtmlInBoilerplate(htmlInput);
      const fallbackText = this.extractPlainTextFromHtmlPassthrough(htmlInput);
      return { html: fallback, bodyTextLength: fallbackText.length };
    }
    const document = parse5.parse(htmlInput);
    const body = this.findFirstNodeByTagName(document, "body");
    const head = this.findFirstNodeByTagName(document, "head");
    if (head !== null && !this.hasStyleChild(head)) {
      this.appendStyleNodeToHead(head);
    }
    const bodyText = body === null ? "" : this.collectVisibleTextFromNode(body);
    const bodyTextLength = bodyText.replace(/\s+/g, " ").trim().length;
    let serialized = parse5.serialize(document).trim();
    if (!/^<!doctype/i.test(serialized)) {
      serialized = `<!DOCTYPE html>\n${serialized}`;
    }
    if (!/<style/i.test(serialized)) {
      serialized = serialized.replace(
        /<\/head>/i,
        `<style>${DOCUMENT_HTML_DEFAULT_PRINT_CSS}</style></head>`
      );
    }
    return { html: serialized, bodyTextLength };
  }

  private wrapHtmlInBoilerplate(value: string): string {
    const normalized = value.trim();
    const lower = normalized.toLowerCase();
    if (lower.startsWith("<!doctype")) {
      return normalized;
    }
    if (lower.startsWith("<html")) {
      return `<!DOCTYPE html>\n${normalized}`;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOCUMENT_HTML_DEFAULT_PRINT_CSS}</style></head><body>${normalized}</body></html>`;
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

  private appendStyleNodeToHead(head: Parse5Node): void {
    const styleNode: Parse5Node = {
      nodeName: "style",
      tagName: "style",
      attrs: [],
      namespaceURI: "http://www.w3.org/1999/xhtml",
      childNodes: [
        {
          nodeName: "#text",
          value: DOCUMENT_HTML_DEFAULT_PRINT_CSS,
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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private hashPrompt(prompt: string): string {
    let hash = 0;
    for (let index = 0; index < prompt.length; index += 1) {
      hash = (hash * 31 + prompt.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
  }
}
