import { createHash } from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable
} from "@nestjs/common";
import {
  hashAssistantRuntimeBundleDocument,
  type AssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type {
  PersaiRuntimeModelRole,
  ProviderGatewayTextGenerateRequest,
  RuntimeDocumentJobCompletionRequest,
  RuntimeDocumentJobCompletionResult,
  RuntimeFailedEvent,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeExecutionAdmissionService } from "./runtime-execution-admission.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";

type NativeManagedProvider = "openai" | "anthropic";
type ProviderSelection = { provider: NativeManagedProvider; model: string };

const DOCUMENT_JOB_COMPLETION_KEY_PREFIX = "document-job-completion";
const COMPLETION_MAX_OUTPUT_TOKENS = 220;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 500;

@Injectable()
export class RuntimeDocumentJobCompletionService {
  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService,
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService
  ) {}

  async complete(
    input: RuntimeDocumentJobCompletionRequest
  ): Promise<RuntimeDocumentJobCompletionResult> {
    return this.runtimeExecutionAdmissionService.runWithAdmission("background", async () => {
      const bundle = this.parseBundle(input.runtimeBundleDocument);
      if (bundle.metadata.assistantId !== input.assistantId) {
        throw new BadRequestException("runtimeBundleDocument assistantId does not match request.");
      }
      if (bundle.metadata.workspaceId !== input.workspaceId) {
        throw new BadRequestException("runtimeBundleDocument workspaceId does not match request.");
      }
      if (input.workerResult === undefined && input.failure === undefined) {
        throw new BadRequestException(
          "Document-job completion requires either workerResult or failure context."
        );
      }
      if (input.workerResult !== undefined && input.failure !== undefined) {
        throw new BadRequestException(
          "Document-job completion request cannot carry both workerResult and failure."
        );
      }
      const syntheticTurn = this.buildSyntheticTurnRequest(input, bundle);
      const acceptedTurn = await this.turnAcceptanceService.acceptTurn(syntheticTurn);
      switch (acceptedTurn.outcome) {
        case "busy":
          throw new ConflictException(
            `Document-job completion session "${acceptedTurn.session.sessionId}" is already processing another turn.`
          );
        case "in_flight":
          throw new ConflictException(
            acceptedTurn.requestId === null
              ? "A matching document-job completion turn is already in flight."
              : `Document-job completion turn "${acceptedTurn.requestId}" is already in flight.`
          );
        case "replayed":
          return this.resolveReplayResult(acceptedTurn.receipt.resultPayload);
        case "accepted":
          return this.executeAcceptedCompletion(acceptedTurn, input, bundle);
      }
    });
  }

  private async executeAcceptedCompletion(
    acceptedTurn: AcceptedRuntimeTurn,
    input: RuntimeDocumentJobCompletionRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<RuntimeDocumentJobCompletionResult> {
    try {
      const providerSelection = this.resolveProviderSelection(bundle, "normal_reply");
      const response = await this.providerGatewayClientService.generateText(
        this.buildProviderRequest(acceptedTurn, input, bundle, providerSelection)
      );
      const parsed = this.parseCompletionJson(response.text);
      const turnResult: RuntimeTurnResult = {
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        assistantText: parsed.assistantText ?? "",
        artifacts: [],
        respondedAt: new Date().toISOString(),
        usage: response.usage,
        toolInvocations: []
      };
      await this.turnFinalizationService.completeAcceptedTurn(acceptedTurn, turnResult);
      return {
        assistantText: parsed.assistantText,
        usage: response.usage,
        rawText: response.text
      };
    } catch (error) {
      const failure = this.toFailedEvent(acceptedTurn, error);
      await this.turnFinalizationService.failAcceptedTurn(acceptedTurn, failure);
      throw error;
    }
  }

  private buildSyntheticTurnRequest(
    input: RuntimeDocumentJobCompletionRequest,
    bundle: AssistantRuntimeBundle
  ): RuntimeTurnRequest {
    const bundleHash = hashAssistantRuntimeBundleDocument(input.runtimeBundleDocument);
    const key = this.buildCompletionKey(input);
    const isFailure = input.failure !== undefined;
    return {
      requestId: key,
      idempotencyKey: key,
      runtimeTier: input.runtimeTier,
      bundle: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        bundleId: `document-job-completion:${input.job.id}:${bundle.metadata.publishedVersionId}`,
        publishedVersionId: bundle.metadata.publishedVersionId,
        bundleHash,
        compiledAt: new Date().toISOString()
      },
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: input.job.surface,
        externalThreadKey: isFailure
          ? `system:document-job-failure:${input.job.id}`
          : `system:document-job-completion:${input.job.id}`,
        externalUserKey: null,
        mode: "direct"
      },
      message: {
        text: isFailure
          ? `Explain failed async document job ${input.job.id}`
          : `Complete async document job ${input.job.id}`,
        attachments: [],
        locale: bundle.userContext.locale,
        timezone: bundle.userContext.timezone,
        receivedAt: new Date().toISOString()
      },
      modelRoleOverride: "normal_reply"
    };
  }

  private buildProviderRequest(
    acceptedTurn: AcceptedRuntimeTurn,
    input: RuntimeDocumentJobCompletionRequest,
    bundle: AssistantRuntimeBundle,
    providerSelection: ProviderSelection
  ): ProviderGatewayTextGenerateRequest {
    const isFailure = input.failure !== undefined;
    const developerInstructions = [
      this.normalizeOptionalText(bundle.promptConstructor.ordinary.sections.heartbeat),
      isFailure
        ? [
            "You are explaining to the user that a PersAI async document job did NOT finish successfully.",
            "Backend state already owns job status, retries, delivery truth, and quota truth.",
            "The provider/runtime error reason is in failure.message and failure.code; treat it as the only authoritative reason.",
            "Tell the user, in their language, what the document request tried to do and why it did not finish, in honest, calm, brief words.",
            "If the failure looks like a provider safety/policy/content block, say so plainly and suggest rephrasing without disallowed details.",
            "If the failure looks like a transient infrastructure issue and failure.retryable=true, suggest trying again shortly.",
            "Do not invent technical details, retry counts, internal ids, provider names, template ids, or hidden system behavior.",
            "Do not claim the file was sent, attached, uploaded, or delivered when it was not.",
            "Keep the message short (1-3 sentences), human, and aware of the latest chat context."
          ].join("\n")
        : [
            "You are framing the completion of a finished PersAI async document job.",
            "Backend state already owns the job, file delivery, idempotency, and quota truth.",
            "Write only optional user-facing completion text.",
            "If the worker text should be reused unchanged, return assistantText=null.",
            "Do not claim the file was already sent, attached, uploaded, or delivered.",
            "Do not mention internal providers, templates, job ids, or technical pipeline details.",
            "Keep the text short, calm, and aware of the latest chat context."
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
                  currentTimeIso: new Date().toISOString(),
                  mode: isFailure ? "document_failure_explanation" : "document_completion_framing",
                  job: {
                    id: input.job.id,
                    docId: input.job.docId,
                    versionId: input.job.versionId,
                    surface: input.job.surface,
                    outputFormat: input.job.outputFormat,
                    descriptorMode: input.job.descriptorMode,
                    sourceUserMessageText: input.job.sourceUserMessageText,
                    sourceUserMessageCreatedAt: input.job.sourceUserMessageCreatedAt
                  },
                  latestChatHistory: input.currentHistory
                    .slice(-MAX_HISTORY_MESSAGES)
                    .map((message) => ({
                      author: message.author,
                      content: message.content.slice(0, MAX_HISTORY_CHARS),
                      createdAt: message.createdAt
                    })),
                  assistant: {
                    name: bundle.persona.displayName,
                    userLocale: bundle.userContext.locale,
                    userTimezone: bundle.userContext.timezone
                  },
                  ...(isFailure
                    ? {
                        failure: input.failure
                      }
                    : {
                        workerResult: input.workerResult
                      })
                },
                null,
                2
              )
            }
          ]
        }
      ],
      maxOutputTokens: COMPLETION_MAX_OUTPUT_TOKENS,
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
        runtimeSessionId: acceptedTurn.session.sessionId,
        runtimeRequestId: acceptedTurn.receipt.requestId,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification: "document_job_completion"
      }
    };
  }

  private parseCompletionJson(text: string | null): { assistantText: string | null } {
    if (text === null || text.trim().length === 0) {
      throw new BadGatewayException("Document-job completion returned empty output.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new BadGatewayException("Document-job completion returned non-JSON output.");
      }
      parsed = JSON.parse(match[0]);
    }
    const row = this.asObject(parsed);
    if (row === null) {
      throw new BadGatewayException("Document-job completion returned an invalid JSON object.");
    }
    const assistantText =
      row.assistantText === null
        ? null
        : typeof row.assistantText === "string"
          ? row.assistantText.trim()
          : null;
    if (row.assistantText !== null && typeof row.assistantText !== "string") {
      throw new BadGatewayException(
        "Document-job completion assistantText must be string or null."
      );
    }
    return { assistantText };
  }

  private resolveReplayResult(payload: unknown): RuntimeDocumentJobCompletionResult {
    const result = this.asObject(payload);
    if (result === null) {
      throw new BadRequestException("Replayed completion result payload is invalid.");
    }
    const assistantText =
      typeof result.assistantText === "string"
        ? result.assistantText
        : result.assistantText === ""
          ? ""
          : "";
    return {
      assistantText,
      usage:
        this.asObject(result.usageAccounting) !== null ? (result.usageAccounting as never) : null,
      rawText: null
    };
  }

  private toFailedEvent(acceptedTurn: AcceptedRuntimeTurn, error: unknown): RuntimeFailedEvent {
    return {
      type: "failed",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      code: "document_job_completion_failed",
      message: error instanceof Error ? error.message : "Document-job completion failed.",
      willRetry: false
    };
  }

  private parseBundle(document: string): AssistantRuntimeBundle {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      throw new BadRequestException("runtimeBundleDocument must be valid JSON.");
    }
    const row = this.asObject(parsed);
    if (
      row === null ||
      this.asObject(row.metadata) === null ||
      this.asObject(row.runtime) === null ||
      this.asObject(row.promptConstructor) === null
    ) {
      throw new BadRequestException("runtimeBundleDocument has an invalid runtime bundle shape.");
    }
    return parsed as AssistantRuntimeBundle;
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
    if (primaryPath?.active === false) {
      throw new BadRequestException("Runtime provider path is inactive.");
    }
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
      "Runtime bundle does not declare a provider/model for document-job completion."
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

  private buildCompletionKey(input: RuntimeDocumentJobCompletionRequest): string {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          job: input.job,
          mode: input.failure !== undefined ? "failure" : "completion",
          workerResult: input.workerResult ?? null,
          failure: input.failure ?? null,
          history: input.currentHistory.map((entry) => ({
            author: entry.author,
            content: entry.content,
            createdAt: entry.createdAt
          }))
        })
      )
      .digest("hex")
      .slice(0, 16);
    return `${DOCUMENT_JOB_COMPLETION_KEY_PREFIX}:${input.job.id}:${digest}`;
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
}
