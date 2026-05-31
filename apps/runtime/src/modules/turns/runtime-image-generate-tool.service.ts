import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  PERSAI_RUNTIME_IMAGE_BACKGROUNDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  type PersaiRuntimeImageBackground,
  type PersaiRuntimeImageGenerateProviderId,
  type PersaiRuntimeImageGenerateSize,
  type ProviderGatewayToolCall,
  type ProviderGatewayImageGenerateResult,
  type RuntimeImageGenerateRequest,
  type RuntimeImageGenerateToolResult,
  type RuntimeUsageSnapshot,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import {
  ProviderGatewayClientService,
  ProviderGatewaySafetyRejectedError
} from "./provider-gateway.client.service";
import { buildGeneratedFileSemanticSummary } from "./generated-file-semantic-summary";
import {
  buildImageSafetyRetryFailureWarning,
  rewritePromptAfterProviderSafetyReject
} from "./image-provider-safety-rewrite";
import { selectMediaModelForRequest } from "./media-model-routing";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";

const IMAGE_GENERATE_TOOL_CODE = "image_generate" as const;
const DEFAULT_IMAGE_GENERATE_TIMEOUT_MS = 300_000;

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
    cachedInputTokens: sum(current.cachedInputTokens, next.cachedInputTokens),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens)
  };
}

export interface RuntimeImageGenerateToolExecutionResult {
  payload: RuntimeImageGenerateToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeImageGenerateToolService {
  private readonly logger = new Logger(RuntimeImageGenerateToolService.name);

  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly runtimeAssistantFileRegistryService: RuntimeAssistantFileRegistryService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    deferToAsyncMediaJob?: {
      sourceUserMessageId: string;
      sourceUserMessageText: string;
    };
  }): Promise<RuntimeImageGenerateToolExecutionResult> {
    const request = this.readImageGenerateArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: null,
          revisedPrompt: null,
          requestedCount: null,
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

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, IMAGE_GENERATE_TOOL_CODE);
    if (policy === null) {
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
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

    const credential = this.resolveConfiguredCredentialRef(params.bundle, IMAGE_GENERATE_TOOL_CODE);
    if (credential === null) {
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
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

    const providerId = this.resolveImageGenerateProviderId(credential.providerId ?? null);
    if (providerId === null) {
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "provider_unavailable",
          warning:
            "Selected image-generation provider is not supported by the current native runtime."
        },
        artifacts: [],
        isError: false
      };
    }

    const modelSelection = selectMediaModelForRequest({
      toolCode: "image_generate",
      credential,
      background: request.background
    });
    if ("reason" in modelSelection) {
      this.logger.warn(
        `[image-generate] requestId=${params.requestId} skipped: ${modelSelection.warning}`
      );
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: providerId,
          model: this.resolveToolModelKey(credential),
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
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

    if (params.deferToAsyncMediaJob !== undefined) {
      try {
        const enqueueOutcome = await this.persaiInternalApiClientService.enqueueDeferredMediaJob({
          assistantId: params.bundle.metadata.assistantId,
          sourceUserMessageId: params.deferToAsyncMediaJob.sourceUserMessageId,
          sourceUserMessageText: params.deferToAsyncMediaJob.sourceUserMessageText,
          attachments: [],
          directToolExecution: {
            toolCode: IMAGE_GENERATE_TOOL_CODE,
            request
          }
        });
        if (!enqueueOutcome.accepted) {
          return {
            payload: {
              toolCode: IMAGE_GENERATE_TOOL_CODE,
              executionMode: "worker",
              provider: providerId,
              model: this.resolveToolModelKey(credential),
              prompt: request.prompt,
              revisedPrompt: null,
              requestedCount: request.count,
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
            toolCode: IMAGE_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: this.resolveToolModelKey(credential),
            prompt: request.prompt,
            revisedPrompt: null,
            requestedCount: request.count,
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
            toolCode: IMAGE_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            revisedPrompt: null,
            requestedCount: request.count,
            size: request.size,
            artifacts: [],
            usage: null,
            action: "skipped",
            reason: "runtime_degraded",
            warning:
              error instanceof Error
                ? error.message
                : "Deferred image generation could not be enqueued.",
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
        credential: {
          toolCode: IMAGE_GENERATE_TOOL_CODE,
          secretId: modelSelection.credential.secretRef.id,
          providerId
        }
      } as const;
      const runGenerateCall = async (prompt: string, count: number, requestIdSuffix = "") => {
        let effectivePrompt = prompt;
        let safetyRetryWarning: string | null = null;
        let providerResult: ProviderGatewayImageGenerateResult;
        try {
          providerResult = await this.providerGatewayClientService.generateImage(
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
            toolCode: IMAGE_GENERATE_TOOL_CODE,
            originalPrompt: prompt,
            failure: error
          });
          if (!rewriteOutcome.ok) {
            return {
              ok: false as const,
              payload: {
                toolCode: IMAGE_GENERATE_TOOL_CODE,
                executionMode: "worker" as const,
                provider: providerId,
                model: modelSelection.model,
                prompt: request.prompt,
                revisedPrompt: null,
                requestedCount: request.count,
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
            providerResult = await this.providerGatewayClientService.generateImage(
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
                toolCode: IMAGE_GENERATE_TOOL_CODE,
                executionMode: "worker" as const,
                provider: providerId,
                model: modelSelection.model,
                prompt: request.prompt,
                revisedPrompt: effectivePrompt,
                requestedCount: request.count,
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

      let accumulatedUsage: RuntimeUsageSnapshot | null = null;
      let accumulatedWarning: string | null = modelSelection.warning;
      let revisedPrompt: string | null = null;
      const persistedArtifacts: RuntimeOutputArtifact[] = [];
      const providerResult =
        request.outputMode === "series" && request.seriesItems !== null
          ? null
          : await runGenerateCall(request.prompt, request.count);

      if (providerResult !== null) {
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
            this.persistGeneratedArtifact({
              assistantId: params.bundle.metadata.assistantId,
              workspaceId: params.bundle.metadata.workspaceId,
              sessionId: params.sessionId,
              requestId: params.requestId,
              filenameHint: request.filename,
              requestPrompt: providerResult.effectivePrompt,
              image,
              index,
              billingFacts: providerResult.providerResult.billingFacts
            })
          )
        );
        persistedArtifacts.push(...artifacts);
      } else {
        const seriesItems = request.seriesItems ?? [];
        for (const [index, itemPrompt] of seriesItems.entries()) {
          const composedPrompt = `Series item ${String(index + 1)} of ${String(seriesItems.length)}. Overall request: ${request.prompt}\n\nThis item only: ${itemPrompt}`;
          const seriesResult = await runGenerateCall(
            composedPrompt,
            1,
            `:series:${String(index + 1)}`
          );
          if (!seriesResult.ok) {
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
              this.persistGeneratedArtifact({
                assistantId: params.bundle.metadata.assistantId,
                workspaceId: params.bundle.metadata.workspaceId,
                sessionId: params.sessionId,
                requestId: `${params.requestId}:series:${String(index + 1)}`,
                filenameHint: request.filename,
                requestPrompt: itemPrompt,
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
            toolCode: "image_generate",
            executionMode: "worker",
            provider: providerId,
            model: modelSelection.model,
            prompt: request.prompt,
            revisedPrompt: null,
            requestedCount: request.count,
            size: request.size,
            artifacts: [],
            usage: accumulatedUsage,
            action: "skipped",
            reason: "empty_result",
            warning: "Image provider returned no images."
          },
          artifacts: [],
          isError: true
        };
      }

      const warning =
        persistedArtifacts.length === request.count
          ? accumulatedWarning
          : this.mergeWarnings(
              accumulatedWarning,
              `Requested ${String(request.count)} image(s), received ${String(persistedArtifacts.length)}.`
            );
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: providerId,
          model: modelSelection.model,
          prompt: request.prompt,
          revisedPrompt,
          requestedCount: request.count,
          size: request.size,
          artifacts: persistedArtifacts,
          usage: accumulatedUsage,
          action: "generated",
          reason: null,
          warning
        },
        artifacts: persistedArtifacts,
        isError: false
      };
    } catch (error) {
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          requestedCount: request.count,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "image_generation_failed",
          warning: error instanceof Error ? error.message : "Image generation failed."
        },
        artifacts: [],
        isError: true
      };
    }
  }

  /**
   * ADR-105 — model-facing hint for an accepted async image-generation job.
   * It states the file is not in hand yet (`canSendFileNow: false`) and will
   * arrive in a separate delivery, so the model does not falsely claim to have
   * attached the image in this turn.
   */
  private buildPendingDeliveryMessageToUser(count: number): string {
    const noun = count > 1 ? `${String(count)} images` : "image";
    return `Accepted. The ${noun} cannot be attached in this reply; it is being prepared and will be delivered in a separate message when ready.`;
  }

  private readImageGenerateArguments(
    args: Record<string, unknown>
  ): RuntimeImageGenerateRequest | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) =>
        key !== "toolCode" &&
        key !== "prompt" &&
        key !== "count" &&
        key !== "outputMode" &&
        key !== "seriesItems" &&
        key !== "filename" &&
        key !== "size" &&
        key !== "background"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    if ("toolCode" in args && args.toolCode !== IMAGE_GENERATE_TOOL_CODE) {
      return new Error(`toolCode must be ${IMAGE_GENERATE_TOOL_CODE}`);
    }
    const prompt = this.asNonEmptyString(args.prompt);
    if (prompt === null) {
      return new Error("prompt must be a non-empty string");
    }

    const count =
      args.count === undefined || args.count === null
        ? 1
        : Number.isInteger(args.count) &&
            Number(args.count) >= MIN_RUNTIME_IMAGE_GENERATE_COUNT &&
            Number(args.count) <= MAX_RUNTIME_IMAGE_GENERATE_COUNT
          ? Number(args.count)
          : null;
    if (count === null) {
      return new Error(
        `count must be an integer between ${String(MIN_RUNTIME_IMAGE_GENERATE_COUNT)} and ${String(MAX_RUNTIME_IMAGE_GENERATE_COUNT)}`
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

    return {
      toolCode: "image_generate",
      prompt,
      count,
      outputMode,
      seriesItems,
      filename,
      size,
      background
    };
  }

  private async persistGeneratedArtifact(input: {
    assistantId: string;
    workspaceId: string;
    sessionId: string;
    requestId: string;
    filenameHint: string | null;
    requestPrompt: string;
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
    const artifactId = randomUUID();
    const extension = this.extensionFromMimeType(input.image.mimeType);
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
      mimeType: input.image.mimeType
    });
    const filename = this.resolveFilename(input.filenameHint, input.index, extension);
    const semanticSummary = buildGeneratedFileSemanticSummary({
      preferredText: input.image.revisedPrompt,
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
      kind: "image",
      sourceToolCode: IMAGE_GENERATE_TOOL_CODE,
      objectKey: stored.objectKey,
      mimeType: stored.mimeType,
      filename,
      sizeBytes: stored.sizeBytes,
      voiceNote: false,
      billingFacts: input.billingFacts ?? null
    };
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
  private resolveWorkerTimeoutMs(bundle: AssistantRuntimeBundle): number {
    const configured =
      bundle.runtime.workerTools.tools.find((tool) => tool.toolCode === IMAGE_GENERATE_TOOL_CODE)
        ?.timeoutMs ?? null;
    return Number.isInteger(configured) && Number(configured) > 0
      ? Number(configured)
      : DEFAULT_IMAGE_GENERATE_TIMEOUT_MS;
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

  private mergeWarnings(...warnings: Array<string | null | undefined>): string | null {
    const filtered = warnings.filter((warning): warning is string => typeof warning === "string");
    return filtered.length > 0 ? filtered.join(" ") : null;
  }

  private resolveImageGenerateProviderId(
    providerId: string | null
  ): PersaiRuntimeImageGenerateProviderId | null {
    const resolved = providerId ?? "openai";
    return PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS.includes(
      resolved as PersaiRuntimeImageGenerateProviderId
    )
      ? (resolved as PersaiRuntimeImageGenerateProviderId)
      : null;
  }

  private isImageGenerateSize(value: string): value is PersaiRuntimeImageGenerateSize {
    return PERSAI_RUNTIME_IMAGE_GENERATE_SIZES.includes(value as PersaiRuntimeImageGenerateSize);
  }

  private isImageBackground(value: string): value is PersaiRuntimeImageBackground {
    return PERSAI_RUNTIME_IMAGE_BACKGROUNDS.includes(value as PersaiRuntimeImageBackground);
  }

  private resolveFilename(
    filenameHint: string | null,
    index: number,
    extension: string
  ): string | null {
    const base = filenameHint?.trim() ?? "";
    if (base.length === 0) {
      return index === 0 ? `image.${extension}` : `image-${String(index + 1)}.${extension}`;
    }
    const sanitizedBase = base.replace(/[\\/:*?"<>|]+/g, "_");
    const withoutExt = sanitizedBase.replace(/\.[A-Za-z0-9]+$/g, "").trim() || "image";
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
}
