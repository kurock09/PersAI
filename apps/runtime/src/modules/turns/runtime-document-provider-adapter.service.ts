import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
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
const DEFAULT_DOCUMENT_TIMEOUT_MS = 6 * 60 * 1000;
const PDFMONKEY_TEMPLATE_MISSING_CODE = "document_template_not_configured";
const DOCUMENT_HTML_MAX_OUTPUT_TOKENS = 4_500;
const DOCUMENT_COMPLETION_MAX_OUTPUT_TOKENS = 220;
const PDF_VALIDATION_MIN_TEXT_LENGTH = 80;
const PDF_VALIDATION_MIN_ALNUM_COUNT = 24;

@Injectable()
export class RuntimeDocumentProviderAdapterService {
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
    const htmlContent = await this.generatePdfHtmlContent({
      bundle: input.bundle,
      request: input.request,
      filename
    });
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
    const validationFailure = await this.validateGeneratedPdfArtifact(
      Buffer.from(providerResult.bytesBase64, "base64")
    );
    if (validationFailure !== null) {
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
          errorCode: validationFailure.code,
          retryable: false,
          message: validationFailure.message,
          outputFormat: input.request.job.outputFormat,
          requestedName: filename,
          sourcePromptHash: this.hashPrompt(input.request.directToolExecution.request.prompt),
          assistantFileRegistryAvailable:
            typeof this.runtimeAssistantFileRegistryService.toRuntimeFileRef === "function",
          validation: validationFailure.metadata,
          providerFailure: providerResult.providerStatus
        }
      };
    }
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
        ...providerResult.providerStatus,
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
          outputFormat: "pptx"
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
    return `${base.length > 0 ? base : "document"}.${extension}`;
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
  }): Promise<string> {
    const providerSelection = this.resolveProviderSelection(input.bundle, "premium_reply");
    const response = await this.providerGatewayClientService.generateText(
      this.buildPdfContentRequest(input, providerSelection)
    );
    const parsed = this.parseJsonObject(response.text, "document_html_generation");
    const htmlContent = typeof parsed.htmlContent === "string" ? parsed.htmlContent.trim() : "";
    if (htmlContent.length === 0) {
      throw new Error("Document HTML generation returned empty htmlContent.");
    }
    return htmlContent;
  }

  private buildPdfContentRequest(
    input: {
      bundle: AssistantRuntimeBundle;
      request: RuntimeDocumentJobRunRequest;
      filename: string;
    },
    providerSelection: ProviderSelection
  ): ProviderGatewayTextGenerateRequest {
    const bundle = input.bundle;
    const request = input.request;
    const developerInstructions = [
      this.normalizeOptionalText(bundle.promptConstructor.ordinary.sections.heartbeat),
      [
        "You are generating the real user-facing content for a PersAI PDF document job.",
        "Return only valid JSON that matches the output schema.",
        "htmlContent must contain the actual document body content, not meta commentary about the request.",
        "Do not include sections titled Prompt, Instructions, Source User Message, Outline, PersAI Document Draft, or any internal/debug labels.",
        "Do not mention templates, PDFMonkey, providers, job ids, system prompts, or internal architecture.",
        "Write the document in the user's apparent language unless the request clearly asks for another language.",
        "Use coherent headings, paragraphs, and lists/tables when helpful.",
        "htmlContent should be ready to render as the final document content and must not include markdown fences."
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
                  mode: "document_pdf_html_generation",
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
      outputSchema: {
        name: "document_pdf_html_generation",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["htmlContent"],
          properties: {
            htmlContent: {
              type: "string"
            }
          }
        }
      },
      requestMetadata: {
        runtimeSessionId: `document-job:${request.job.id}`,
        runtimeRequestId: `document-html:${request.job.id}`,
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

  private async validateGeneratedPdfArtifact(buffer: Buffer): Promise<{
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
    const rawText = this.normalizeExtractedPdfText(buffer.toString("utf8"));
    const extractedText = await this.extractPdfText(buffer);
    const candidateText = extractedText ?? rawText;
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
    if (extractedText !== null) {
      const alnumCount = extractedText.match(/[0-9A-Za-z\u0400-\u04FF]/g)?.length ?? 0;
      if (
        extractedText.length < PDF_VALIDATION_MIN_TEXT_LENGTH ||
        alnumCount < PDF_VALIDATION_MIN_ALNUM_COUNT
      ) {
        return {
          code: "document_pdf_emptyish_output",
          message:
            "Rendered PDF does not contain enough real document text to be delivered honestly.",
          metadata: {
            extractedLength: extractedText.length,
            alnumCount,
            extractedPreview: extractedText.slice(0, 240)
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

  private async extractPdfText(buffer: Buffer): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse") as (
        buf: Buffer,
        opts?: { max?: number }
      ) => Promise<{ text?: string }>;
      const result = await pdfParse(buffer, { max: 100 });
      return this.normalizeExtractedPdfText(result.text ?? "");
    } catch {
      return null;
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
    operation: "document_html_generation" | "document_completion_framing"
  ): Record<string, unknown> {
    if (text === null || text.trim().length === 0) {
      throw new Error(`${operation} returned empty output.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error(`${operation} returned non-JSON output.`);
      }
      parsed = JSON.parse(match[0]);
    }
    const row = this.asObject(parsed);
    if (row === null) {
      throw new Error(`${operation} returned an invalid JSON object.`);
    }
    return row;
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
