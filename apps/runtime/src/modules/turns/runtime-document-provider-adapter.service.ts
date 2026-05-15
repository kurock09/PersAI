import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import type {
  RuntimeDocumentJobRunRequest,
  RuntimeDocumentJobRunResult,
  RuntimeOutputArtifact
} from "@persai/runtime-contract";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";

type SupportedDocumentProvider = "pdfmonkey" | "gamma";
const DEFAULT_DOCUMENT_TIMEOUT_MS = 6 * 60 * 1000;
const PDFMONKEY_TEMPLATE_MISSING_CODE = "document_template_not_configured";

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
    const timeoutMs = this.resolveWorkerTimeoutMs(input.bundle);
    const filename = this.resolveRequestedFilename(input.request);
    const providerOutcome = await this.providerGatewayClientService.generateDocumentOutcome(
      {
        htmlContent: this.renderPdfMonkeyHtml(input.request),
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
    const artifact = await this.persistGeneratedArtifact({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      sessionId: input.request.job.chatId,
      requestId: input.request.job.id,
      filename,
      bytesBase64: providerResult.bytesBase64,
      mimeType: providerResult.mimeType
    });

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
      bytesBase64: providerResult.bytesBase64,
      mimeType: providerResult.mimeType
    });
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

  private renderPdfMonkeyHtml(request: RuntimeDocumentJobRunRequest): string {
    const prompt = this.escapeHtml(request.directToolExecution.request.prompt);
    const instructions = this.escapeHtml(request.directToolExecution.request.instructions ?? "");
    const sourceText = this.escapeHtml(request.job.sourceUserMessageText);
    const outline = this.renderOutline(request.directToolExecution.request.outline);
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      "  <title>PersAI Document</title>",
      "  <style>",
      "    body { font-family: Arial, sans-serif; color: #111827; margin: 32px; line-height: 1.5; }",
      "    h1, h2 { margin-bottom: 12px; }",
      "    .muted { color: #6b7280; font-size: 12px; }",
      "    .section { margin-top: 24px; }",
      "    pre { white-space: pre-wrap; font-family: inherit; background: #f9fafb; padding: 12px; border-radius: 8px; }",
      "  </style>",
      "</head>",
      "<body>",
      "  <h1>PersAI Document Draft</h1>",
      `  <p class="muted">Generated from persisted document job ${this.escapeHtml(request.job.id)}</p>`,
      '  <div class="section">',
      "    <h2>Prompt</h2>",
      `    <pre>${prompt}</pre>`,
      "  </div>",
      instructions.length === 0
        ? ""
        : [
            '  <div class="section">',
            "    <h2>Instructions</h2>",
            `    <pre>${instructions}</pre>`,
            "  </div>"
          ].join("\n"),
      '  <div class="section">',
      "    <h2>Source User Message</h2>",
      `    <pre>${sourceText}</pre>`,
      "  </div>",
      outline.length === 0
        ? ""
        : ['  <div class="section">', "    <h2>Outline</h2>", outline, "  </div>"].join("\n"),
      "</body>",
      "</html>"
    ]
      .filter((entry) => entry.length > 0)
      .join("\n");
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

  private async persistGeneratedArtifact(input: {
    assistantId: string;
    workspaceId: string;
    sessionId: string;
    requestId: string;
    filename: string;
    bytesBase64: string;
    mimeType: string;
  }): Promise<RuntimeOutputArtifact> {
    const extension = this.extensionForMimeType(input.mimeType);
    if (extension === null) {
      throw new Error(`Document provider returned unsupported MIME type "${input.mimeType}".`);
    }
    const buffer = Buffer.from(input.bytesBase64, "base64");
    if (buffer.length === 0) {
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
      buffer,
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
