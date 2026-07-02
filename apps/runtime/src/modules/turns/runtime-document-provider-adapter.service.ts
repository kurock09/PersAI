import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import type {
  RuntimeDocumentJobRunRequest,
  RuntimeDocumentJobRunResult,
  RuntimeDocumentSourceFile,
  RuntimeOutputArtifact
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { SandboxClientService } from "./sandbox-client.service";
import { writeRuntimeOutboundArtifact } from "./write-runtime-outbound-artifact";

// ADR-132 hard cutover: document worker now serves Gamma presentations only.
// Ordinary PDF/DOCX/XLSX document work stays on the live three-verb surface
// (`document.inspect`, `document.render`, `document.convert`) plus
// `files.attach` for shell-produced outputs. The Gamma path stays because
// presentation generation remains a deferred provider call with no equivalent
// synchronous render primitive.

const DEFAULT_DOCUMENT_TIMEOUT_MS = 6 * 60 * 1000;
type SupportedDocumentProvider = "gamma";
type PresentationOutputFormat = "pdf" | "pptx";

@Injectable()
export class RuntimeDocumentProviderAdapterService {
  private readonly logger = new Logger(RuntimeDocumentProviderAdapterService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly sandboxClientService: SandboxClientService
  ) {}

  async run(input: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeDocumentJobRunRequest;
  }): Promise<RuntimeDocumentJobRunResult> {
    const provider = input.request.job.provider;
    if (provider !== "gamma") {
      throw new BadRequestException(
        `Document provider "${String(provider)}" is no longer supported by the worker. ` +
          "Non-presentation document work runs through document.inspect / " +
          "document.render / document.convert, with files.attach used only " +
          "to deliver shell-produced outputs."
      );
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
    return this.runGammaPath(input, credential);
  }

  private async runGammaPath(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
    },
    credential: AssistantRuntimeBundleToolCredentialRef
  ): Promise<RuntimeDocumentJobRunResult> {
    const timeoutMs = this.resolveWorkerTimeoutMs(input.bundle);
    const presentationFormat = this.resolvePresentationFormat(input.request.job.outputFormat);
    const filename = this.resolveRequestedFilename(input.request, presentationFormat);
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
          outputFormat: presentationFormat,
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

  private resolvePresentationFormat(outputFormat: string): PresentationOutputFormat {
    return outputFormat === "pptx" ? "pptx" : "pdf";
  }

  private resolveRequestedFilename(
    request: RuntimeDocumentJobRunRequest,
    presentationFormat: PresentationOutputFormat
  ): string {
    const requested = request.directToolExecution.request.requestedName?.trim() ?? "";
    const base =
      requested.length > 0 ? requested.replace(/[\\/:*?"<>|]+/g, " ").trim() : "presentation";
    const normalizedBase = this.stripMatchingExtensionSuffix(base, presentationFormat);
    return `${normalizedBase.length > 0 ? normalizedBase : "presentation"}.${presentationFormat}`;
  }

  private stripMatchingExtensionSuffix(value: string, extension: PresentationOutputFormat): string {
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

  private buildGammaPresentationOptions(request: RuntimeDocumentJobRunRequest): {
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
    const targetSlideCount = this.readTargetSlideCount(
      request.directToolExecution.request.targetSlideCount
    );
    if (targetSlideCount !== null) {
      return targetSlideCount;
    }
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
    if (this.extensionForPresentationMimeType(input.mimeType) === null) {
      throw new Error(
        `Document provider returned unsupported MIME type "${input.mimeType}" for a presentation job.`
      );
    }
    if (input.buffer.length === 0) {
      throw new Error("Document provider returned an empty presentation payload.");
    }
    const slugSourceText =
      input.requestedName?.trim() || input.requestPrompt.trim() || input.filename || "presentation";
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

  private extensionForPresentationMimeType(mimeType: string): PresentationOutputFormat | null {
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

  private hashPrompt(prompt: string): string {
    let hash = 0;
    for (let index = 0; index < prompt.length; index += 1) {
      hash = (hash * 31 + prompt.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
  }
}
