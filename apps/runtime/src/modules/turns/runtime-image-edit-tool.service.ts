import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_EDIT_COUNT,
  MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES,
  MIN_RUNTIME_IMAGE_EDIT_COUNT,
  PERSAI_RUNTIME_IMAGE_BACKGROUNDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  type PersaiRuntimeImageBackground,
  type PersaiRuntimeImageEditProviderId,
  type PersaiRuntimeImageGenerateSize,
  type ProviderGatewayImageEditResult,
  type ProviderGatewayToolCall,
  type RuntimeAttachmentRef,
  type RuntimeImageEditRequest,
  type RuntimeImageEditToolResult,
  type RuntimeUsageSnapshot,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy,
  ANTI_COLLAGE_RULE,
  STANDALONE_EDITED_IMAGE_RULE,
  seriesItemHeaderLine
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import {
  ProviderGatewayClientService,
  ProviderGatewaySafetyRejectedError
} from "./provider-gateway.client.service";
import { SandboxClientService } from "./sandbox-client.service";
import { writeRuntimeOutboundArtifact } from "./write-runtime-outbound-artifact";
import {
  buildImageSafetyRetryFailureWarning,
  rewritePromptAfterProviderSafetyReject
} from "./image-provider-safety-rewrite";
import { selectMediaModelForRequest } from "./media-model-routing";
const IMAGE_EDIT_TOOL_CODE = "image_edit" as const;
const DEFAULT_IMAGE_EDIT_TIMEOUT_MS = 300_000;
const SUPPORTED_IMAGE_EDIT_INPUT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function mergeUsageSnapshots(
  current: RuntimeUsageSnapshot | null,
  next: RuntimeUsageSnapshot | null
): RuntimeUsageSnapshot | null {
  if (current === null) return next;
  if (next === null) return current;
  const sum = (left: number | null | undefined, right: number | null | undefined): number | null =>
    typeof left === "number" || typeof right === "number"
      ? (typeof left === "number" ? left : 0) + (typeof right === "number" ? right : 0)
      : null;
  return {
    providerKey: current.providerKey ?? next.providerKey ?? null,
    modelKey: current.modelKey ?? next.modelKey ?? null,
    inputTokens: sum(current.inputTokens, next.inputTokens),
    cacheCreationInputTokens: sum(
      current.cacheCreationInputTokens ?? null,
      next.cacheCreationInputTokens ?? null
    ),
    cachedInputTokens: sum(current.cachedInputTokens, next.cachedInputTokens),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens)
  };
}

interface LoadedImageEditImage {
  bytesBase64: string;
  mimeType: string;
  filename: string | null;
}

type ResolvedImageEditSelection =
  | {
      ok: true;
      sourceImage: LoadedImageEditImage;
      /** Reference images in request order; empty when none were provided. */
      referenceImages: LoadedImageEditImage[];
      sourceImageAlias: string;
      referenceImageAliases: string[] | null;
      sourceFilename: string | null;
      referenceFilenames: (string | null)[] | null;
    }
  | {
      ok: false;
      reason: string;
      warning: string;
    };

export interface RuntimeImageEditToolExecutionResult {
  payload: RuntimeImageEditToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeImageEditToolService {
  private readonly logger = new Logger(RuntimeImageEditToolService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly sandboxClient: SandboxClientService
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
  }): Promise<RuntimeImageEditToolExecutionResult> {
    const request = this.readImageEditArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      this.logger.warn(
        `[image-edit] requestId=${params.requestId} skipped reason=invalid_arguments: ${request.message}`
      );
      return {
        payload: {
          toolCode: IMAGE_EDIT_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: null,
          revisedPrompt: null,
          requestedCount: null,
          sourceImageAlias: null,
          referenceImageAliases: null,
          sourceFilename: null,
          referenceFilenames: null,
          size: null,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message
        },
        artifacts: [],
        isError: true
      };
    }

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, IMAGE_EDIT_TOOL_CODE);
    if (policy === null) {
      return {
        payload: {
          toolCode: IMAGE_EDIT_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          sourceImageAlias: request.sourceImageAlias,
          referenceImageAliases: request.referenceImageAliases ?? null,
          sourceFilename: null,
          referenceFilenames: null,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "tool_unavailable",
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    const credential = this.resolveConfiguredCredentialRef(params.bundle, IMAGE_EDIT_TOOL_CODE);
    if (credential === null) {
      return {
        payload: {
          toolCode: IMAGE_EDIT_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          sourceImageAlias: request.sourceImageAlias,
          referenceImageAliases: request.referenceImageAliases ?? null,
          sourceFilename: null,
          referenceFilenames: null,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "credential_not_configured",
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    const providerId = this.resolveImageEditProviderId(credential.providerId ?? null);
    if (providerId === null) {
      return {
        payload: {
          toolCode: IMAGE_EDIT_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          sourceImageAlias: request.sourceImageAlias,
          referenceImageAliases: request.referenceImageAliases ?? null,
          sourceFilename: null,
          referenceFilenames: null,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "provider_unavailable",
          warning: "Selected image-edit provider is not supported by the current native runtime."
        },
        artifacts: [],
        isError: false
      };
    }

    const modelSelection = selectMediaModelForRequest({
      toolCode: IMAGE_EDIT_TOOL_CODE,
      credential,
      background: request.background
    });
    if ("reason" in modelSelection) {
      this.logger.warn(
        `[image-edit] requestId=${params.requestId} skipped: ${modelSelection.warning}`
      );
      return {
        payload: {
          toolCode: "image_edit",
          executionMode: "worker",
          provider: providerId,
          model: this.resolveToolModelKey(credential),
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          sourceImageAlias: request.sourceImageAlias,
          referenceImageAliases: request.referenceImageAliases ?? null,
          sourceFilename: null,
          referenceFilenames: null,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: modelSelection.reason,
          warning: modelSelection.warning
        },
        artifacts: [],
        isError: false
      };
    }

    const selection = await this.resolveImageSelection(
      params.bundle.metadata.workspaceId,
      params.availableAttachments,
      request
    );
    if (!selection.ok) {
      this.logger.warn(
        `[image-edit] requestId=${params.requestId} skipped reason=${selection.reason}: ${selection.warning}`
      );
      return {
        payload: {
          toolCode: "image_edit",
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          sourceImageAlias: request.sourceImageAlias,
          referenceImageAliases: request.referenceImageAliases ?? null,
          sourceFilename: null,
          referenceFilenames: null,
          size: request.size,
          artifacts: [],
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
          runtimeSessionId: params.sessionId,
          attachments: params.availableAttachments,
          directToolExecution: {
            toolCode: IMAGE_EDIT_TOOL_CODE,
            request
          }
        });
        if (!enqueueOutcome.accepted) {
          return {
            payload: {
              toolCode: IMAGE_EDIT_TOOL_CODE,
              executionMode: "worker",
              provider: providerId,
              model: this.resolveToolModelKey(credential),
              prompt: request.prompt,
              revisedPrompt: null,
              requestedCount: request.count,
              sourceImageAlias: selection.sourceImageAlias,
              referenceImageAliases: selection.referenceImageAliases,
              sourceFilename: selection.sourceFilename,
              referenceFilenames: selection.referenceFilenames,
              size: request.size,
              artifacts: [],
              usage: null,
              action: "skipped",
              reason: enqueueOutcome.code,
              warning: enqueueOutcome.message,
              ...(enqueueOutcome.guidance === null ? {} : { guidance: enqueueOutcome.guidance }),
              jobId: null
            },
            artifacts: [],
            isError: false
          };
        }
        return {
          payload: {
            toolCode: IMAGE_EDIT_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: this.resolveToolModelKey(credential),
            prompt: request.prompt,
            revisedPrompt: null,
            requestedCount: request.count,
            sourceImageAlias: selection.sourceImageAlias,
            referenceImageAliases: selection.referenceImageAliases,
            sourceFilename: selection.sourceFilename,
            referenceFilenames: selection.referenceFilenames,
            size: request.size,
            artifacts: [],
            usage: null,
            action: "pending_delivery",
            reason: null,
            warning: null,
            jobId: enqueueOutcome.jobId,
            canSendFileNow: false,
            messageToUser: this.buildPendingDeliveryMessageToUser(request.count),
            expectedResultCount: request.count
          },
          artifacts: [],
          isError: false
        };
      } catch (error) {
        return {
          payload: {
            toolCode: IMAGE_EDIT_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            revisedPrompt: null,
            requestedCount: request.count,
            sourceImageAlias: selection.sourceImageAlias,
            referenceImageAliases: selection.referenceImageAliases,
            sourceFilename: selection.sourceFilename,
            referenceFilenames: selection.referenceFilenames,
            size: request.size,
            artifacts: [],
            usage: null,
            action: "skipped",
            reason: "runtime_degraded",
            warning:
              error instanceof Error ? error.message : "Deferred image edit could not be enqueued.",
            jobId: null
          },
          artifacts: [],
          isError: false
        };
      }
    }

    try {
      // ADR-105 §5 (single-owner reservation) — the worker NEVER touches the
      // monthly media quota. The enqueue admission seam
      // (`EnqueueRuntimeDeferredMediaJobService`) reserves the units exactly
      // once, and the API layer resolves that reservation exactly once at the
      // job's terminal transition (scheduler `failJob` releases on failure; the
      // API delivery loop settles delivered / reconciles undelivered units per
      // ADR-082). The worker performs no reserve and no release.
      const timeoutMs = this.resolveWorkerTimeoutMs(params.bundle);
      const baseProviderRequest = {
        model: modelSelection.model,
        size: request.size,
        background: request.background,
        sourceImage: selection.sourceImage,
        referenceImages: selection.referenceImages,
        credential: {
          toolCode: IMAGE_EDIT_TOOL_CODE,
          secretId: modelSelection.credential.secretRef.id,
          providerId,
          requestContext: {
            workspaceId: params.bundle.metadata.workspaceId,
            runtimeRequestId: params.requestId,
            runtimeSessionId: params.sessionId
          },
          reserveTransport:
            modelSelection.credential.reserveTransport &&
            modelSelection.credential.reserveTransport.configured
              ? {
                  enabled: true,
                  secretId: modelSelection.credential.reserveTransport.secretRef.id,
                  baseUrl: modelSelection.credential.reserveTransport.baseUrl
                }
              : null
        }
      } as const;
      const runEditCall = async (prompt: string, count: number, requestIdSuffix = "") => {
        let effectivePrompt = prompt;
        let safetyRetryWarning: string | null = null;
        let providerResult: ProviderGatewayImageEditResult;
        try {
          providerResult = await this.providerGatewayClientService.editImage(
            {
              ...baseProviderRequest,
              prompt: effectivePrompt,
              count
            },
            {
              timeoutMs
            }
          );
        } catch (error) {
          if (!(error instanceof ProviderGatewaySafetyRejectedError)) {
            throw error;
          }
          const rewriteOutcome = await rewritePromptAfterProviderSafetyReject({
            bundle: params.bundle,
            providerGatewayClientService: this.providerGatewayClientService,
            requestId: `${params.requestId}${requestIdSuffix}`,
            toolCode: IMAGE_EDIT_TOOL_CODE,
            originalPrompt: prompt,
            failure: error
          });
          if (!rewriteOutcome.ok) {
            return {
              ok: false as const,
              payload: {
                toolCode: IMAGE_EDIT_TOOL_CODE,
                executionMode: "worker" as const,
                provider: providerId,
                model: modelSelection.model,
                prompt: request.prompt,
                revisedPrompt: null,
                requestedCount: request.count,
                sourceImageAlias: selection.sourceImageAlias,
                referenceImageAliases: selection.referenceImageAliases,
                sourceFilename: selection.sourceFilename,
                referenceFilenames: selection.referenceFilenames,
                size: request.size,
                artifacts: [],
                usage: null,
                action: "skipped" as const,
                reason: "image_provider_safety_rejected",
                warning: rewriteOutcome.failureWarning
              }
            };
          }
          effectivePrompt = rewriteOutcome.rewrittenPrompt;
          safetyRetryWarning = rewriteOutcome.retryWarning;
          try {
            providerResult = await this.providerGatewayClientService.editImage(
              {
                ...baseProviderRequest,
                prompt: effectivePrompt,
                count
              },
              {
                timeoutMs
              }
            );
          } catch (retryError) {
            return {
              ok: false as const,
              payload: {
                toolCode: IMAGE_EDIT_TOOL_CODE,
                executionMode: "worker" as const,
                provider: providerId,
                model: modelSelection.model,
                prompt: request.prompt,
                revisedPrompt: effectivePrompt,
                requestedCount: request.count,
                sourceImageAlias: selection.sourceImageAlias,
                referenceImageAliases: selection.referenceImageAliases,
                sourceFilename: selection.sourceFilename,
                referenceFilenames: selection.referenceFilenames,
                size: request.size,
                artifacts: [],
                usage: null,
                action: "skipped" as const,
                reason: "image_provider_safety_rejected",
                warning: buildImageSafetyRetryFailureWarning({
                  originalFailure: error,
                  retryError
                })
              }
            };
          }
        }
        return {
          ok: true as const,
          effectivePrompt,
          providerResult,
          warning: safetyRetryWarning
        };
      };
      this.logger.log(
        `[image-edit] requestId=${params.requestId} provider=${providerId} sourceAlias="${selection.sourceImageAlias}" referenceAliases=${
          selection.referenceImageAliases === null
            ? "none"
            : `[${selection.referenceImageAliases.join(", ")}]`
        }`
      );
      let accumulatedUsage: RuntimeUsageSnapshot | null = null;
      let accumulatedWarning: string | null = modelSelection.warning;
      let revisedPrompt: string | null = null;
      const persistedArtifacts: RuntimeOutputArtifact[] = [];
      const multiImagePlan = this.resolveMultiImageExecutionPlan(request);
      if (multiImagePlan === null) {
        const providerResult = await runEditCall(request.prompt, request.count);
        if (!providerResult.ok) {
          return {
            payload: providerResult.payload,
            artifacts: [],
            isError: true
          };
        }
        revisedPrompt =
          providerResult.providerResult.images.find((image) => image.revisedPrompt !== null)
            ?.revisedPrompt ??
          (providerResult.warning === null ? null : providerResult.effectivePrompt);
        accumulatedUsage = mergeUsageSnapshots(
          accumulatedUsage,
          providerResult.providerResult.usage
        );
        accumulatedWarning = this.mergeWarnings(
          accumulatedWarning,
          providerResult.warning,
          providerResult.providerResult.warning
        );
        const artifacts = await Promise.all(
          providerResult.providerResult.images.map((image, index) =>
            this.persistEditedArtifact({
              assistantId: params.bundle.metadata.assistantId,
              workspaceId: params.bundle.metadata.workspaceId,
              handle: params.bundle.metadata.assistantHandle,
              siblingHandles: params.bundle.metadata.siblingAssistantHandles,
              sessionId: params.sessionId,
              workspaceQuotaBytes: params.bundle.governance.quota?.workspaceQuotaBytes ?? null,
              sharedQuotaBytes: params.bundle.governance.quota?.sharedQuotaBytes ?? null,
              filenameHint: request.filename,
              requestPrompt: providerResult.effectivePrompt,
              sourceFilename: selection.sourceFilename,
              image,
              index,
              billingFacts: providerResult.providerResult.billingFacts
            })
          )
        );
        persistedArtifacts.push(...artifacts);
      } else {
        for (const [index, itemPrompt] of multiImagePlan.entries()) {
          const composedPrompt = this.composeSeriesPrompt({
            overallPrompt: request.prompt,
            itemPrompt,
            index,
            total: multiImagePlan.length,
            sourceImageAlias: selection.sourceImageAlias,
            referenceImageAliases: selection.referenceImageAliases ?? []
          });
          const seriesResult = await runEditCall(composedPrompt, 1, `:series:${String(index + 1)}`);
          if (!seriesResult.ok) {
            if (persistedArtifacts.length > 0) {
              accumulatedWarning = this.mergeWarnings(
                accumulatedWarning,
                this.buildPartialMultiImageFailureWarning({
                  requestedCount: request.count,
                  deliveredCount: persistedArtifacts.length,
                  failureWarning: seriesResult.payload.warning
                })
              );
              break;
            }
            return {
              payload: seriesResult.payload,
              artifacts: [],
              isError: true
            };
          }
          revisedPrompt =
            seriesResult.providerResult.images.find((image) => image.revisedPrompt !== null)
              ?.revisedPrompt ?? revisedPrompt;
          accumulatedUsage = mergeUsageSnapshots(
            accumulatedUsage,
            seriesResult.providerResult.usage
          );
          accumulatedWarning = this.mergeWarnings(
            accumulatedWarning,
            seriesResult.warning,
            seriesResult.providerResult.warning
          );
          const artifacts = await Promise.all(
            seriesResult.providerResult.images.map((image) =>
              this.persistEditedArtifact({
                assistantId: params.bundle.metadata.assistantId,
                workspaceId: params.bundle.metadata.workspaceId,
                handle: params.bundle.metadata.assistantHandle,
                siblingHandles: params.bundle.metadata.siblingAssistantHandles,
                sessionId: params.sessionId,
                workspaceQuotaBytes: params.bundle.governance.quota?.workspaceQuotaBytes ?? null,
                sharedQuotaBytes: params.bundle.governance.quota?.sharedQuotaBytes ?? null,
                filenameHint: request.filename,
                requestPrompt: itemPrompt,
                sourceFilename: selection.sourceFilename,
                image,
                index,
                billingFacts: seriesResult.providerResult.billingFacts
              })
            )
          );
          persistedArtifacts.push(...artifacts);
        }
      }
      if (persistedArtifacts.length === 0) {
        return {
          payload: {
            toolCode: "image_edit",
            executionMode: "worker",
            provider: providerId,
            model: modelSelection.model,
            prompt: request.prompt,
            revisedPrompt: null,
            requestedCount: request.count,
            sourceImageAlias: selection.sourceImageAlias,
            referenceImageAliases: selection.referenceImageAliases,
            sourceFilename: selection.sourceFilename,
            referenceFilenames: selection.referenceFilenames,
            size: request.size,
            artifacts: [],
            usage: accumulatedUsage,
            action: "skipped",
            reason: "empty_result",
            warning: "Image-edit provider returned no images."
          },
          artifacts: [],
          isError: true
        };
      }

      this.logger.log(
        `[image-edit] completed requestId=${params.requestId} provider=${providerId} artifacts=${String(
          persistedArtifacts.length
        )} sourceAlias="${selection.sourceImageAlias}" referenceAliases=${
          selection.referenceImageAliases === null
            ? "none"
            : `[${selection.referenceImageAliases.join(", ")}]`
        }`
      );
      return {
        payload: {
          toolCode: "image_edit",
          executionMode: "worker",
          provider: providerId,
          model: modelSelection.model,
          prompt: request.prompt,
          revisedPrompt,
          requestedCount: request.count,
          sourceImageAlias: selection.sourceImageAlias,
          referenceImageAliases: selection.referenceImageAliases,
          sourceFilename: selection.sourceFilename,
          referenceFilenames: selection.referenceFilenames,
          size: request.size,
          artifacts: persistedArtifacts,
          usage: accumulatedUsage,
          action: "generated",
          reason: null,
          warning:
            persistedArtifacts.length === request.count
              ? accumulatedWarning
              : this.mergeWarnings(
                  accumulatedWarning,
                  `Requested ${String(request.count)} image(s), received ${String(persistedArtifacts.length)}.`
                )
        },
        artifacts: persistedArtifacts,
        isError: false
      };
    } catch (error) {
      this.logger.warn(
        `[image-edit] failed requestId=${params.requestId} sourceAlias="${selection.sourceImageAlias}" referenceAliases=${
          selection.referenceImageAliases === null
            ? "none"
            : `[${selection.referenceImageAliases.join(", ")}]`
        }: ${error instanceof Error ? error.message : "Image edit failed."}`
      );
      return {
        payload: {
          toolCode: "image_edit",
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          sourceImageAlias: selection.sourceImageAlias,
          referenceImageAliases: selection.referenceImageAliases,
          sourceFilename: selection.sourceFilename,
          referenceFilenames: selection.referenceFilenames,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "image_edit_failed",
          warning: error instanceof Error ? error.message : "Image edit failed."
        },
        artifacts: [],
        isError: true
      };
    }
  }

  /**
   * ADR-105 — model-facing hint for an accepted async image-edit job. States
   * the edited image is not in hand yet (`canSendFileNow: false`) and arrives
   * in a separate delivery, so the model does not falsely claim attachment.
   */
  private buildPendingDeliveryMessageToUser(count: number): string {
    const noun = count > 1 ? `${String(count)} edited images` : "edited image";
    return `Accepted. The ${noun} cannot be attached in this reply; it is being prepared and will be delivered in a separate message when ready.`;
  }

  private readImageEditArguments(args: Record<string, unknown>): RuntimeImageEditRequest | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) =>
        key !== "toolCode" &&
        key !== "prompt" &&
        key !== "count" &&
        key !== "outputMode" &&
        key !== "seriesItems" &&
        key !== "filename" &&
        key !== "size" &&
        key !== "background" &&
        key !== "sourceImageAlias" &&
        key !== "referenceImageAliases"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    if ("toolCode" in args && args.toolCode !== IMAGE_EDIT_TOOL_CODE) {
      return new Error(`toolCode must be ${IMAGE_EDIT_TOOL_CODE}`);
    }

    const count =
      args.count === undefined || args.count === null
        ? 1
        : Number.isInteger(args.count) &&
            Number(args.count) >= MIN_RUNTIME_IMAGE_EDIT_COUNT &&
            Number(args.count) <= MAX_RUNTIME_IMAGE_EDIT_COUNT
          ? Number(args.count)
          : null;
    if (count === null) {
      return new Error(
        `count must be an integer between ${String(MIN_RUNTIME_IMAGE_EDIT_COUNT)} and ${String(MAX_RUNTIME_IMAGE_EDIT_COUNT)}`
      );
    }

    const outputMode =
      args.outputMode === undefined || args.outputMode === null
        ? null
        : args.outputMode === "variants" || args.outputMode === "series"
          ? args.outputMode
          : null;
    if ("outputMode" in args && args.outputMode !== null && outputMode === null) {
      return new Error('outputMode must be "variants", "series", or null when provided');
    }

    const seriesItemsRaw = args.seriesItems;
    const seriesItems =
      seriesItemsRaw === undefined || seriesItemsRaw === null
        ? null
        : Array.isArray(seriesItemsRaw)
          ? seriesItemsRaw
              .map((item) => this.asNonEmptyString(item))
              .filter((item): item is string => item !== null)
          : null;
    if ("seriesItems" in args && args.seriesItems !== null && seriesItems === null) {
      return new Error("seriesItems must be an array of non-empty strings when provided");
    }
    if (outputMode === "series") {
      if (seriesItems === null || seriesItems.length === 0) {
        return new Error("series outputMode requires non-empty seriesItems");
      }
      if (seriesItems.length !== count) {
        return new Error("seriesItems length must match count for series outputMode");
      }
    }
    if (outputMode !== "series" && seriesItems !== null) {
      return new Error("seriesItems can only be used when outputMode is 'series'");
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
        : typeof args.size === "string" && this.isImageGenerateSize(args.size)
          ? args.size
          : null;
    if ("size" in args && args.size !== null && size === null) {
      return new Error(
        `size must be one of ${PERSAI_RUNTIME_IMAGE_GENERATE_SIZES.join(", ")} when provided`
      );
    }

    const backgroundInput = args.background;
    if (
      backgroundInput !== undefined &&
      backgroundInput !== null &&
      (typeof backgroundInput !== "string" || !this.isImageBackground(backgroundInput))
    ) {
      return new Error(
        `background must be one of ${PERSAI_RUNTIME_IMAGE_BACKGROUNDS.join(", ")} when provided`
      );
    }
    const background: PersaiRuntimeImageBackground =
      typeof backgroundInput === "string" ? backgroundInput : "auto";

    const sourceImageAlias =
      args.sourceImageAlias === undefined || args.sourceImageAlias === null
        ? null
        : this.asNonEmptyString(args.sourceImageAlias);
    if ("sourceImageAlias" in args && args.sourceImageAlias !== null && sourceImageAlias === null) {
      return new Error("sourceImageAlias must be a non-empty string when provided");
    }

    const referenceImageAliasesRaw = args.referenceImageAliases;
    if (
      "referenceImageAliases" in args &&
      args.referenceImageAliases !== null &&
      !Array.isArray(referenceImageAliasesRaw)
    ) {
      return new Error("referenceImageAliases must be an array of non-empty strings when provided");
    }
    const referenceImageAliasesParsed = Array.isArray(referenceImageAliasesRaw)
      ? referenceImageAliasesRaw
          .map((item) => this.asNonEmptyString(item))
          .filter((item): item is string => item !== null)
      : [];

    // Dedupe the reference aliases case-insensitively and drop any reference
    // that collides with the source image (a reference must be a different
    // image than the source).
    const normalizedSourceAlias =
      sourceImageAlias === null ? null : this.normalizeAlias(sourceImageAlias);
    const mergedReferenceAliases: string[] = [];
    const seenReferenceAliases = new Set<string>();
    for (const alias of referenceImageAliasesParsed) {
      const normalized = this.normalizeAlias(alias);
      if (normalizedSourceAlias !== null && normalized === normalizedSourceAlias) {
        continue;
      }
      if (seenReferenceAliases.has(normalized)) {
        continue;
      }
      seenReferenceAliases.add(normalized);
      mergedReferenceAliases.push(alias);
    }
    if (mergedReferenceAliases.length > MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES) {
      return new Error(
        `referenceImageAliases must list at most ${String(MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES)} reference image(s)`
      );
    }
    const referenceImageAliases = mergedReferenceAliases.length > 0 ? mergedReferenceAliases : null;

    // `prompt` carries the overall request. In series mode each `seriesItems`
    // entry is self-describing, so models routinely omit the top-level prompt;
    // synthesize an overall prompt instead of rejecting the call as
    // invalid_arguments (which silently skips the whole media request).
    let prompt = this.asNonEmptyString(args.prompt);
    if (prompt === null) {
      if (outputMode === "series" && seriesItems !== null && seriesItems.length > 0) {
        prompt =
          "Edit the source image into a coherent multi-image series; each series item below describes one image to produce.";
      } else {
        return new Error("prompt must be a non-empty string");
      }
    }

    return {
      toolCode: "image_edit",
      prompt,
      count,
      outputMode,
      seriesItems,
      filename,
      size,
      background,
      sourceImageAlias,
      referenceImageAliases
    };
  }

  private async resolveImageSelection(
    workspaceId: string,
    attachments: RuntimeAttachmentRef[],
    request: RuntimeImageEditRequest
  ): Promise<ResolvedImageEditSelection> {
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    if (imageAttachments.length === 0) {
      return {
        ok: false,
        reason: "source_image_missing",
        warning:
          "Attach an image or keep the source image in recent chat context before using image_edit."
      };
    }

    const sourceImageAlias = request.sourceImageAlias;
    const referenceImageAliases = request.referenceImageAliases ?? [];

    if (imageAttachments.length > 1 && sourceImageAlias === null) {
      return {
        ok: false,
        reason: "source_image_alias_required",
        warning:
          'Multiple reusable images are available. Ask the user which sticky image alias is the source image, for example "image #1".'
      };
    }

    const sourceAttachment =
      sourceImageAlias === null
        ? (imageAttachments[0] ?? null)
        : this.findAttachmentByAlias(imageAttachments, sourceImageAlias);
    if (sourceAttachment === null) {
      return {
        ok: false,
        reason: "source_image_alias_invalid",
        warning:
          "sourceImageAlias must match one of the available reusable image aliases in the working-files context."
      };
    }

    const normalizedSource = this.normalizeAlias(
      this.resolvePrimaryAttachmentAlias(sourceAttachment)
    );
    const referenceAttachments: RuntimeAttachmentRef[] = [];
    const seenReferenceAliases = new Set<string>();
    for (const alias of referenceImageAliases) {
      const referenceAttachment = this.findAttachmentByAlias(imageAttachments, alias);
      if (referenceAttachment === null) {
        return {
          ok: false,
          reason: "reference_image_alias_invalid",
          warning:
            "Each entry in referenceImageAliases must match one of the available reusable image aliases in the working-files context."
        };
      }
      const normalizedReference = this.normalizeAlias(
        this.resolvePrimaryAttachmentAlias(referenceAttachment)
      );
      if (normalizedReference === normalizedSource) {
        return {
          ok: false,
          reason: "reference_image_same_as_source",
          warning:
            "Each entry in referenceImageAliases must refer to a different reusable image than sourceImageAlias."
        };
      }
      if (seenReferenceAliases.has(normalizedReference)) {
        continue;
      }
      seenReferenceAliases.add(normalizedReference);
      referenceAttachments.push(referenceAttachment);
    }

    const loadedSource = await this.loadSelectedImage(workspaceId, sourceAttachment, "source");
    if (!loadedSource.ok) {
      return loadedSource;
    }

    const loadedReferences: LoadedImageEditImage[] = [];
    for (const referenceAttachment of referenceAttachments) {
      const loadedReference = await this.loadSelectedImage(
        workspaceId,
        referenceAttachment,
        "reference"
      );
      if (!loadedReference.ok) {
        return loadedReference;
      }
      loadedReferences.push(loadedReference.image);
    }

    const resolvedReferenceAliases = referenceAttachments.map((attachment) =>
      this.resolvePrimaryAttachmentAlias(attachment)
    );
    const resolvedReferenceFilenames = referenceAttachments.map(
      (attachment) => attachment.displayName ?? null
    );

    return {
      ok: true,
      sourceImage: loadedSource.image,
      referenceImages: loadedReferences,
      sourceImageAlias: this.resolvePrimaryAttachmentAlias(sourceAttachment),
      referenceImageAliases:
        resolvedReferenceAliases.length === 0 ? null : resolvedReferenceAliases,
      sourceFilename: sourceAttachment.displayName,
      referenceFilenames:
        resolvedReferenceFilenames.length === 0 ? null : resolvedReferenceFilenames
    };
  }

  private async loadSelectedImage(
    workspaceId: string,
    attachment: RuntimeAttachmentRef,
    role: "source" | "reference"
  ): Promise<
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
    const mimeType = this.normalizeImageEditInputMimeType(attachment.mimeType);
    if (mimeType === null) {
      return {
        ok: false,
        reason:
          role === "source" ? "unsupported_source_image_type" : "unsupported_reference_image_type",
        warning:
          "image_edit currently supports PNG, JPEG, and WebP current-turn source/reference images."
      };
    }

    const buffer = await this.mediaObjectStorage.downloadByWorkspacePath({
      workspaceId,
      storagePath: attachment.storagePath
    });
    if (buffer === null || buffer.length === 0) {
      return {
        ok: false,
        reason: role === "source" ? "source_image_unavailable" : "reference_image_unavailable",
        warning:
          role === "source"
            ? "The selected source image could not be loaded for editing."
            : "The selected reference image could not be loaded for editing."
      };
    }

    return {
      ok: true,
      image: {
        bytesBase64: buffer.toString("base64"),
        mimeType,
        filename: attachment.displayName
      }
    };
  }

  private async persistEditedArtifact(input: {
    assistantId: string;
    workspaceId: string;
    handle: string;
    siblingHandles: readonly string[];
    sessionId: string;
    workspaceQuotaBytes: number | null;
    sharedQuotaBytes: number | null;
    filenameHint: string | null;
    requestPrompt: string;
    sourceFilename: string | null;
    image: {
      bytesBase64: string;
      mimeType: string;
      revisedPrompt: string | null;
    };
    index: number;
    billingFacts: RuntimeOutputArtifact["billingFacts"];
  }): Promise<RuntimeOutputArtifact> {
    if (!input.image.mimeType.startsWith("image/")) {
      throw new Error(`Image provider returned unsupported MIME type "${input.image.mimeType}".`);
    }
    const buffer = Buffer.from(input.image.bytesBase64, "base64");
    if (buffer.length === 0) {
      throw new Error("Image provider returned an empty image payload.");
    }
    const extension = this.extensionFromMimeType(input.image.mimeType);
    const filename = this.resolveFilename(
      input.filenameHint,
      input.sourceFilename,
      input.index,
      extension
    );
    const slugSourceText =
      input.image.revisedPrompt?.trim() || input.requestPrompt.trim() || filename || "edited-image";
    return writeRuntimeOutboundArtifact({
      sandboxClient: this.sandboxClient,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      handle: input.handle,
      siblingHandles: input.siblingHandles,
      sessionId: input.sessionId,
      workspaceQuotaBytes: input.workspaceQuotaBytes,
      sharedQuotaBytes: input.sharedQuotaBytes,
      buffer,
      mimeType: input.image.mimeType,
      slugSourceText,
      filenameHint: filename,
      kind: "image",
      sourceToolCode: "image_edit",
      billingFacts: input.billingFacts
    });
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

  private resolveToolModelKey(credential: AssistantRuntimeBundleToolCredentialRef): string | null {
    return typeof credential.modelKey === "string" && credential.modelKey.trim().length > 0
      ? credential.modelKey.trim()
      : null;
  }

  private resolveWorkerTimeoutMs(bundle: AssistantRuntimeBundle): number {
    const configured =
      bundle.runtime.workerTools.tools.find((tool) => tool.toolCode === IMAGE_EDIT_TOOL_CODE)
        ?.timeoutMs ?? null;
    return Number.isInteger(configured) && Number(configured) > 0
      ? Number(configured)
      : DEFAULT_IMAGE_EDIT_TIMEOUT_MS;
  }

  private mergeWarnings(...warnings: Array<string | null | undefined>): string | null {
    const filtered = warnings.filter((warning): warning is string => typeof warning === "string");
    return filtered.length > 0 ? filtered.join(" ") : null;
  }

  private resolveMultiImageExecutionPlan(request: RuntimeImageEditRequest): string[] | null {
    if (request.count <= 1) {
      return null;
    }
    if (request.outputMode === "series" && Array.isArray(request.seriesItems)) {
      return request.seriesItems;
    }
    if (request.outputMode === "variants") {
      return Array.from(
        { length: request.count },
        (_, index) =>
          `Create variation ${String(index + 1)} of ${String(request.count)} for the same core idea. Keep the same source subject and overall intent, but make this finished image meaningfully distinct in composition, framing, lighting, palette, pose, or mood. ${STANDALONE_EDITED_IMAGE_RULE}`
      );
    }
    return Array.from(
      { length: request.count },
      (_, index) =>
        `Create output ${String(index + 1)} of ${String(request.count)} as one standalone final edited image that stays faithful to the overall request. ${STANDALONE_EDITED_IMAGE_RULE}`
    );
  }

  private buildPartialMultiImageFailureWarning(input: {
    requestedCount: number;
    deliveredCount: number;
    failureWarning: string | null;
  }): string {
    const base = `Stopped after ${String(input.deliveredCount)} of ${String(input.requestedCount)} image(s); the remaining item(s) could not be completed.`;
    return input.failureWarning === null || input.failureWarning.trim().length === 0
      ? base
      : `${base} ${input.failureWarning.trim()}`;
  }

  private formatAliasList(aliases: string[]): string {
    if (aliases.length <= 1) {
      return aliases[0] ?? "";
    }
    return `${aliases.slice(0, -1).join(", ")} and ${aliases[aliases.length - 1]}`;
  }

  private composeSeriesPrompt(input: {
    overallPrompt: string;
    itemPrompt: string;
    index: number;
    total: number;
    sourceImageAlias: string;
    referenceImageAliases: string[];
  }): string {
    const referenceLine =
      input.referenceImageAliases.length === 0
        ? "No separate reference image was provided."
        : `Use ${this.formatAliasList(input.referenceImageAliases)} only as supporting visual references; keep the edited product rooted in ${input.sourceImageAlias}.`;
    return [
      seriesItemHeaderLine(input.index, input.total),
      `Overall request: ${input.overallPrompt}`,
      `Keep the same source product/object identity from ${input.sourceImageAlias} across every series item unless the user explicitly asked to replace it.`,
      referenceLine,
      `${STANDALONE_EDITED_IMAGE_RULE} ${ANTI_COLLAGE_RULE}`,
      `This item only: ${input.itemPrompt}`
    ].join("\n\n");
  }

  private resolveImageEditProviderId(
    providerId: string | null
  ): PersaiRuntimeImageEditProviderId | null {
    const resolved = providerId ?? "openai";
    return PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS.includes(
      resolved as PersaiRuntimeImageEditProviderId
    )
      ? (resolved as PersaiRuntimeImageEditProviderId)
      : null;
  }

  private normalizeImageEditInputMimeType(mimeType: string): string | null {
    const normalized = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    return SUPPORTED_IMAGE_EDIT_INPUT_MIME_TYPES.has(normalized) ? normalized : null;
  }

  private isImageGenerateSize(value: string): value is PersaiRuntimeImageGenerateSize {
    return PERSAI_RUNTIME_IMAGE_GENERATE_SIZES.includes(value as PersaiRuntimeImageGenerateSize);
  }

  private isImageBackground(value: string): value is PersaiRuntimeImageBackground {
    return PERSAI_RUNTIME_IMAGE_BACKGROUNDS.includes(value as PersaiRuntimeImageBackground);
  }

  private resolveFilename(
    filenameHint: string | null,
    sourceFilename: string | null,
    index: number,
    extension: string
  ): string | null {
    const base =
      filenameHint?.trim() ??
      (sourceFilename ? `${sourceFilename.replace(/\.[A-Za-z0-9]+$/g, "").trim()}-edited` : "");
    if (base.length === 0) {
      return index === 0
        ? `image-edited.${extension}`
        : `image-edited-${String(index + 1)}.${extension}`;
    }
    const sanitizedBase = base.replace(/[\\/:*?"<>|]+/g, "_");
    const withoutExt = sanitizedBase.replace(/\.[A-Za-z0-9]+$/g, "").trim() || "image-edited";
    const suffix = index === 0 ? "" : `-${String(index + 1)}`;
    return `${withoutExt}${suffix}.${extension}`;
  }

  private extensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case "image/jpeg":
        return "jpg";
      case "image/webp":
        return "webp";
      case "image/png":
      default:
        return "png";
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
    const aliases = attachment.aliases ?? [];
    const stickyImageAlias = aliases.find((alias) => /^image #\d+$/i.test(alias));
    if (stickyImageAlias !== undefined) {
      return stickyImageAlias;
    }
    const stickyFileAlias = aliases.find((alias) => /^file #\d+$/i.test(alias));
    if (stickyFileAlias !== undefined) {
      return stickyFileAlias;
    }
    return aliases[0] ?? attachment.displayName ?? "selected image";
  }

  private normalizeAlias(value: string): string {
    return value.trim().toLowerCase();
  }
}
