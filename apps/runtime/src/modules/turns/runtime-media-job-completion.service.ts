import { createHash } from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger
} from "@nestjs/common";
import {
  hashAssistantRuntimeBundleDocument,
  type AssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type {
  PersaiRuntimeModelRole,
  ProviderGatewayMessageContentBlock,
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
import {
  hydrateMediaJobCompletionVisionContent,
  type MediaJobCompletionVisionArtifactRef
} from "./media-job-completion-vision-hydration";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

type NativeManagedProvider = "openai" | "anthropic";
type ProviderSelection = { provider: NativeManagedProvider; model: string };

const MEDIA_JOB_COMPLETION_KEY_PREFIX = "media-job-completion";
const COMPLETION_MAX_OUTPUT_TOKENS = 300;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 500;

@Injectable()
export class RuntimeMediaJobCompletionService {
  private readonly logger = new Logger(RuntimeMediaJobCompletionService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService,
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
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
    const framingMode = this.resolveSuccessFramingMode(input, bundle);
    try {
      const providerSelection = this.resolveProviderSelection(bundle, "system_tool");
      const response = await this.providerGatewayClientService.generateText(
        await this.buildProviderRequest(acceptedTurn, input, bundle, providerSelection, framingMode)
      );
      const parsed = this.parseCompletionJson(response.text);
      const assistantText = parsed.assistantText?.trim() ?? "";
      if (
        input.failure === undefined &&
        this.isImageToolJob(input.job.toolCode) &&
        assistantText.length === 0
      ) {
        throw new BadGatewayException("Media-job completion returned empty assistantText.");
      }
      const turnResult: RuntimeTurnResult = {
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        assistantText,
        artifacts: [],
        respondedAt: new Date().toISOString(),
        usage: response.usage,
        toolInvocations: []
      };
      await this.turnFinalizationService.completeAcceptedTurn(acceptedTurn, turnResult);
      return {
        assistantText: assistantText.length > 0 ? assistantText : null,
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
      modelRoleOverride: "system_tool"
    };
  }

  private async buildProviderRequest(
    acceptedTurn: AcceptedRuntimeTurn,
    input: RuntimeMediaJobCompletionRequest,
    bundle: AssistantRuntimeBundle,
    providerSelection: ProviderSelection,
    framingMode: "failure" | "image_text_only" | "image_vision"
  ): Promise<ProviderGatewayTextGenerateRequest> {
    const isFailure = framingMode === "failure";
    const explicitRules = isFailure
      ? this.buildFailureExplicitRules()
      : framingMode === "image_vision"
        ? this.buildVisionSuccessExplicitRules(input.job.toolCode)
        : this.buildTextOnlySuccessExplicitRules(input.job.toolCode);
    const developerInstructions = [explicitRules]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n");

    const userPayload: Record<string, unknown> = {
      currentTimeIso: new Date().toISOString(),
      mode: isFailure ? "failure_explanation" : "completion_framing",
      job: {
        id: input.job.id,
        surface: input.job.surface,
        kind: input.job.kind,
        toolCode: input.job.toolCode ?? null,
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
      userPayload.workerResult = {
        assistantText: input.workerResult.assistantText,
        artifacts: input.workerResult.artifacts.map((artifact) => ({
          type: artifact.type,
          filename: artifact.filename,
          fileRef: artifact.fileRef,
          role: artifact.role ?? "output"
        }))
      };
      if (framingMode === "image_vision") {
        userPayload.visionReview = {
          enabled: true,
          sourceReferenceImageCount: input.workerResult.artifacts.filter(
            (artifact) => artifact.role === "source_reference"
          ).length,
          outputImageCount: input.workerResult.artifacts.filter(
            (artifact) => (artifact.role ?? "output") === "output"
          ).length
        };
      }
    }

    const contentBlocks: ProviderGatewayMessageContentBlock[] = [
      {
        type: "text",
        text: JSON.stringify(userPayload, null, 2)
      }
    ];
    if (framingMode === "image_vision" && input.workerResult !== undefined) {
      const visionArtifacts = this.collectVisionArtifactRefs(input);
      const visionBlocks = await hydrateMediaJobCompletionVisionContent({
        mediaObjectStorage: this.mediaObjectStorage,
        artifacts: visionArtifacts
      });
      if (visionBlocks.length === 0) {
        this.logger.warn(
          `Media-job completion vision hydration produced no image blocks for job ${input.job.id}; continuing text-only.`
        );
      } else {
        contentBlocks.push(...visionBlocks);
      }
    }

    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.normalizeOptionalText(bundle.promptConstructor.ordinary.systemPrompt),
      ...(developerInstructions.length === 0 ? {} : { developerInstructions }),
      messages: [
        {
          role: "user",
          content: contentBlocks
        }
      ],
      maxOutputTokens: COMPLETION_MAX_OUTPUT_TOKENS,
      outputSchema: {
        name: isFailure ? "media_job_failure_explanation" : "media_job_completion",
        strict: true,
        schema: isFailure
          ? {
              type: "object",
              additionalProperties: false,
              required: ["assistantText"],
              properties: {
                assistantText: {
                  type: ["string", "null"]
                }
              }
            }
          : {
              type: "object",
              additionalProperties: false,
              required: ["assistantText"],
              properties: {
                assistantText: {
                  type: "string"
                }
              }
            }
      },
      requestMetadata: {
        runtimeSessionId: acceptedTurn.session.sessionId,
        runtimeRequestId: acceptedTurn.receipt.requestId,
        toolLoopIteration: null,
        compactionToolCode: null,
        classification:
          framingMode === "image_vision"
            ? "media_job_completion_vision"
            : isFailure
              ? "media_job_failure_explanation"
              : "media_job_completion"
      }
    };
  }

  private collectVisionArtifactRefs(
    input: RuntimeMediaJobCompletionRequest
  ): MediaJobCompletionVisionArtifactRef[] {
    const workerArtifacts = input.workerResult?.artifacts ?? [];
    const sourceRefs = workerArtifacts
      .filter((artifact) => artifact.role === "source_reference")
      .flatMap((artifact) => this.toVisionArtifactRef(artifact, "source_reference"));
    const outputRefs = workerArtifacts
      .filter((artifact) => (artifact.role ?? "output") === "output")
      .flatMap((artifact) => this.toVisionArtifactRef(artifact, "output"));
    return [...sourceRefs, ...outputRefs];
  }

  private toVisionArtifactRef(
    artifact: NonNullable<RuntimeMediaJobCompletionRequest["workerResult"]>["artifacts"][number],
    role: "output" | "source_reference"
  ): MediaJobCompletionVisionArtifactRef[] {
    if (
      artifact.type !== "image" ||
      typeof artifact.objectKey !== "string" ||
      artifact.objectKey.trim().length === 0
    ) {
      return [];
    }
    const mimeType =
      typeof artifact.mimeType === "string" && artifact.mimeType.trim().length > 0
        ? artifact.mimeType.trim()
        : "image/png";
    if (!mimeType.startsWith("image/")) {
      return [];
    }
    return [
      {
        objectKey: artifact.objectKey.trim(),
        mimeType,
        filename: artifact.filename,
        role
      }
    ];
  }

  private resolveSuccessFramingMode(
    input: RuntimeMediaJobCompletionRequest,
    bundle: AssistantRuntimeBundle
  ): "failure" | "image_text_only" | "image_vision" {
    if (input.failure !== undefined) {
      return "failure";
    }
    if (!this.isImageToolJob(input.job.toolCode)) {
      return "image_text_only";
    }
    if (this.resolveMediaCompletionVisionEnabled(bundle, input.job.toolCode)) {
      return "image_vision";
    }
    return "image_text_only";
  }

  private resolveMediaCompletionVisionEnabled(
    bundle: AssistantRuntimeBundle,
    toolCode: "image_generate" | "image_edit" | null | undefined
  ): boolean {
    if (toolCode !== "image_generate" && toolCode !== "image_edit") {
      return false;
    }
    const policy = bundle.governance.toolPolicies?.find((entry) => entry.toolCode === toolCode);
    return policy?.mediaCompletionVisionEnabled === true;
  }

  private isImageToolJob(
    toolCode: RuntimeMediaJobCompletionRequest["job"]["toolCode"]
  ): toolCode is "image_generate" | "image_edit" {
    return toolCode === "image_generate" || toolCode === "image_edit";
  }

  private buildTextOnlySuccessExplicitRules(
    toolCode: RuntimeMediaJobCompletionRequest["job"]["toolCode"]
  ): string {
    const subject =
      toolCode === "image_edit"
        ? "the finished image edit"
        : toolCode === "image_generate"
          ? "the finished image generation"
          : "the finished media job";
    return [
      "You are framing the completion of a finished PersAI async media job.",
      "Backend state already owns the job, artifacts, delivery idempotency, and quota truth.",
      `You MUST return a non-empty assistantText string (1-3 short sentences) about ${subject}.`,
      "Write in the user's language when possible, stay calm, and reflect the latest chat context.",
      "Describe what the job attempted to do for the user based on sourceUserMessageText and artifact metadata.",
      "Do not claim that media was already sent, attached, uploaded, or delivered to the chat.",
      "Do not generate more media, do not call tools, and do not reopen the old user turn."
    ].join("\n");
  }

  private buildVisionSuccessExplicitRules(
    toolCode: RuntimeMediaJobCompletionRequest["job"]["toolCode"]
  ): string {
    const subject =
      toolCode === "image_edit" ? "the edited image result" : "the generated image result";
    return [
      "You are reviewing the completion of a finished PersAI async image job.",
      "The attached images are authoritative visual evidence. Source reference images (if any) show the input; produced output images show the result.",
      `You MUST return a non-empty assistantText string (1-3 short sentences) about ${subject}.`,
      "Briefly describe what you see in the output image(s) relative to sourceUserMessageText.",
      "If the visual result clearly misses the request, say so honestly and calmly offer to redo or refine it.",
      "If the result is acceptable, confirm what was done without overstating perfection.",
      "Do not claim that media was already sent, attached, uploaded, or delivered to the chat.",
      "Do not generate more media, do not call tools, and do not reopen the old user turn.",
      "Write in the user's language when possible."
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
          toolCode: input.job.toolCode ?? null,
          workerText: input.workerResult?.assistantText ?? null,
          artifactObjectKeys: (input.workerResult?.artifacts ?? []).map((artifact) => ({
            objectKey: artifact.objectKey,
            role: artifact.role ?? "output"
          })),
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
