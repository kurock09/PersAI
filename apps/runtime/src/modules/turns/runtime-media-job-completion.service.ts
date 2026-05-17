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
  RuntimeFailedEvent,
  RuntimeMediaJobCompletionRequest,
  RuntimeMediaJobCompletionResult,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeExecutionAdmissionService } from "./runtime-execution-admission.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";

type NativeManagedProvider = "openai" | "anthropic";
type ProviderSelection = { provider: NativeManagedProvider; model: string };

const MEDIA_JOB_COMPLETION_KEY_PREFIX = "media-job-completion";
const COMPLETION_MAX_OUTPUT_TOKENS = 250;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 500;

@Injectable()
export class RuntimeMediaJobCompletionService {
  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService,
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService
  ) {}

  async complete(
    input: RuntimeMediaJobCompletionRequest
  ): Promise<RuntimeMediaJobCompletionResult> {
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
          "Media-job completion requires either workerResult or failure context."
        );
      }
      if (input.workerResult !== undefined && input.failure !== undefined) {
        throw new BadRequestException(
          "Media-job completion request cannot carry both workerResult and failure."
        );
      }

      const syntheticTurn = this.buildSyntheticTurnRequest(input, bundle);
      const acceptedTurn = await this.turnAcceptanceService.acceptTurn(syntheticTurn);
      switch (acceptedTurn.outcome) {
        case "busy":
          throw new ConflictException(
            `Media-job completion session "${acceptedTurn.session.sessionId}" is already processing another turn.`
          );
        case "in_flight":
          throw new ConflictException(
            acceptedTurn.requestId === null
              ? "A matching media-job completion turn is already in flight."
              : `Media-job completion turn "${acceptedTurn.requestId}" is already in flight.`
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
    input: RuntimeMediaJobCompletionRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<RuntimeMediaJobCompletionResult> {
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
    input: RuntimeMediaJobCompletionRequest,
    bundle: AssistantRuntimeBundle
  ): RuntimeTurnRequest {
    const bundleHash = hashAssistantRuntimeBundleDocument(input.runtimeBundleDocument);
    const key = this.buildCompletionKey(input);
    const isFailure = input.failure !== undefined;
    const messageText = isFailure
      ? `Explain failed async media job ${input.job.id}`
      : `Complete async media job ${input.job.id}`;
    const externalThreadKeyPrefix = isFailure
      ? "system:media-job-failure"
      : "system:media-job-completion";
    return {
      requestId: key,
      idempotencyKey: key,
      runtimeTier: input.runtimeTier,
      bundle: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        bundleId: `media-job-completion:${input.job.id}:${bundle.metadata.publishedVersionId}`,
        publishedVersionId: bundle.metadata.publishedVersionId,
        bundleHash,
        compiledAt: new Date().toISOString()
      },
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: input.job.surface,
        externalThreadKey: `${externalThreadKeyPrefix}:${input.job.id}`,
        externalUserKey: null,
        mode: "direct"
      },
      message: {
        text: messageText,
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
    input: RuntimeMediaJobCompletionRequest,
    bundle: AssistantRuntimeBundle,
    providerSelection: ProviderSelection
  ): ProviderGatewayTextGenerateRequest {
    const isFailure = input.failure !== undefined;
    const explicitRules = isFailure
      ? this.buildFailureExplicitRules()
      : this.buildSuccessExplicitRules();
    const developerInstructions = [
      this.normalizeOptionalText(bundle.promptConstructor.ordinary.sections.heartbeat),
      explicitRules
    ]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n");

    const userPayload: Record<string, unknown> = {
      currentTimeIso: new Date().toISOString(),
      mode: isFailure ? "failure_explanation" : "completion_framing",
      job: {
        id: input.job.id,
        surface: input.job.surface,
        kind: input.job.kind,
        sourceUserMessageText: input.job.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.job.sourceUserMessageCreatedAt
      },
      latestChatHistory: input.currentHistory.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
        author: message.author,
        content: message.content.slice(0, MAX_HISTORY_CHARS),
        createdAt: message.createdAt
      })),
      assistant: {
        name: bundle.persona.displayName,
        userLocale: bundle.userContext.locale,
        userTimezone: bundle.userContext.timezone
      }
    };
    if (isFailure && input.failure !== undefined) {
      userPayload.failure = {
        code: input.failure.code,
        message: input.failure.message,
        attemptCount: input.failure.attemptCount,
        maxAttempts: input.failure.maxAttempts,
        retryable: input.failure.retryable,
        stage: input.failure.stage
      };
    } else if (input.workerResult !== undefined) {
      userPayload.workerResult = input.workerResult;
    }

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
              text: JSON.stringify(userPayload, null, 2)
            }
          ]
        }
      ],
      maxOutputTokens: COMPLETION_MAX_OUTPUT_TOKENS,
      outputSchema: {
        name: isFailure ? "media_job_failure_explanation" : "media_job_completion",
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
        classification: isFailure ? "media_job_failure_explanation" : "media_job_completion"
      }
    };
  }

  private buildSuccessExplicitRules(): string {
    return [
      "You are framing the completion of a finished PersAI async media job.",
      "Backend state already owns the job, artifacts, delivery idempotency, and quota truth.",
      "Write only optional user-facing completion text for the finished media job.",
      "If the stored worker text should be reused unchanged, return assistantText=null.",
      "If no final text should be sent, return assistantText as an empty string.",
      "Do not claim that media was already sent, attached, uploaded, or delivered.",
      "Do not generate more media, do not call tools, and do not reopen the old user turn.",
      "Keep the text short, calm, and aware of the latest chat context."
    ].join("\n");
  }

  private buildFailureExplicitRules(): string {
    return [
      "You are explaining to the user that an async PersAI media job did NOT finish successfully.",
      "Backend state already owns job status, retries, refunds, and quota truth.",
      "The provider/runtime error reason is in failure.message and failure.code; treat it as the only authoritative reason.",
      "Tell the user, in their language, what the job tried to do and why it didn't finish, in honest, calm, brief words.",
      "If the failure looks like a provider safety/policy/content block, say so plainly and suggest rephrasing without disallowed details.",
      "If the failure looks like a transient infrastructure issue and failure.retryable=true, suggest trying the same request again shortly.",
      "Do not invent technical details, retry counts, internal codes, or claim the system did anything it did not do.",
      "Do not claim media was generated, attached, uploaded, or delivered when it was not.",
      "Do not generate more media, do not call tools, and do not reopen the original user turn.",
      "Keep the message short (1\u20133 sentences), human, and aware of the latest chat context."
    ].join("\n");
  }

  private parseCompletionJson(text: string | null): { assistantText: string | null } {
    if (text === null || text.trim().length === 0) {
      throw new BadGatewayException("Media-job completion returned empty output.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new BadGatewayException("Media-job completion returned non-JSON output.");
      }
      parsed = JSON.parse(match[0]);
    }
    const row = this.asObject(parsed);
    if (row === null) {
      throw new BadGatewayException("Media-job completion returned an invalid JSON object.");
    }
    const assistantText =
      row.assistantText === null
        ? null
        : typeof row.assistantText === "string"
          ? row.assistantText.trim()
          : null;
    if (row.assistantText !== null && typeof row.assistantText !== "string") {
      throw new BadGatewayException("Media-job completion assistantText must be string or null.");
    }
    return { assistantText };
  }

  private resolveReplayResult(payload: unknown): RuntimeMediaJobCompletionResult {
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
      code: "media_job_completion_failed",
      message: error instanceof Error ? error.message : "Media-job completion failed.",
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
      "Runtime bundle does not declare a provider/model for media-job completion."
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

  private buildCompletionKey(input: RuntimeMediaJobCompletionRequest): string {
    const isFailure = input.failure !== undefined;
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          jobId: input.job.id,
          mode: isFailure ? "failure" : "success",
          workerText: input.workerResult?.assistantText ?? null,
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
    const prefix = isFailure
      ? `${MEDIA_JOB_COMPLETION_KEY_PREFIX}-failure`
      : MEDIA_JOB_COMPLETION_KEY_PREFIX;
    return `${prefix}:${input.job.id}:${digest}`;
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
