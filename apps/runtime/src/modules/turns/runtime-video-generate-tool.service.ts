import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";

// Alias for use in private method signatures.
type BundleRef = AssistantRuntimeBundleToolCredentialRef;
import {
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  RUNTIME_VIDEO_AUDIO_MODES,
  RUNTIME_VIDEO_GENERATE_MODES,
  RUNTIME_VIDEO_INPUT_MODES,
  isTalkingAvatarVideoProvider,
  type RuntimeVideoAudioCapability,
  type RuntimeVideoAudioMode,
  type RuntimeVideoGenerateMode,
  type RuntimeVideoInputCapability,
  type RuntimeVideoInputMode,
  type PersaiRuntimeVideoGenerateProviderId,
  type PersaiRuntimeVideoGenerateSize,
  type ProviderGatewayToolCall,
  type ProviderGatewayVideoGenerateRequest,
  type RuntimeAcceptedVideoProviderTask,
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
// ADR-109 Slice 10c: separate credential key for talking-avatar path (E14 Fix #3).
const VIDEO_GENERATE_TALKING_AVATAR_TOOL_KEY = "video_generate_talking_avatar" as const;
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
      referenceTailImage: {
        bytesBase64: string;
        mimeType: string;
        filename: string | null;
      } | null;
      referenceImageAlias: string | null;
      referenceImageAliases: string[];
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

type ParsedAcceptedPrimaryUnconfirmed = {
  providerTaskId: string;
  provider: PersaiRuntimeVideoGenerateProviderId;
  model: string | null;
  acceptedAt: string;
  providerStage: "accepted";
  code: "accepted_primary_unconfirmed";
  reason: string;
  message: string;
  taskKind: string | null;
};

type NormalizedVideoExecutionRequest = {
  request: RuntimeVideoGenerateRequest & {
    seconds: number;
    size: PersaiRuntimeVideoGenerateSize;
    audioMode: RuntimeVideoAudioMode;
    inputMode: RuntimeVideoInputMode;
    referenceImageAliases: string[];
    voiceKeys: string[];
    voiceIds: string[];
  };
  warning: string | null;
};

type AdaptedVideoAttemptRequest = {
  request: NormalizedVideoExecutionRequest["request"];
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
          requestedAudioMode: null,
          requestedInputMode: null,
          ...this.buildRequestedTalkingAvatarEchoes(null),
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
          requestedAudioMode: request.audioMode ?? null,
          requestedInputMode: request.inputMode ?? null,
          ...this.buildRequestedTalkingAvatarEchoes(request),
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
          requestedAudioMode: request.audioMode ?? null,
          requestedInputMode: request.inputMode ?? null,
          ...this.buildRequestedTalkingAvatarEchoes(request),
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
          requestedAudioMode: request.audioMode ?? null,
          requestedInputMode: request.inputMode ?? null,
          ...this.buildRequestedTalkingAvatarEchoes(request),
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
          requestedAudioMode: request.audioMode ?? null,
          requestedInputMode: request.inputMode ?? null,
          ...this.buildRequestedTalkingAvatarEchoes(request),
          size: request.size,
          referenceImageAlias: request.referenceImageAlias,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "requested_mode_unsupported",
          warning: normalizedRequest.message
        },
        artifacts: [],
        isError: true
      };
    }
    // ADR-109 Slice 10c Fix #3e: talking_avatar uses a dedicated credential ref
    // (bundle.governance.toolCredentialRefs["video_generate_talking_avatar"]).
    // No silent fallback to cinematic credential — fail honestly with
    // talking_avatar_provider_unavailable if the ref is absent.
    if (request.mode === "talking_avatar") {
      const talkingAvatarRef =
        params.bundle.governance.toolCredentialRefs[VIDEO_GENERATE_TALKING_AVATAR_TOOL_KEY] ?? null;
      if (talkingAvatarRef === null || talkingAvatarRef.configured === false) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: null,
            model: null,
            prompt: request.prompt,
            requestedSeconds: request.seconds,
            requestedAudioMode: request.audioMode ?? null,
            requestedInputMode: request.inputMode ?? null,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "talking_avatar_provider_unavailable",
            warning:
              "talking_avatar mode requires a HeyGen talking-avatar credential. Configure 'Talking Avatar Model' in the plan editor and ensure the HeyGen API key is set."
          },
          artifacts: [],
          isError: true
        };
      }
      const talkingAvatarProviderId = this.resolveVideoGenerateProviderId(
        talkingAvatarRef.providerId ?? null
      );
      if (talkingAvatarProviderId === null) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: null,
            model: null,
            prompt: request.prompt,
            requestedSeconds: request.seconds,
            requestedAudioMode: request.audioMode ?? null,
            requestedInputMode: request.inputMode ?? null,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "talking_avatar_provider_unavailable",
            warning:
              "talking_avatar mode requires a HeyGen talking-avatar credential. Configure 'Talking Avatar Model' in the plan editor and ensure the HeyGen API key is set."
          },
          artifacts: [],
          isError: true
        };
      }
      const talkingAvatarNormalized = this.normalizeExecutionRequest(
        request,
        talkingAvatarRef.videoModelParameters ?? null
      );
      if (talkingAvatarNormalized instanceof Error) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: talkingAvatarProviderId,
            model: this.resolveVideoGenerateModelKey(talkingAvatarRef),
            prompt: request.prompt,
            requestedSeconds: request.seconds,
            requestedAudioMode: request.audioMode ?? null,
            requestedInputMode: request.inputMode ?? null,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "requested_mode_unsupported",
            warning: talkingAvatarNormalized.message
          },
          artifacts: [],
          isError: true
        };
      }
      return await this.executeTalkingAvatarDispatch({
        bundle: params.bundle,
        request: request as RuntimeVideoGenerateRequest & {
          mode: "talking_avatar";
          speechText: string;
          speechLanguage: string;
        },
        normalizedRequest: talkingAvatarNormalized,
        credential: talkingAvatarRef,
        providerId: talkingAvatarProviderId,
        model: this.resolveVideoGenerateModelKey(talkingAvatarRef),
        availableAttachments: params.availableAttachments,
        sessionId: params.sessionId,
        requestId: params.requestId
      });
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
      normalizedRequest.request
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
          requestedAudioMode: normalizedRequest.request.audioMode,
          requestedInputMode: normalizedRequest.request.inputMode,
          ...this.buildRequestedTalkingAvatarEchoes(request),
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

    const primaryPathSupportError = this.validateCurrentProviderPathSupport({
      providerId,
      videoModelParameters: credential.videoModelParameters,
      request: normalizedRequest.request
    });
    if (primaryPathSupportError !== null) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: primaryModel,
          prompt: request.prompt,
          requestedSeconds: normalizedRequest.request.seconds,
          requestedAudioMode: normalizedRequest.request.audioMode,
          requestedInputMode: normalizedRequest.request.inputMode,
          ...this.buildRequestedTalkingAvatarEchoes(request),
          size: normalizedRequest.request.size,
          referenceImageAlias: selection.referenceImageAlias,
          referenceFilename: selection.referenceFilename,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "requested_mode_unsupported",
          warning: primaryPathSupportError.message
        },
        artifacts: [],
        isError: true
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
              requestedAudioMode: normalizedRequest.request.audioMode,
              requestedInputMode: normalizedRequest.request.inputMode,
              ...this.buildRequestedTalkingAvatarEchoes(request),
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
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
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
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
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
      let attemptNormalizedRequest: NormalizedVideoExecutionRequest | null = null;
      try {
        const normalizedAttempt = this.normalizeExecutionRequest(
          request,
          attempt.credential.videoModelParameters
        );
        if (normalizedAttempt instanceof Error) {
          if (attemptIndex === 0) {
            throw normalizedAttempt;
          }
          const adaptedAttempt = this.adaptRequestForFallbackAttempt({
            baseRequest: normalizedRequest.request,
            fallbackModelParameters: attempt.credential.videoModelParameters
          });
          if (adaptedAttempt instanceof Error) {
            throw normalizedAttempt;
          }
          attemptNormalizedRequest = {
            request: adaptedAttempt.request,
            warning: adaptedAttempt.warning
          };
        } else {
          attemptNormalizedRequest =
            attemptIndex === 0
              ? normalizedAttempt
              : {
                  ...normalizedAttempt,
                  warning: this.mergeWarnings(
                    normalizedAttempt.warning,
                    this.describeFallbackAdaptation(
                      normalizedRequest.request,
                      normalizedAttempt.request
                    )
                  )
                };
        }
        const resolvedVoiceIds = this.resolveVoiceIdsForAttempt(
          attemptNormalizedRequest.request,
          attempt.credential
        );
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
            referenceImage:
              attemptNormalizedRequest.request.inputMode === "text"
                ? null
                : selection.referenceImage,
            providerParameters: this.resolveProviderVideoParameters({
              providerId: attempt.providerId,
              audioMode: attemptNormalizedRequest.request.audioMode,
              inputMode: attemptNormalizedRequest.request.inputMode,
              videoModelParameters: attempt.credential.videoModelParameters,
              providerParameters:
                attempt.credential.videoModelParameters?.providerParameters ?? null
            }),
            referenceTailImage:
              attemptNormalizedRequest.request.inputMode === "multi_image"
                ? selection.referenceTailImage
                : null,
            voiceIds: resolvedVoiceIds.length > 0 ? resolvedVoiceIds : null,
            acceptedTask: this.readAcceptedTaskHint(request, attempt),
            credential: {
              toolCode: VIDEO_GENERATE_TOOL_CODE,
              secretId: attempt.credential.secretRef.id,
              providerId: attempt.providerId
            },
            ...this.buildGatewayTalkingAvatarFields(attemptNormalizedRequest.request)
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
            requestedAudioMode: attemptNormalizedRequest.request.audioMode,
            requestedInputMode: attemptNormalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
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
        const acceptedPrimaryUnconfirmed = this.parseAcceptedPrimaryUnconfirmed(error, attempt);
        const shouldTryFallback =
          attemptIndex < credentialAttempts.length - 1 &&
          this.isFallbackEligibleVideoFailure(error) &&
          acceptedPrimaryUnconfirmed === null;
        const fallbackReason =
          acceptedPrimaryUnconfirmed !== null
            ? "forbidden_accepted_primary_unconfirmed"
            : shouldTryFallback
              ? "allowed_terminal_or_eligible"
              : "forbidden_failure_not_eligible";
        this.logger.warn(
          `[video-generate] attempt failed requestId=${params.requestId} provider=${
            attempt.providerId
          } model=${attempt.model ?? "default"} seconds=${String(
            attemptNormalizedRequest?.request.seconds ?? normalizedRequest.request.seconds
          )} fallback=${String(shouldTryFallback)} referenceAlias="${
            selection.referenceImageAlias ?? "none"
          }" fallbackReason=${fallbackReason}: ${failureMessage}`
        );
        if (acceptedPrimaryUnconfirmed !== null) {
          const recoveryMarker = `PERSAI_VIDEO_ACCEPTED_PRIMARY_UNCONFIRMED::${JSON.stringify(acceptedPrimaryUnconfirmed)}`;
          this.logger.warn(
            `[video-generate] recovery started requestId=${params.requestId} provider=${attempt.providerId} providerTaskId=${acceptedPrimaryUnconfirmed.providerTaskId} acceptedAt=${acceptedPrimaryUnconfirmed.acceptedAt}`
          );
          return {
            payload: {
              toolCode: VIDEO_GENERATE_TOOL_CODE,
              executionMode: "worker",
              provider: attempt.providerId,
              model: acceptedPrimaryUnconfirmed.model ?? attempt.model,
              prompt: request.prompt,
              requestedSeconds:
                attemptNormalizedRequest?.request.seconds ?? normalizedRequest.request.seconds,
              requestedAudioMode:
                attemptNormalizedRequest?.request.audioMode ?? normalizedRequest.request.audioMode,
              requestedInputMode:
                attemptNormalizedRequest?.request.inputMode ?? normalizedRequest.request.inputMode,
              ...this.buildRequestedTalkingAvatarEchoes(request),
              size: attemptNormalizedRequest?.request.size ?? normalizedRequest.request.size,
              referenceImageAlias: selection.referenceImageAlias,
              referenceFilename: selection.referenceFilename,
              artifact: null,
              usage: null,
              action: "skipped",
              reason: "accepted_primary_unconfirmed",
              warning: `Provider accepted the video task, but polling continuity was lost. Fallback is forbidden until provider terminal status is confirmed. ${recoveryMarker}`,
              providerStatus: acceptedPrimaryUnconfirmed
            },
            artifacts: [],
            isError: true
          };
        }
        if (shouldTryFallback) {
          warnings.push(attemptWarning);
          continue;
        }
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: attempt.providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds:
              attemptNormalizedRequest?.request.seconds ?? normalizedRequest.request.seconds,
            requestedAudioMode:
              attemptNormalizedRequest?.request.audioMode ?? normalizedRequest.request.audioMode,
            requestedInputMode:
              attemptNormalizedRequest?.request.inputMode ?? normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: attemptNormalizedRequest?.request.size ?? normalizedRequest.request.size,
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
        requestedAudioMode: normalizedRequest.request.audioMode,
        requestedInputMode: normalizedRequest.request.inputMode,
        ...this.buildRequestedTalkingAvatarEchoes(request),
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

  private parseAcceptedPrimaryUnconfirmed(
    error: unknown,
    attempt: ResolvedVideoCredentialAttempt
  ): ParsedAcceptedPrimaryUnconfirmed | null {
    if (!(error instanceof BadRequestException || error instanceof ServiceUnavailableException)) {
      return null;
    }
    const payload = error.getResponse() as {
      error?: { code?: string; providerStatus?: unknown; message?: string };
    };
    if (payload?.error?.code !== "accepted_primary_unconfirmed") {
      return null;
    }
    const providerStatus =
      payload.error?.providerStatus !== null &&
      typeof payload.error?.providerStatus === "object" &&
      !Array.isArray(payload.error?.providerStatus)
        ? (payload.error.providerStatus as Record<string, unknown>)
        : null;
    if (providerStatus === null) {
      return null;
    }
    const providerTaskId =
      typeof providerStatus.providerTaskId === "string" && providerStatus.providerTaskId.length > 0
        ? providerStatus.providerTaskId
        : null;
    if (providerTaskId === null) {
      return null;
    }
    const providerFromStatus =
      providerStatus.provider === "openai" ||
      providerStatus.provider === "runway" ||
      providerStatus.provider === "kling"
        ? (providerStatus.provider as PersaiRuntimeVideoGenerateProviderId)
        : attempt.providerId;
    return {
      providerTaskId,
      provider: providerFromStatus,
      model:
        typeof providerStatus.model === "string" && providerStatus.model.trim().length > 0
          ? providerStatus.model.trim()
          : attempt.model,
      acceptedAt:
        typeof providerStatus.acceptedAt === "string" && providerStatus.acceptedAt.length > 0
          ? providerStatus.acceptedAt
          : new Date().toISOString(),
      providerStage: "accepted",
      code: "accepted_primary_unconfirmed",
      reason:
        typeof providerStatus.reason === "string" && providerStatus.reason.length > 0
          ? providerStatus.reason
          : "provider accepted but polling transport lost",
      message:
        typeof providerStatus.message === "string" && providerStatus.message.length > 0
          ? providerStatus.message
          : (payload.error?.message ?? "Polling continuity lost after provider acceptance."),
      taskKind:
        typeof providerStatus.taskKind === "string" && providerStatus.taskKind.length > 0
          ? providerStatus.taskKind
          : null
    };
  }

  private readAcceptedTaskHint(
    request: RuntimeVideoGenerateRequest,
    attempt: ResolvedVideoCredentialAttempt
  ): RuntimeAcceptedVideoProviderTask | null {
    const acceptedTask = request.acceptedProviderTask ?? null;
    if (
      acceptedTask === null ||
      acceptedTask.provider !== attempt.providerId ||
      acceptedTask.providerStage !== "accepted" ||
      typeof acceptedTask.providerTaskId !== "string" ||
      acceptedTask.providerTaskId.trim().length === 0
    ) {
      return null;
    }
    return {
      provider: acceptedTask.provider,
      model: acceptedTask.model ?? attempt.model ?? null,
      providerTaskId: acceptedTask.providerTaskId.trim(),
      acceptedAt: acceptedTask.acceptedAt ?? new Date().toISOString(),
      providerStage: "accepted",
      taskKind: acceptedTask.taskKind ?? null
    };
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
        key !== "audioMode" &&
        key !== "inputMode" &&
        key !== "referenceImageAlias" &&
        key !== "referenceImageAliases" &&
        key !== "voiceIds" &&
        key !== "voiceKeys" &&
        // ADR-109 Slice 3: talking-avatar fields.
        key !== "mode" &&
        key !== "speechText" &&
        key !== "speechLanguage" &&
        key !== "personaId" &&
        key !== "portraitImageAlias" &&
        key !== "voiceKey"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    if ("toolCode" in args && args.toolCode !== VIDEO_GENERATE_TOOL_CODE) {
      return new Error(`toolCode must be ${VIDEO_GENERATE_TOOL_CODE}`);
    }

    // Parse mode first so the prompt requirement can depend on it (Fix #3 / E14).
    // ADR-109 Slice 3: talking-avatar fields. Defensive structural parsing.
    // No regex / string-matching / message-body parsing (invariant #15).
    const modeEarly =
      args.mode === undefined || args.mode === null
        ? null
        : typeof args.mode === "string" &&
            (RUNTIME_VIDEO_GENERATE_MODES as readonly string[]).includes(args.mode)
          ? (args.mode as RuntimeVideoGenerateMode)
          : null;
    if ("mode" in args && args.mode !== null && modeEarly === null) {
      return new Error(
        `mode must be one of ${RUNTIME_VIDEO_GENERATE_MODES.join(", ")} when provided`
      );
    }

    // prompt is REQUIRED for cinematic (mode absent or "cinematic"); OPTIONAL for talking_avatar.
    // When talking_avatar omits prompt, synthesize a structural placeholder for observability.
    const promptRaw = this.asNonEmptyString(args.prompt);
    let prompt: string;
    if (modeEarly === "talking_avatar") {
      prompt = promptRaw ?? "Talking-avatar render";
    } else {
      if (promptRaw === null) {
        return new Error("prompt must be a non-empty string");
      }
      prompt = promptRaw;
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

    const audioMode =
      args.audioMode === undefined || args.audioMode === null
        ? null
        : typeof args.audioMode === "string" &&
            RUNTIME_VIDEO_AUDIO_MODES.includes(args.audioMode as RuntimeVideoAudioMode)
          ? (args.audioMode as RuntimeVideoAudioMode)
          : null;
    if ("audioMode" in args && args.audioMode !== null && audioMode === null) {
      return new Error(
        `audioMode must be one of ${RUNTIME_VIDEO_AUDIO_MODES.join(", ")} when provided`
      );
    }

    const inputMode =
      args.inputMode === undefined || args.inputMode === null
        ? null
        : typeof args.inputMode === "string" &&
            RUNTIME_VIDEO_INPUT_MODES.includes(args.inputMode as RuntimeVideoInputMode)
          ? (args.inputMode as RuntimeVideoInputMode)
          : null;
    if ("inputMode" in args && args.inputMode !== null && inputMode === null) {
      return new Error(
        `inputMode must be one of ${RUNTIME_VIDEO_INPUT_MODES.join(", ")} when provided`
      );
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

    const referenceImageAliases =
      args.referenceImageAliases === undefined || args.referenceImageAliases === null
        ? null
        : Array.isArray(args.referenceImageAliases)
          ? args.referenceImageAliases
          : null;
    if ("referenceImageAliases" in args && args.referenceImageAliases !== null) {
      if (referenceImageAliases === null || referenceImageAliases.length === 0) {
        return new Error("referenceImageAliases must be a non-empty array when provided");
      }
      for (const [index, entry] of referenceImageAliases.entries()) {
        if (this.asNonEmptyString(entry) === null) {
          return new Error(
            `referenceImageAliases[${String(index)}] must be a non-empty string when provided`
          );
        }
      }
    }

    const voiceIds =
      args.voiceIds === undefined || args.voiceIds === null
        ? null
        : Array.isArray(args.voiceIds)
          ? args.voiceIds
          : null;
    if ("voiceIds" in args && args.voiceIds !== null) {
      if (voiceIds === null || voiceIds.length === 0) {
        return new Error("voiceIds must be a non-empty array when provided");
      }
      for (const [index, entry] of voiceIds.entries()) {
        if (this.asNonEmptyString(entry) === null) {
          return new Error(`voiceIds[${String(index)}] must be a non-empty string when provided`);
        }
      }
    }

    const voiceKeys =
      args.voiceKeys === undefined || args.voiceKeys === null
        ? null
        : Array.isArray(args.voiceKeys)
          ? args.voiceKeys
          : null;
    if ("voiceKeys" in args && args.voiceKeys !== null) {
      if (voiceKeys === null || voiceKeys.length === 0) {
        return new Error("voiceKeys must be a non-empty array when provided");
      }
      for (const [index, entry] of voiceKeys.entries()) {
        if (this.asNonEmptyString(entry) === null) {
          return new Error(`voiceKeys[${String(index)}] must be a non-empty string when provided`);
        }
      }
    }

    // mode was already parsed above as modeEarly; alias it here for the rest of the function.
    const mode = modeEarly;

    const speechText =
      args.speechText === undefined || args.speechText === null
        ? null
        : this.asNonEmptyString(args.speechText);
    if ("speechText" in args && args.speechText !== null && speechText === null) {
      return new Error("speechText must be a non-empty string when provided");
    }

    const speechLanguage =
      args.speechLanguage === undefined || args.speechLanguage === null
        ? null
        : this.asNonEmptyString(args.speechLanguage);
    if ("speechLanguage" in args && args.speechLanguage !== null && speechLanguage === null) {
      return new Error("speechLanguage must be a non-empty string when provided");
    }

    const personaId =
      args.personaId === undefined || args.personaId === null
        ? null
        : this.asNonEmptyString(args.personaId);
    if ("personaId" in args && args.personaId !== null && personaId === null) {
      return new Error("personaId must be a non-empty string when provided");
    }

    const portraitImageAlias =
      args.portraitImageAlias === undefined || args.portraitImageAlias === null
        ? null
        : this.asNonEmptyString(args.portraitImageAlias);
    if (
      "portraitImageAlias" in args &&
      args.portraitImageAlias !== null &&
      portraitImageAlias === null
    ) {
      return new Error("portraitImageAlias must be a non-empty string when provided");
    }

    const voiceKey =
      args.voiceKey === undefined || args.voiceKey === null
        ? null
        : this.asNonEmptyString(args.voiceKey);
    if ("voiceKey" in args && args.voiceKey !== null && voiceKey === null) {
      return new Error("voiceKey must be a non-empty string when provided");
    }

    // Talking-avatar mode: structural requirements.
    // - speechText: required, non-empty
    // - speechLanguage: required, non-empty
    // - exactly one of (personaId, portraitImageAlias)
    // For mode === "cinematic" or mode absent/null we silently ignore the new
    // fields. (No multi-character refusal in code; that constraint lives in the
    // LLM-facing tool description — Slice 10 work.)
    if (mode === "talking_avatar") {
      if (speechText === null) {
        return new Error("speechText is required when mode is talking_avatar");
      }
      if (speechLanguage === null) {
        return new Error("speechLanguage is required when mode is talking_avatar");
      }
      const hasPersonaId = personaId !== null;
      const hasPortrait = portraitImageAlias !== null;
      if (hasPersonaId === hasPortrait) {
        return new Error(
          "Exactly one of personaId or portraitImageAlias is required when mode is talking_avatar"
        );
      }
    }

    return {
      toolCode: VIDEO_GENERATE_TOOL_CODE,
      prompt,
      filename,
      size,
      seconds,
      audioMode,
      inputMode,
      referenceImageAlias,
      referenceImageAliases:
        referenceImageAliases?.map((entry) => this.asNonEmptyString(entry)!).filter(Boolean) ??
        null,
      voiceKeys: voiceKeys?.map((entry) => this.asNonEmptyString(entry)!).filter(Boolean) ?? null,
      voiceIds: voiceIds?.map((entry) => this.asNonEmptyString(entry)!).filter(Boolean) ?? null,
      mode,
      speechText,
      speechLanguage,
      personaId,
      portraitImageAlias,
      voiceKey
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
    const normalizedReferenceImageAliases = this.normalizeReferenceImageAliases(request);
    const normalizedAudioMode = this.normalizeAudioMode(request.audioMode);
    const normalizedInputMode = this.normalizeInputMode(request, normalizedReferenceImageAliases);
    const normalizedVoiceKeys = this.normalizeVoiceKeys(request.voiceKeys);
    const normalizedVoiceIds = this.normalizeVoiceIds(request.voiceIds);
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
    const capabilityError = this.validateRequestedCapabilities({
      audioMode: normalizedAudioMode,
      inputMode: normalizedInputMode,
      audioCapabilities: params.audioCapabilities,
      inputCapabilities: params.inputCapabilities
    });
    if (capabilityError !== null) {
      return capabilityError;
    }
    return {
      request: {
        ...request,
        seconds: normalizedSeconds,
        size: normalizedSize,
        audioMode: normalizedAudioMode,
        inputMode: normalizedInputMode,
        referenceImageAliases: normalizedReferenceImageAliases,
        voiceKeys: normalizedVoiceKeys,
        voiceIds: normalizedVoiceIds
      },
      warning: warnings.length > 0 ? warnings.join(" ") : null
    };
  }

  private normalizeAudioMode(
    requestedMode: RuntimeVideoGenerateRequest["audioMode"]
  ): RuntimeVideoAudioMode {
    return requestedMode ?? "silent";
  }

  private normalizeInputMode(
    request: RuntimeVideoGenerateRequest,
    normalizedReferenceImageAliases: string[]
  ): RuntimeVideoInputMode {
    if (request.inputMode !== null && request.inputMode !== undefined) {
      return request.inputMode;
    }
    const aliasCount = normalizedReferenceImageAliases.length;
    if (aliasCount > 1) {
      return "multi_image";
    }
    if (aliasCount === 1) {
      return "single_reference_image";
    }
    return "text";
  }

  private normalizeReferenceImageAliases(request: RuntimeVideoGenerateRequest): string[] {
    const aliases = new Set<string>();
    if (request.referenceImageAlias !== null) {
      aliases.add(request.referenceImageAlias);
    }
    for (const alias of request.referenceImageAliases ?? []) {
      aliases.add(alias);
    }
    return Array.from(aliases);
  }

  private normalizeVoiceIds(voiceIds: RuntimeVideoGenerateRequest["voiceIds"]): string[] {
    const ids = new Set<string>();
    for (const voiceId of voiceIds ?? []) {
      const normalized = this.asNonEmptyString(voiceId);
      if (normalized !== null) {
        ids.add(normalized);
      }
    }
    return Array.from(ids);
  }

  private normalizeVoiceKeys(voiceKeys: RuntimeVideoGenerateRequest["voiceKeys"]): string[] {
    const keys = new Set<string>();
    for (const voiceKey of voiceKeys ?? []) {
      const normalized = this.asNonEmptyString(voiceKey);
      if (normalized !== null) {
        keys.add(normalized);
      }
    }
    return Array.from(keys);
  }

  private validateRequestedCapabilities(params: {
    audioMode: RuntimeVideoAudioMode;
    inputMode: RuntimeVideoInputMode;
    audioCapabilities: RuntimeVideoAudioCapability[];
    inputCapabilities: RuntimeVideoInputCapability[];
  }): Error | null {
    const audioCapabilities = new Set(params.audioCapabilities);
    const inputCapabilities = new Set(params.inputCapabilities);
    if (!audioCapabilities.has(params.audioMode)) {
      return new Error(this.buildUnsupportedAudioModeMessage(params.audioMode));
    }
    if (params.inputMode === "omni") {
      return new Error(
        "Omni video requests are deferred and unsupported on the current PersAI runtime path."
      );
    }
    if (!inputCapabilities.has(params.inputMode)) {
      return new Error(this.buildUnsupportedInputModeMessage(params.inputMode));
    }
    return null;
  }

  private adaptRequestForFallbackAttempt(params: {
    baseRequest: NormalizedVideoExecutionRequest["request"];
    fallbackModelParameters: RuntimeVideoModelParameters | null | undefined;
  }): AdaptedVideoAttemptRequest | Error {
    const modelParameters = params.fallbackModelParameters;
    if (modelParameters === null || modelParameters === undefined) {
      return new Error(
        "Fallback video model is missing structured video parameters in the materialized catalog."
      );
    }
    const audioCapabilities = new Set(modelParameters.audioCapabilities ?? ["silent"]);
    const inputCapabilities = new Set(
      modelParameters.inputCapabilities ??
        (modelParameters.referenceImageSupported === true
          ? ["text", "single_reference_image"]
          : ["text"])
    );
    const warnings: string[] = [];
    let audioMode = params.baseRequest.audioMode;
    let inputMode = params.baseRequest.inputMode;
    let referenceImageAliases = params.baseRequest.referenceImageAliases;
    let voiceKeys = params.baseRequest.voiceKeys;
    let voiceIds = params.baseRequest.voiceIds;

    if (!audioCapabilities.has(audioMode)) {
      if (!audioCapabilities.has("silent")) {
        return new Error(this.buildUnsupportedAudioModeMessage(audioMode));
      }
      warnings.push(
        `Fallback video model does not support ${audioMode}; continuing with silent video.`
      );
      audioMode = "silent";
      voiceKeys = [];
      voiceIds = [];
    }

    if (!inputCapabilities.has(inputMode)) {
      if (
        inputMode === "multi_image" &&
        referenceImageAliases.length > 0 &&
        inputCapabilities.has("single_reference_image")
      ) {
        warnings.push(
          "Fallback video model does not support multi-image input; using the first reference image."
        );
        inputMode = "single_reference_image";
        referenceImageAliases = referenceImageAliases.slice(0, 1);
      } else if (inputCapabilities.has("text")) {
        warnings.push(
          `Fallback video model does not support ${inputMode}; continuing with text-only video.`
        );
        inputMode = "text";
        referenceImageAliases = [];
      } else {
        return new Error(this.buildUnsupportedInputModeMessage(inputMode));
      }
    }

    return {
      request: {
        ...params.baseRequest,
        audioMode,
        inputMode,
        referenceImageAlias: referenceImageAliases[0] ?? null,
        referenceImageAliases,
        voiceKeys,
        voiceIds
      },
      warning: warnings.length > 0 ? warnings.join(" ") : null
    };
  }

  private describeFallbackAdaptation(
    primaryRequest: NormalizedVideoExecutionRequest["request"],
    fallbackRequest: NormalizedVideoExecutionRequest["request"]
  ): string | null {
    const warnings: string[] = [];
    if (primaryRequest.audioMode !== fallbackRequest.audioMode) {
      warnings.push(
        `Fallback video model uses ${fallbackRequest.audioMode} instead of ${primaryRequest.audioMode}.`
      );
    }
    if (primaryRequest.inputMode !== fallbackRequest.inputMode) {
      warnings.push(
        `Fallback video model uses ${fallbackRequest.inputMode} instead of ${primaryRequest.inputMode}.`
      );
    }
    return warnings.length > 0 ? warnings.join(" ") : null;
  }

  private buildUnsupportedAudioModeMessage(mode: RuntimeVideoAudioMode): string {
    switch (mode) {
      case "provider_native_audio":
        return "The selected video model does not support provider-native audio, so this request cannot be run honestly as an audio-capable video.";
      case "voice_control":
        return "The selected video model does not support provider-side voice control, so this request cannot be run honestly as spoken or narrated video.";
      case "silent":
      default:
        return "The selected video model does not support the requested audio mode.";
    }
  }

  private buildUnsupportedInputModeMessage(mode: RuntimeVideoInputMode): string {
    switch (mode) {
      case "single_reference_image":
        return "The selected video model does not support reference-image video input.";
      case "multi_image":
        return "The selected video model does not support multi-image video input, so this request cannot be downgraded to single-image video without explanation.";
      case "omni":
        return "Omni video requests are deferred and unsupported on the current PersAI runtime path.";
      case "text":
      default:
        return "The selected video model does not support the requested input mode.";
    }
  }

  private validateCurrentProviderPathSupport(params: {
    providerId: PersaiRuntimeVideoGenerateProviderId;
    videoModelParameters: RuntimeVideoModelParameters | null | undefined;
    request: NormalizedVideoExecutionRequest["request"];
  }): Error | null {
    if (
      params.request.audioMode === "provider_native_audio" &&
      params.providerId !== "kling" &&
      params.providerId !== "runway"
    ) {
      return new Error(
        "Provider-native audio is only verified on the current Kling standard video path in this slice; the selected provider cannot satisfy this request honestly."
      );
    }
    if (params.request.audioMode === "provider_native_audio" && params.providerId === "runway") {
      const audioCapabilities = new Set(params.videoModelParameters?.audioCapabilities ?? []);
      if (!audioCapabilities.has("provider_native_audio")) {
        return new Error(
          "The selected Runway model does not advertise provider-native audio in the active model catalog."
        );
      }
    }
    if (params.request.audioMode === "voice_control") {
      if (params.providerId !== "kling") {
        return new Error(
          "Provider-side voice control is only wired on the current Kling image-to-video path in this slice; the selected provider cannot satisfy this request honestly."
        );
      }
      if (
        params.request.inputMode !== "text" &&
        params.request.inputMode !== "single_reference_image" &&
        params.request.inputMode !== "multi_image"
      ) {
        return new Error(
          "Provider-side voice control is only wired on the current Kling text/image video paths in this slice."
        );
      }
      if (params.request.voiceIds.length === 0 && params.request.voiceKeys.length === 0) {
        return new Error(
          "Voice-controlled Kling video requires explicit voiceKeys from the materialized shortlist or explicit low-level voiceIds so the documented voice_list can be sent honestly."
        );
      }
      const selectedVoiceCount =
        params.request.voiceIds.length > 0
          ? params.request.voiceIds.length
          : params.request.voiceKeys.length;
      if (selectedVoiceCount > 2) {
        return new Error(
          "The current Kling image-to-video voice-control path supports at most 2 explicit voices per request."
        );
      }
    }
    return null;
  }

  private resolveProviderVideoParameters(params: {
    providerId: PersaiRuntimeVideoGenerateProviderId;
    audioMode: RuntimeVideoAudioMode;
    inputMode: RuntimeVideoInputMode;
    videoModelParameters: RuntimeVideoModelParameters | null | undefined;
    providerParameters: RuntimeVideoModelParameters["providerParameters"] | null;
  }): RuntimeVideoModelParameters["providerParameters"] | null {
    if (params.providerId === "kling") {
      return {
        ...(params.providerParameters ?? {}),
        sound: params.audioMode === "provider_native_audio" ? "on" : "off"
      };
    }
    if (
      params.providerId === "runway" &&
      new Set(params.videoModelParameters?.audioCapabilities ?? []).has("provider_native_audio")
    ) {
      return {
        ...(params.providerParameters ?? {}),
        audio: params.audioMode === "provider_native_audio"
      };
    }
    return params.providerParameters ?? null;
  }

  private resolveVoiceIdsForAttempt(
    request: NormalizedVideoExecutionRequest["request"],
    credential: AssistantRuntimeBundleToolCredentialRef
  ): string[] {
    if (request.voiceIds.length > 0) {
      return request.voiceIds;
    }
    if (request.voiceKeys.length === 0) {
      return [];
    }
    const catalog = credential.videoVoiceCatalog;
    if (catalog === null || catalog === undefined) {
      return [];
    }
    const byKey = new Map(
      catalog.shortlist.map(
        (entry) => [entry.voiceKey.toLowerCase(), entry.providerVoiceId] as const
      )
    );
    const resolved: string[] = [];
    for (const voiceKey of request.voiceKeys) {
      const providerVoiceId = byKey.get(voiceKey.toLowerCase());
      if (providerVoiceId !== undefined) {
        resolved.push(providerVoiceId);
      }
    }
    return Array.from(new Set(resolved));
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
    const referenceImageAliases = request.referenceImageAliases ?? [];
    const referenceImageAlias = request.referenceImageAlias ?? referenceImageAliases[0] ?? null;
    if ((request.inputMode ?? null) === "omni") {
      return {
        ok: false,
        reason: "omni_unsupported",
        warning:
          "Omni video requests are deferred and unsupported on the current PersAI runtime path."
      };
    }
    if (referenceImageAlias === null) {
      return {
        ok: true,
        referenceImage: null,
        referenceTailImage: null,
        referenceImageAlias: null,
        referenceImageAliases: [],
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

    const resolvedAttachments = this.resolveReferenceImageAttachments({
      imageAttachments,
      referenceImageAlias,
      referenceImageAliases,
      inputMode: request.inputMode ?? null
    });
    if (resolvedAttachments instanceof Error) {
      return {
        ok: false,
        reason:
          (request.inputMode ?? null) === "multi_image"
            ? "multi_image_unsupported"
            : "reference_image_alias_invalid",
        warning: resolvedAttachments.message
      };
    }

    const loadedReference = await this.loadReferenceImage(resolvedAttachments.primary);
    if (!loadedReference.ok) {
      return loadedReference;
    }
    const loadedTailReference =
      resolvedAttachments.tail === null
        ? null
        : await this.loadReferenceImage(resolvedAttachments.tail);
    if (loadedTailReference !== null && !loadedTailReference.ok) {
      return loadedTailReference;
    }

    return {
      ok: true,
      referenceImage: loadedReference.image,
      referenceTailImage: loadedTailReference?.image ?? null,
      referenceImageAlias: this.resolvePrimaryAttachmentAlias(resolvedAttachments.primary),
      referenceImageAliases: resolvedAttachments.aliases,
      referenceFilename: resolvedAttachments.primary.filename
    };
  }

  private resolveReferenceImageAttachments(params: {
    imageAttachments: RuntimeAttachmentRef[];
    referenceImageAlias: string;
    referenceImageAliases: string[];
    inputMode: RuntimeVideoGenerateRequest["inputMode"];
  }):
    | {
        primary: RuntimeAttachmentRef;
        tail: RuntimeAttachmentRef | null;
        aliases: string[];
      }
    | Error {
    const orderedAliases =
      params.referenceImageAliases.length > 0
        ? params.referenceImageAliases
        : [params.referenceImageAlias];
    const uniqueAliases = Array.from(
      new Set(
        orderedAliases
          .map((alias) => this.normalizeAlias(alias))
          .filter((alias) => alias.length > 0)
      )
    );
    const resolvedAttachments = uniqueAliases
      .map((alias) =>
        params.imageAttachments.find((attachment) =>
          (attachment.aliases ?? []).some((candidate) => this.normalizeAlias(candidate) === alias)
        )
      )
      .filter((attachment): attachment is RuntimeAttachmentRef => attachment !== undefined);

    if (resolvedAttachments.length !== uniqueAliases.length) {
      return new Error(
        "referenceImageAlias/referenceImageAliases must match available reusable image aliases in the working-files context."
      );
    }
    if ((params.inputMode ?? null) !== "multi_image") {
      return {
        primary: resolvedAttachments[0]!,
        tail: null,
        aliases: [this.resolvePrimaryAttachmentAlias(resolvedAttachments[0]!)]
      };
    }
    if (resolvedAttachments.length !== 2) {
      return new Error(
        "The current PersAI multi-image Kling path only supports exactly 2 ordered image aliases so they can map honestly to image + image_tail."
      );
    }
    return {
      primary: resolvedAttachments[0]!,
      tail: resolvedAttachments[1]!,
      aliases: resolvedAttachments.map((attachment) =>
        this.resolvePrimaryAttachmentAlias(attachment)
      )
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

  // ADR-109 Slice 7: talking_avatar execution path. Persona + portrait-alias
  // resolution, voice validation, gateway dispatch — no fallback providers and
  // no writes to workspace_video_personas (invariant #14).
  private async executeTalkingAvatarDispatch(params: {
    bundle: AssistantRuntimeBundle;
    request: RuntimeVideoGenerateRequest & {
      mode: "talking_avatar";
      speechText: string;
      speechLanguage: string;
    };
    normalizedRequest: NormalizedVideoExecutionRequest;
    credential: BundleRef;
    providerId: PersaiRuntimeVideoGenerateProviderId;
    model: ProviderGatewayVideoGenerateRequest["model"];
    availableAttachments: RuntimeAttachmentRef[];
    sessionId: string;
    requestId: string;
  }): Promise<RuntimeVideoGenerateToolExecutionResult> {
    const {
      bundle,
      request,
      normalizedRequest,
      credential,
      providerId,
      model,
      availableAttachments,
      sessionId,
      requestId
    } = params;

    // ── 1. HeyGen provider check ─────────────────────────────────────────────
    // talking_avatar is HeyGen-only; no fallback to Kling/Runway/OpenAI.
    if (!isTalkingAvatarVideoProvider(providerId)) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          requestedSeconds: normalizedRequest.request.seconds,
          requestedAudioMode: normalizedRequest.request.audioMode,
          requestedInputMode: normalizedRequest.request.inputMode,
          ...this.buildRequestedTalkingAvatarEchoes(request),
          size: normalizedRequest.request.size,
          referenceImageAlias: null,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "talking_avatar_provider_unavailable",
          warning:
            "talking_avatar mode requires a HeyGen credential. The current configured provider cannot generate talking-avatar videos."
        },
        artifacts: [],
        isError: true
      };
    }

    // ── 2. Plan toggle — gate on talkingVideoEnabled entitlement ─────────────
    // Reads talkingVideoEnabled from the materialized bundle tool policy.
    // When false, fail with talking_avatar_plan_disabled (plan does not include this feature).
    const policy = this.resolveAllowedWorkerToolPolicy(bundle, VIDEO_GENERATE_TOOL_CODE);
    const talkingVideoEnabled = (policy as unknown as Record<string, unknown>)?.talkingVideoEnabled;
    if (talkingVideoEnabled === false) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          requestedSeconds: normalizedRequest.request.seconds,
          requestedAudioMode: normalizedRequest.request.audioMode,
          requestedInputMode: normalizedRequest.request.inputMode,
          ...this.buildRequestedTalkingAvatarEchoes(request),
          size: normalizedRequest.request.size,
          referenceImageAlias: null,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "talking_avatar_plan_disabled",
          warning: "talking_avatar is not enabled on the current plan."
        },
        artifacts: [],
        isError: false
      };
    }

    // ── 3. Branch on personaId vs portraitImageAlias ─────────────────────────
    const personaId = request.personaId ?? null;
    const portraitImageAlias = request.portraitImageAlias ?? null;
    const voiceKeyRaw = request.voiceKey ?? null;
    const shortlist = credential.videoVoiceCatalog?.shortlist ?? [];
    const byKey = new Map(
      shortlist.map((entry) => [entry.voiceKey.toLowerCase(), entry.providerVoiceId] as const)
    );

    let resolvedVoiceId: string;
    let gatewayExtra: Pick<
      ProviderGatewayVideoGenerateRequest,
      "cachedHeygenAvatarId" | "portraitImageBytesBase64" | "portraitImageMimeType"
    >;

    if (personaId !== null) {
      // ── Scenario C (cached): persona path ────────────────────────────────
      let persona: {
        id: string;
        displayName: string;
        heygenAvatarId: string;
        heygenVoiceId: string;
        heygenVoiceLabel: string;
        portraitImageStorageKey: string;
      } | null;
      try {
        persona = await this.persaiInternalApiClientService.fetchWorkspaceVideoPersona({
          workspaceId: bundle.metadata.workspaceId,
          personaId
        });
      } catch (fetchError) {
        const msg =
          fetchError instanceof Error ? fetchError.message : "Persona lookup request failed.";
        this.logger.warn(
          `[talking-avatar] Persona fetch failed requestId=${requestId} personaId=${personaId}: ${msg}`
        );
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "talking_avatar_persona_unavailable",
            warning: msg
          },
          artifacts: [],
          isError: true
        };
      }

      if (persona === null) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "persona_not_found",
            warning: `Persona "${personaId}" not found in this workspace or is archived.`
          },
          artifacts: [],
          isError: true
        };
      }

      // Defensive log: cachedHeygenAvatarId should never be "unset_legacy" in
      // normal post-E12 flow. If it is, the gateway Scenario C (cached) path
      // will fail when submitting to HeyGen — fail honestly here instead.
      if (persona.heygenAvatarId === "unset_legacy" || persona.heygenAvatarId.trim().length === 0) {
        this.logger.warn(
          `[talking-avatar] Persona ${personaId} has an unset/legacy heygenAvatarId. ` +
            `This persona was created before E12 and cannot be used for talking_avatar. ` +
            `requestId=${requestId}`
        );
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "talking_avatar_persona_unavailable",
            warning: `Persona "${personaId}" does not have a HeyGen avatar ID. Re-create the persona to generate a talking avatar.`
          },
          artifacts: [],
          isError: true
        };
      }

      // Voice resolution: explicit voiceKey overrides persona default.
      if (voiceKeyRaw !== null) {
        const providerVoiceId = byKey.get(voiceKeyRaw.toLowerCase());
        if (providerVoiceId === undefined) {
          return {
            payload: {
              toolCode: VIDEO_GENERATE_TOOL_CODE,
              executionMode: "worker",
              provider: providerId,
              model: null,
              prompt: request.prompt,
              requestedSeconds: normalizedRequest.request.seconds,
              requestedAudioMode: normalizedRequest.request.audioMode,
              requestedInputMode: normalizedRequest.request.inputMode,
              ...this.buildRequestedTalkingAvatarEchoes(request),
              size: normalizedRequest.request.size,
              referenceImageAlias: null,
              referenceFilename: null,
              artifact: null,
              usage: null,
              action: "skipped",
              reason: "voice_not_found",
              warning: `Voice key "${voiceKeyRaw}" not found in the HeyGen voice catalog.`
            },
            artifacts: [],
            isError: true
          };
        }
        resolvedVoiceId = providerVoiceId;
      } else {
        // Fall back to the persona's stored HeyGen voice ID (validated at create time).
        resolvedVoiceId = persona.heygenVoiceId;
      }

      gatewayExtra = {
        cachedHeygenAvatarId: persona.heygenAvatarId,
        portraitImageBytesBase64: null,
        portraitImageMimeType: null
      };
    } else {
      // ── Scenario A (ad-hoc): portrait alias path ──────────────────────────
      if (portraitImageAlias === null) {
        // Structural invariant: Slice 3 XOR check prevents this.
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "invalid_arguments",
            warning: "portraitImageAlias is required when personaId is not provided."
          },
          artifacts: [],
          isError: true
        };
      }

      // voiceKey is REQUIRED for ad-hoc portrait path (no persona to fall back to).
      if (voiceKeyRaw === null) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "voice_required",
            warning:
              "voiceKey is required when portraitImageAlias is used (no persona voice fallback)."
          },
          artifacts: [],
          isError: true
        };
      }

      // Validate voiceKey against HeyGen catalog shortlist.
      const providerVoiceId = byKey.get(voiceKeyRaw.toLowerCase());
      if (providerVoiceId === undefined) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: null,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "voice_not_found",
            warning: `Voice key "${voiceKeyRaw}" not found in the HeyGen voice catalog.`
          },
          artifacts: [],
          isError: true
        };
      }
      resolvedVoiceId = providerVoiceId;

      // Resolve portrait alias → bytes from available image attachments.
      // Reuses the same alias-lookup + object-storage-load path as cinematic.
      const imageAttachments = availableAttachments.filter(
        (attachment) => attachment.kind === "image"
      );
      const portraitAttachment = this.findAttachmentByAlias(imageAttachments, portraitImageAlias);
      if (portraitAttachment === null) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: portraitImageAlias,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "portrait_alias_unavailable",
            warning: `Portrait alias "${portraitImageAlias}" does not match any available image attachment.`
          },
          artifacts: [],
          isError: true
        };
      }

      const loadedPortrait = await this.loadReferenceImage(portraitAttachment);
      if (!loadedPortrait.ok) {
        return {
          payload: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: normalizedRequest.request.seconds,
            requestedAudioMode: normalizedRequest.request.audioMode,
            requestedInputMode: normalizedRequest.request.inputMode,
            ...this.buildRequestedTalkingAvatarEchoes(request),
            size: normalizedRequest.request.size,
            referenceImageAlias: portraitImageAlias,
            referenceFilename: null,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: "portrait_alias_unavailable",
            warning: loadedPortrait.warning
          },
          artifacts: [],
          isError: true
        };
      }

      gatewayExtra = {
        cachedHeygenAvatarId: null,
        portraitImageBytesBase64: loadedPortrait.image.bytesBase64,
        portraitImageMimeType: loadedPortrait.image.mimeType
      };
    }

    // ── 4. Dispatch to HeyGen via provider gateway ────────────────────────────
    this.logger.log(
      `[talking-avatar] dispatch requestId=${requestId} personaId=${personaId ?? "ad-hoc"} voiceId=${resolvedVoiceId}`
    );
    try {
      const providerResult = await this.providerGatewayClientService.generateVideo(
        {
          prompt: request.prompt,
          model,
          size: normalizedRequest.request.size,
          seconds: normalizedRequest.request.seconds,
          referenceImage: null,
          referenceTailImage: null,
          voiceIds: null,
          acceptedTask: null,
          providerParameters: null,
          credential: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            secretId: credential.secretRef.id,
            providerId
          },
          mode: "talking_avatar",
          speechText: request.speechText,
          speechLanguage: request.speechLanguage,
          personaId: request.personaId ?? null,
          portraitImageAlias: null,
          voiceKey: resolvedVoiceId,
          ...gatewayExtra
        },
        { timeoutMs: this.resolveWorkerTimeoutMs(bundle) }
      );

      const artifact = await this.persistGeneratedArtifact({
        assistantId: bundle.metadata.assistantId,
        workspaceId: bundle.metadata.workspaceId,
        sessionId,
        requestId,
        filenameHint: request.filename,
        requestPrompt: request.prompt,
        referenceFilename: null,
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
          requestedSeconds: normalizedRequest.request.seconds,
          requestedAudioMode: normalizedRequest.request.audioMode,
          requestedInputMode: normalizedRequest.request.inputMode,
          ...this.buildRequestedTalkingAvatarEchoes(request),
          size: providerResult.size ?? normalizedRequest.request.size,
          referenceImageAlias: null,
          referenceFilename: null,
          artifact,
          usage: providerResult.usage,
          action: "generated",
          reason: null,
          warning: providerResult.warning
        },
        artifacts: [artifact],
        isError: false
      };
    } catch (dispatchError) {
      const failureMessage =
        dispatchError instanceof Error ? dispatchError.message : "HeyGen video generation failed.";
      this.logger.warn(
        `[talking-avatar] dispatch failed requestId=${requestId} personaId=${personaId ?? "ad-hoc"}: ${failureMessage}`
      );
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          requestedSeconds: normalizedRequest.request.seconds,
          requestedAudioMode: normalizedRequest.request.audioMode,
          requestedInputMode: normalizedRequest.request.inputMode,
          ...this.buildRequestedTalkingAvatarEchoes(request),
          size: normalizedRequest.request.size,
          referenceImageAlias: null,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "video_generation_failed",
          warning: failureMessage
        },
        artifacts: [],
        isError: true
      };
    }
  }

  // ADR-109 Slice 3: symmetric echoes of the talking-avatar request fields, so
  // observability and downstream debugging see exactly what the LLM asked for.
  // Pass `null` from the invalid-arguments path; otherwise the parsed request
  // is in scope at every payload site.
  private buildRequestedTalkingAvatarEchoes(request: RuntimeVideoGenerateRequest | null): {
    requestedMode: RuntimeVideoGenerateMode | null;
    requestedSpeechText: string | null;
    requestedSpeechLanguage: string | null;
    requestedPersonaId: string | null;
    requestedPortraitImageAlias: string | null;
    requestedVoiceKey: string | null;
  } {
    return {
      requestedMode: request?.mode ?? null,
      requestedSpeechText: request?.speechText ?? null,
      requestedSpeechLanguage: request?.speechLanguage ?? null,
      requestedPersonaId: request?.personaId ?? null,
      requestedPortraitImageAlias: request?.portraitImageAlias ?? null,
      requestedVoiceKey: request?.voiceKey ?? null
    };
  }

  // ADR-109: forward the talking-avatar fields to the provider gateway ONLY
  // when mode === "talking_avatar". For mode === "cinematic" or absent,
  // these fields are silently ignored and the gateway request is unchanged.
  private buildGatewayTalkingAvatarFields(
    request: RuntimeVideoGenerateRequest
  ): Partial<
    Pick<
      ProviderGatewayVideoGenerateRequest,
      "mode" | "speechText" | "speechLanguage" | "personaId" | "portraitImageAlias" | "voiceKey"
    >
  > {
    if (request.mode !== "talking_avatar") {
      return {};
    }
    return {
      mode: "talking_avatar",
      speechText: request.speechText ?? null,
      speechLanguage: request.speechLanguage ?? null,
      personaId: request.personaId ?? null,
      portraitImageAlias: request.portraitImageAlias ?? null,
      voiceKey: request.voiceKey ?? null
    };
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
