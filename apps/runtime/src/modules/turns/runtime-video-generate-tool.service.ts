import { randomUUID } from "node:crypto";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  type PersaiRuntimeVideoGenerateProviderId,
  type PersaiRuntimeVideoGenerateSize,
  type ProviderGatewayToolCall,
  type ProviderGatewayVideoGenerateRequest,
  type RuntimeAttachmentRef,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy,
  type RuntimeVideoModelParameters,
  type RuntimeVideoGenerateRequest,
  type RuntimeVideoGenerateToolResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import {
  ProviderGatewayClientService,
  ProviderGatewayHttpError,
  ProviderGatewayTimeoutError
} from "./provider-gateway.client.service";
import { buildGeneratedFileSemanticSummary } from "./generated-file-semantic-summary";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";

const VIDEO_GENERATE_TOOL_CODE = "video_generate" as const;
const DEFAULT_VIDEO_GENERATE_TIMEOUT_MS = 600_000;
const SUPPORTED_VIDEO_REFERENCE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

type ResolvedVideoReferenceSelection =
  | {
      ok: true;
      referenceImage: {
        bytesBase64: string;
        mimeType: string;
        filename: string | null;
      } | null;
      referenceImageAlias: string | null;
      referenceFilename: string | null;
    }
  | {
      ok: false;
      reason: string;
      warning: string;
    };

type ResolvedVideoCredentialAttempt = {
  credential: AssistantRuntimeBundleToolCredentialRef;
  providerId: PersaiRuntimeVideoGenerateProviderId;
  model: ProviderGatewayVideoGenerateRequest["model"];
};

type NormalizedVideoExecutionRequest = {
  request: RuntimeVideoGenerateRequest & {
    seconds: number;
    size: PersaiRuntimeVideoGenerateSize;
  };
  warning: string | null;
};

export interface RuntimeVideoGenerateToolExecutionResult {
  payload: RuntimeVideoGenerateToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeVideoGenerateToolService {
  private readonly logger = new Logger(RuntimeVideoGenerateToolService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly runtimeAssistantFileRegistryService: RuntimeAssistantFileRegistryService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    availableAttachments: RuntimeAttachmentRef[];
    sessionId: string;
    requestId: string;
    deferToAsyncMediaJob?: {
      sourceUserMessageId: string;
      sourceUserMessageText: string;
    };
  }): Promise<RuntimeVideoGenerateToolExecutionResult> {
    const request = this.readVideoGenerateArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: null,
          requestedSeconds: null,
          size: null,
          referenceImageAlias: null,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message
        },
        artifacts: [],
        isError: true
      };
    }

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, VIDEO_GENERATE_TOOL_CODE);
    if (policy === null) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: request.size,
          referenceImageAlias: request.referenceImageAlias,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "tool_unavailable",
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    const credential = this.resolveConfiguredCredentialRef(params.bundle, VIDEO_GENERATE_TOOL_CODE);
    if (credential === null) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: request.size,
          referenceImageAlias: request.referenceImageAlias,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "credential_not_configured",
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    const providerId = this.resolveVideoGenerateProviderId(credential.providerId ?? null);
    if (providerId === null) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: request.size,
          referenceImageAlias: request.referenceImageAlias,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "provider_unavailable",
          warning:
            "Selected video-generation provider is not supported by the current native runtime."
        },
        artifacts: [],
        isError: false
      };
    }
    const primaryModel = this.resolveVideoGenerateModelKey(credential);
    const normalizedRequest = this.normalizeExecutionRequest(
      request,
      credential.videoModelParameters
    );
    if (normalizedRequest instanceof Error) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: primaryModel,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: request.size,
          referenceImageAlias: request.referenceImageAlias,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "video_model_parameters_missing",
          warning: normalizedRequest.message
        },
        artifacts: [],
        isError: true
      };
    }
    const credentialAttempts: ResolvedVideoCredentialAttempt[] = [
      {
        credential,
        providerId,
        model: primaryModel
      },
      ...this.resolveFallbackVideoCredentialAttempts(credential)
    ];

    const selection = await this.resolveReferenceImageSelection(
      params.availableAttachments,
      request
    );
    if (!selection.ok) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: request.size,
          referenceImageAlias: request.referenceImageAlias,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: selection.reason,
          warning: selection.warning
        },
        artifacts: [],
        isError: false
      };
    }

    if (params.deferToAsyncMediaJob !== undefined) {
      try {
        const enqueueOutcome = await this.persaiInternalApiClientService.enqueueDeferredMediaJob({
          assistantId: params.bundle.metadata.assistantId,
          sourceUserMessageId: params.deferToAsyncMediaJob.sourceUserMessageId,
          sourceUserMessageText: params.deferToAsyncMediaJob.sourceUserMessageText,
          attachments: params.availableAttachments,
          directToolExecution: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            request
          }
        });
        if (!enqueueOutcome.accepted) {
          return {
            payload: {
              toolCode: VIDEO_GENERATE_TOOL_CODE,
              executionMode: "worker",
              provider: providerId,
              model: primaryModel,
              prompt: request.prompt,
              requestedSeconds: normalizedRequest.request.seconds,
              size: normalizedRequest.request.size,
              referenceImageAlias: selection.referenceImageAlias,
              referenceFilename: selection.referenceFilename,
              artifact: null,
              usage: null,
              action: "skipped",
              reason: enqueueOutcome.code,
              warning: this.mergeWarnings(normalizedRequest.warning, enqueueOutcome.message),
              ...(enqueueOutcome.guidance === null ? {} : { guidance: enqueueOutcome.guidance }),
              jobId: null
            },
            artifacts: [],
            isError: false
          };
        }
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: primaryModel,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            size: normalizedRequest.request.size,
            referenceImageAlias: selection.referenceImageAlias,
            referenceFilename: selection.referenceFilename,
            artifact: null,
            usage: null,
            action: "pending_delivery",
            reason: null,
            warning: normalizedRequest.warning,
            jobId: enqueueOutcome.jobId,
            canSendFileNow: false,
            messageToUser:
              "Accepted. The video cannot be attached in this reply; it is being prepared and will be delivered in a separate message when ready.",
            requestedCount: 1,
            expectedResultCount: 1
          },
          artifacts: [],
          isError: false
        };
      } catch (error) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            size: normalizedRequest.request.size,
            referenceImageAlias: selection.referenceImageAlias,
            referenceFilename: selection.referenceFilename,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "runtime_degraded",
            warning:
              error instanceof Error
                ? error.message
                : "Deferred video generation could not be enqueued.",
            jobId: null
          },
          artifacts: [],
          isError: false
        };
      }
    }

    const warnings: string[] = [];
    for (const [attemptIndex, attempt] of credentialAttempts.entries()) {
      try {
        const attemptNormalizedRequest = this.normalizeExecutionRequest(
          request,
          attempt.credential.videoModelParameters
        );
        if (attemptNormalizedRequest instanceof Error) {
          throw attemptNormalizedRequest;
        }
        // ADR-105 §5 (single-owner reservation) — the worker NEVER touches the
        // monthly media quota. The enqueue admission seam
        // (`EnqueueRuntimeDeferredMediaJobService`) reserves the unit exactly
        // once, and the API layer resolves that reservation exactly once at the
        // job's terminal transition (scheduler `failJob` releases on failure; the
        // API delivery loop settles delivered / reconciles undelivered units per
        // ADR-082). The worker performs no reserve and no release.
        const providerResult = await this.providerGatewayClientService.generateVideo(
          {
            prompt: request.prompt,
            model: attempt.model,
            size: attemptNormalizedRequest.request.size,
            seconds: attemptNormalizedRequest.request.seconds,
            referenceImage: selection.referenceImage,
            providerParameters: attempt.credential.videoModelParameters?.providerParameters ?? null,
            credential: {
              toolCode: VIDEO_GENERATE_TOOL_CODE,
              secretId: attempt.credential.secretRef.id,
              providerId: attempt.providerId
            }
          },
          {
            timeoutMs: this.resolveWorkerTimeoutMs(params.bundle)
          }
        );
        this.logger.log(
          `[video-generate] requestId=${params.requestId} provider=${providerResult.provider} seconds=${String(
            attemptNormalizedRequest.request.seconds
          )} referenceAlias="${selection.referenceImageAlias ?? "none"}"`
        );

        const artifact = await this.persistGeneratedArtifact({
          assistantId: params.bundle.metadata.assistantId,
          workspaceId: params.bundle.metadata.workspaceId,
          sessionId: params.sessionId,
          requestId: params.requestId,
          filenameHint: request.filename,
          requestPrompt: request.prompt,
          referenceFilename: selection.referenceFilename,
          video: providerResult.video,
          billingFacts: providerResult.billingFacts
        });

        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerResult.provider,
            model: providerResult.model,
            prompt: request.prompt,
            requestedSeconds: attemptNormalizedRequest.request.seconds,
            size: providerResult.size ?? attemptNormalizedRequest.request.size,
            referenceImageAlias: selection.referenceImageAlias,
            referenceFilename: selection.referenceFilename,
            artifact,
            usage: providerResult.usage,
            action: "generated",
            reason: null,
            warning: this.mergeWarnings(
              attemptNormalizedRequest.warning,
              ...warnings,
              providerResult.warning,
              attemptIndex > 0 ? `Used fallback provider "${providerResult.provider}".` : null
            )
          },
          artifacts: [artifact],
          isError: false
        };
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : "Video generation failed.";
        const attemptWarning = `${attempt.providerId} failed: ${failureMessage}`;
        const shouldTryFallback =
          attemptIndex < credentialAttempts.length - 1 &&
          this.isFallbackEligibleVideoFailure(error);
        if (shouldTryFallback) {
          warnings.push(attemptWarning);
          continue;
        }
        this.logger.warn(
          `[video-generate] failed requestId=${params.requestId} provider=${attempt.providerId} referenceAlias="${
            selection.referenceImageAlias ?? "none"
          }": ${failureMessage}`
        );
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: attempt.providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            size: normalizedRequest.request.size,
            referenceImageAlias: selection.referenceImageAlias,
            referenceFilename: selection.referenceFilename,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "video_generation_failed",
            warning: this.mergeWarnings(...warnings, attemptWarning)
          },
          artifacts: [],
          isError: true
        };
      }
    }

    return {
      payload: {
        toolCode: VIDEO_GENERATE_TOOL_CODE,
        executionMode: "worker",
        provider: providerId,
        model: null,
        prompt: request.prompt,
        requestedSeconds: normalizedRequest.request.seconds,
        size: normalizedRequest.request.size,
        referenceImageAlias: selection.referenceImageAlias,
        referenceFilename: selection.referenceFilename,
        artifact: null,
        usage: null,
        action: "skipped",
        reason: "video_generation_failed",
        warning: this.mergeWarnings(
          normalizedRequest.warning,
          ...warnings,
          "Video generation failed."
        )
      },
      artifacts: [],
      isError: true
    };
  }

  private resolveFallbackVideoCredentialAttempts(
    credential: AssistantRuntimeBundleToolCredentialRef
  ): ResolvedVideoCredentialAttempt[] {
    const resolved: ResolvedVideoCredentialAttempt[] = [];
    const seenKeys = new Set<string>();

    for (const candidate of credential.fallbacks ?? []) {
      if (
        candidate.configured !== true ||
        typeof candidate.secretRef.id !== "string" ||
        candidate.secretRef.id.trim().length === 0
      ) {
        continue;
      }
      const providerId = this.resolveVideoGenerateProviderId(candidate.providerId ?? null);
      if (providerId === null) {
        continue;
      }
      const secretId = candidate.secretRef.id.trim();
      const model = this.resolveVideoGenerateModelKey(candidate);
      const dedupeKey = `${providerId}:${secretId}:${model ?? ""}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);
      resolved.push({
        credential: {
          ...candidate,
          secretRef: {
            ...candidate.secretRef,
            id: secretId
          }
        },
        providerId,
        model
      });
    }

    return resolved;
  }

  private isFallbackEligibleVideoFailure(error: unknown): boolean {
    return !(
      error instanceof ProviderGatewayTimeoutError ||
      (error instanceof ServiceUnavailableException && !(error instanceof ProviderGatewayHttpError))
    );
  }

  private readVideoGenerateArguments(
    args: Record<string, unknown>
  ): RuntimeVideoGenerateRequest | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) =>
        key !== "toolCode" &&
        key !== "prompt" &&
        key !== "filename" &&
        key !== "size" &&
        key !== "seconds" &&
        key !== "referenceImageAlias"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    if ("toolCode" in args && args.toolCode !== VIDEO_GENERATE_TOOL_CODE) {
      return new Error(`toolCode must be ${VIDEO_GENERATE_TOOL_CODE}`);
    }

    const prompt = this.asNonEmptyString(args.prompt);
    if (prompt === null) {
      return new Error("prompt must be a non-empty string");
    }

    const filename =
      args.filename === undefined || args.filename === null
        ? null
        : this.asNonEmptyString(args.filename);
    if ("filename" in args && args.filename !== null && filename === null) {
      return new Error("filename must be a non-empty string when provided");
    }

    const size =
      args.size === undefined || args.size === null
        ? null
        : typeof args.size === "string" && this.isVideoGenerateSize(args.size)
          ? args.size
          : null;
    if ("size" in args && args.size !== null && size === null) {
      return new Error(
        `size must be one of ${PERSAI_RUNTIME_VIDEO_GENERATE_SIZES.join(", ")} when provided`
      );
    }

    const seconds =
      args.seconds === undefined || args.seconds === null
        ? null
        : Number.isInteger(args.seconds) && Number(args.seconds) > 0
          ? Number(args.seconds)
          : null;
    if ("seconds" in args && args.seconds !== null && seconds === null) {
      return new Error("seconds must be a positive integer when provided");
    }

    const referenceImageAlias =
      args.referenceImageAlias === undefined || args.referenceImageAlias === null
        ? null
        : this.asNonEmptyString(args.referenceImageAlias);
    if (
      "referenceImageAlias" in args &&
      args.referenceImageAlias !== null &&
      referenceImageAlias === null
    ) {
      return new Error("referenceImageAlias must be a non-empty string when provided");
    }

    return {
      toolCode: VIDEO_GENERATE_TOOL_CODE,
      prompt,
      filename,
      size,
      seconds,
      referenceImageAlias
    };
  }

  private normalizeExecutionRequest(
    request: RuntimeVideoGenerateRequest,
    params: RuntimeVideoModelParameters | null | undefined
  ): NormalizedVideoExecutionRequest | Error {
    if (params === null || params === undefined) {
      return new Error(
        "Selected video model is missing structured video parameters in the materialized catalog."
      );
    }
    const normalizedSeconds = this.normalizeSeconds(request.seconds, params);
    const normalizedSize = this.normalizeSize(request.size, params);
    const warnings: string[] = [];
    if (request.seconds !== null && request.seconds !== normalizedSeconds) {
      warnings.push(
        `Adjusted requested video duration from ${String(request.seconds)}s to ${String(
          normalizedSeconds
        )}s for the selected model.`
      );
    }
    if (request.size !== null && request.size !== normalizedSize) {
      warnings.push(
        `Adjusted requested video size from ${request.size} to ${normalizedSize} for the selected model.`
      );
    }
    if (request.size === null) {
      warnings.push(`Used default video size ${normalizedSize} from the selected model catalog.`);
    }
    return {
      request: {
        ...request,
        seconds: normalizedSeconds,
        size: normalizedSize
      },
      warning: warnings.length > 0 ? warnings.join(" ") : null
    };
  }

  private normalizeSeconds(
    requestedSeconds: number | null,
    params: RuntimeVideoModelParameters
  ): number {
    const constraint = params.duration;
    if (constraint.kind === "allowed_list") {
      const allowed = [...constraint.values].sort((left, right) => left - right);
      const fallback = allowed[0];
      if (fallback === undefined) {
        throw new Error("Video model duration allowed_list cannot be empty.");
      }
      if (requestedSeconds === null) {
        return fallback;
      }
      return allowed.reduce((best, current) =>
        Math.abs(current - requestedSeconds) < Math.abs(best - requestedSeconds) ? current : best
      );
    }
    const base =
      requestedSeconds === null
        ? constraint.min
        : Math.max(constraint.min, Math.min(constraint.max, requestedSeconds));
    if (constraint.step === null || constraint.step <= 1) {
      return base;
    }
    const steps = Math.round((base - constraint.min) / constraint.step);
    const stepped = constraint.min + steps * constraint.step;
    return Math.max(constraint.min, Math.min(constraint.max, stepped));
  }

  private normalizeSize(
    requestedSize: PersaiRuntimeVideoGenerateSize | null,
    params: RuntimeVideoModelParameters
  ): PersaiRuntimeVideoGenerateSize {
    const first = params.aspectRatios[0];
    if (first === undefined) {
      throw new Error("Video model aspectRatios cannot be empty.");
    }
    if (requestedSize === null) {
      return first.size;
    }
    return params.aspectRatios.find((entry) => entry.size === requestedSize)?.size ?? first.size;
  }

  private async resolveReferenceImageSelection(
    attachments: RuntimeAttachmentRef[],
    request: RuntimeVideoGenerateRequest
  ): Promise<ResolvedVideoReferenceSelection> {
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    const referenceImageAlias = request.referenceImageAlias;
    if (referenceImageAlias === null) {
      return {
        ok: true,
        referenceImage: null,
        referenceImageAlias: null,
        referenceFilename: null
      };
    }

    if (imageAttachments.length === 0) {
      return {
        ok: false,
        reason: "reference_image_missing",
        warning:
          "Attach an image or keep the reference image in recent chat context before using referenceImageAlias."
      };
    }

    const attachment = this.findAttachmentByAlias(imageAttachments, referenceImageAlias);
    if (attachment === null) {
      return {
        ok: false,
        reason: "reference_image_alias_invalid",
        warning:
          "referenceImageAlias must match one of the available reusable image aliases in the working-files context."
      };
    }

    const loadedReference = await this.loadReferenceImage(attachment);
    if (!loadedReference.ok) {
      return loadedReference;
    }

    return {
      ok: true,
      referenceImage: loadedReference.image,
      referenceImageAlias: this.resolvePrimaryAttachmentAlias(attachment),
      referenceFilename: attachment.filename
    };
  }

  private async loadReferenceImage(attachment: RuntimeAttachmentRef): Promise<
    | {
        ok: true;
        image: {
          bytesBase64: string;
          mimeType: string;
          filename: string | null;
        };
      }
    | {
        ok: false;
        reason: string;
        warning: string;
      }
  > {
    const mimeType = this.normalizeReferenceImageMimeType(attachment.mimeType);
    if (mimeType === null) {
      return {
        ok: false,
        reason: "unsupported_reference_image_type",
        warning:
          "video_generate currently supports PNG, JPEG, and WebP reference images from the current or recent chat context."
      };
    }

    const buffer = await this.mediaObjectStorage.downloadObject(attachment.objectKey);
    if (buffer === null || buffer.length === 0) {
      return {
        ok: false,
        reason: "reference_image_unavailable",
        warning: "The selected reference image could not be loaded for video generation."
      };
    }

    return {
      ok: true,
      image: {
        bytesBase64: buffer.toString("base64"),
        mimeType,
        filename: attachment.filename
      }
    };
  }

  private async persistGeneratedArtifact(input: {
    assistantId: string;
    workspaceId: string;
    sessionId: string;
    requestId: string;
    filenameHint: string | null;
    requestPrompt: string;
    referenceFilename: string | null;
    video: {
      bytesBase64: string;
      mimeType: string;
    };
    billingFacts: RuntimeOutputArtifact["billingFacts"];
  }): Promise<RuntimeOutputArtifact> {
    if (!input.video.mimeType.startsWith("video/")) {
      throw new Error(`Video provider returned unsupported MIME type "${input.video.mimeType}".`);
    }
    const buffer = Buffer.from(input.video.bytesBase64, "base64");
    if (buffer.length === 0) {
      throw new Error("Video provider returned an empty video payload.");
    }

    const artifactId = randomUUID();
    const extension = this.extensionFromMimeType(input.video.mimeType);
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
      mimeType: input.video.mimeType
    });
    const filename = this.resolveFilename(input.filenameHint, input.referenceFilename, extension);
    const semanticSummary = buildGeneratedFileSemanticSummary({
      requestText: input.requestPrompt,
      allowWeakRequestFallback: true
    });
    const file = await this.runtimeAssistantFileRegistryService.ensureAttachmentBackedFile({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      origin: "runtime_output",
      referenceId: artifactId,
      objectKey: stored.objectKey,
      filename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      semanticSummary,
      semanticSummarySource: semanticSummary === null ? null : "generation_request"
    });
    const runtimeFileRef = this.runtimeAssistantFileRegistryService.toRuntimeFileRef(file);

    return {
      artifactId,
      fileRef: runtimeFileRef.fileRef,
      file: runtimeFileRef,
      kind: "video",
      sourceToolCode: VIDEO_GENERATE_TOOL_CODE,
      objectKey: stored.objectKey,
      mimeType: stored.mimeType,
      filename,
      sizeBytes: stored.sizeBytes,
      voiceNote: false,
      billingFacts: input.billingFacts ?? null
    };
  }

  private resolveWorkerTimeoutMs(bundle: AssistantRuntimeBundle): number {
    const configured =
      bundle.runtime.workerTools.tools.find((tool) => tool.toolCode === VIDEO_GENERATE_TOOL_CODE)
        ?.timeoutMs ?? null;
    return Number.isInteger(configured) && Number(configured) > 0
      ? Number(configured)
      : DEFAULT_VIDEO_GENERATE_TIMEOUT_MS;
  }

  private resolveAllowedWorkerToolPolicy(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
    if (
      policy === null ||
      policy.visibleToModel !== true ||
      policy.enabled !== true ||
      policy.usageRule !== "allowed" ||
      policy.executionMode !== "worker"
    ) {
      return null;
    }
    return policy;
  }

  private resolveConfiguredCredentialRef(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): AssistantRuntimeBundleToolCredentialRef | null {
    const credential = bundle.governance.toolCredentialRefs[toolCode] ?? null;
    if (credential === null || credential.configured !== true) {
      return null;
    }
    return credential;
  }

  private resolveVideoGenerateProviderId(
    providerId: string | null
  ): PersaiRuntimeVideoGenerateProviderId | null {
    const resolved = providerId ?? "openai";
    return PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS.includes(
      resolved as PersaiRuntimeVideoGenerateProviderId
    )
      ? (resolved as PersaiRuntimeVideoGenerateProviderId)
      : null;
  }

  private resolveVideoGenerateModelKey(
    credential: AssistantRuntimeBundleToolCredentialRef
  ): ProviderGatewayVideoGenerateRequest["model"] {
    return typeof credential.modelKey === "string" && credential.modelKey.trim().length > 0
      ? credential.modelKey.trim()
      : null;
  }

  private mergeWarnings(...warnings: Array<string | null | undefined>): string | null {
    const filtered = warnings.filter((warning): warning is string => typeof warning === "string");
    return filtered.length > 0 ? filtered.join(" ") : null;
  }

  private normalizeReferenceImageMimeType(mimeType: string): string | null {
    const normalized = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    return SUPPORTED_VIDEO_REFERENCE_IMAGE_MIME_TYPES.has(normalized) ? normalized : null;
  }

  private isVideoGenerateSize(value: string): value is PersaiRuntimeVideoGenerateSize {
    return PERSAI_RUNTIME_VIDEO_GENERATE_SIZES.includes(value as PersaiRuntimeVideoGenerateSize);
  }

  private resolveFilename(
    filenameHint: string | null,
    referenceFilename: string | null,
    extension: string
  ): string | null {
    const base =
      filenameHint?.trim() ??
      (referenceFilename
        ? `${referenceFilename.replace(/\.[A-Za-z0-9]+$/g, "").trim()}-video`
        : "");
    if (base.length === 0) {
      return `video.${extension}`;
    }
    const sanitizedBase = base.replace(/[\\/:*?"<>|]+/g, "_");
    const withoutExt = sanitizedBase.replace(/\.[A-Za-z0-9]+$/g, "").trim() || "video";
    return `${withoutExt}.${extension}`;
  }

  private extensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case "video/webm":
        return "webm";
      case "video/quicktime":
        return "mov";
      case "video/mp4":
      default:
        return "mp4";
    }
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private findAttachmentByAlias(
    attachments: RuntimeAttachmentRef[],
    alias: string
  ): RuntimeAttachmentRef | null {
    const normalized = this.normalizeAlias(alias);
    return (
      attachments.find((attachment) =>
        (attachment.aliases ?? []).some(
          (candidate) => this.normalizeAlias(candidate) === normalized
        )
      ) ?? null
    );
  }

  private resolvePrimaryAttachmentAlias(attachment: RuntimeAttachmentRef): string {
    return attachment.aliases?.[0] ?? attachment.filename ?? "reference image";
  }

  private normalizeAlias(value: string): string {
    return value.trim().toLowerCase();
  }
}
