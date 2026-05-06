import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_IMAGE_BACKGROUNDS,
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  type PersaiRuntimeImageBackground,
  type PersaiRuntimeImageEditProviderId,
  type PersaiRuntimeImageGenerateSize,
  type ProviderGatewayToolCall,
  type RuntimeAttachmentRef,
  type RuntimeImageEditRequest,
  type RuntimeImageEditToolResult,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { selectMediaModelForRequest } from "./media-model-routing";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";

const IMAGE_EDIT_TOOL_CODE = "image_edit" as const;
const DEFAULT_IMAGE_EDIT_TIMEOUT_MS = 300_000;
const SUPPORTED_IMAGE_EDIT_INPUT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SECOND_IMAGE_REFERENCE_PROMPT_MARKERS = [
  "second image",
  "second photo",
  "2nd image",
  "2nd photo",
  "image #2",
  "photo #2",
  "как на втором фото",
  "как на второй картинке",
  "как на втором",
  "второе фото",
  "вторая картинка",
  "второй картинке",
  "со второго фото",
  "из второго фото",
  "reference image",
  "reference photo",
  "референс",
  "по рефу",
  "как реф",
  "как на рефе",
  "по референсу"
] as const;

type ResolvedImageEditSelection =
  | {
      ok: true;
      sourceImage: {
        bytesBase64: string;
        mimeType: string;
        filename: string | null;
      };
      referenceImage: {
        bytesBase64: string;
        mimeType: string;
        filename: string | null;
      } | null;
      sourceImageIndex: number;
      referenceImageIndex: number | null;
      sourceFilename: string | null;
      referenceFilename: string | null;
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
  }): Promise<RuntimeImageEditToolExecutionResult> {
    const request = this.readImageEditArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: IMAGE_EDIT_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: null,
          revisedPrompt: null,
          sourceImageIndex: null,
          referenceImageIndex: null,
          sourceFilename: null,
          referenceFilename: null,
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

    if (this.isLikelyAnalysisOnlyPrompt(request.prompt)) {
      return {
        payload: {
          toolCode: IMAGE_EDIT_TOOL_CODE,
          executionMode: "worker",
          provider: null,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          sourceImageIndex: request.sourceImageIndex,
          referenceImageIndex: request.referenceImageIndex,
          sourceFilename: null,
          referenceFilename: null,
          size: request.size,
          artifacts: [],
          usage: null,
          action: "skipped",
          reason: "edit_intent_not_explicit",
          warning:
            "image_edit only runs when the user explicitly asks to modify an image, not for image description or problem solving."
        },
        artifacts: [],
        isError: false
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
          sourceImageIndex: request.sourceImageIndex,
          referenceImageIndex: request.referenceImageIndex,
          sourceFilename: null,
          referenceFilename: null,
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
          sourceImageIndex: request.sourceImageIndex,
          referenceImageIndex: request.referenceImageIndex,
          sourceFilename: null,
          referenceFilename: null,
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
          sourceImageIndex: request.sourceImageIndex,
          referenceImageIndex: request.referenceImageIndex,
          sourceFilename: null,
          referenceFilename: null,
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
          sourceImageIndex: request.sourceImageIndex,
          referenceImageIndex: request.referenceImageIndex,
          sourceFilename: null,
          referenceFilename: null,
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

    const selection = await this.resolveImageSelection(params.availableAttachments, request);
    if (!selection.ok) {
      return {
        payload: {
          toolCode: "image_edit",
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          sourceImageIndex: request.sourceImageIndex,
          referenceImageIndex: request.referenceImageIndex,
          sourceFilename: null,
          referenceFilename: null,
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
              sourceImageIndex: selection.sourceImageIndex,
              referenceImageIndex: selection.referenceImageIndex,
              sourceFilename: selection.sourceFilename,
              referenceFilename: selection.referenceFilename,
              size: request.size,
              artifacts: [],
              usage: null,
              action: "skipped",
              reason: enqueueOutcome.code,
              warning: enqueueOutcome.message,
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
            sourceImageIndex: selection.sourceImageIndex,
            referenceImageIndex: selection.referenceImageIndex,
            sourceFilename: selection.sourceFilename,
            referenceFilename: selection.referenceFilename,
            size: request.size,
            artifacts: [],
            usage: null,
            action: "deferred",
            reason: null,
            warning: null,
            jobId: enqueueOutcome.jobId
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
            sourceImageIndex: selection.sourceImageIndex,
            referenceImageIndex: selection.referenceImageIndex,
            sourceFilename: selection.sourceFilename,
            referenceFilename: selection.referenceFilename,
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
      const quotaOutcome = await this.persaiInternalApiClientService.reserveMonthlyMediaQuota({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: IMAGE_EDIT_TOOL_CODE,
        units: 1
      });
      if (!quotaOutcome.allowed) {
        return {
          payload: {
            toolCode: IMAGE_EDIT_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            revisedPrompt: null,
            sourceImageIndex: selection.sourceImageIndex,
            referenceImageIndex: selection.referenceImageIndex,
            sourceFilename: selection.sourceFilename,
            referenceFilename: selection.referenceFilename,
            size: request.size,
            artifacts: [],
            usage: null,
            action: "skipped",
            reason: quotaOutcome.code,
            warning: quotaOutcome.message
          },
          artifacts: [],
          isError: false
        };
      }

      const timeoutMs = this.resolveWorkerTimeoutMs(params.bundle);
      const providerResult = await this.providerGatewayClientService.editImage(
        {
          prompt: request.prompt,
          model: modelSelection.model,
          size: request.size,
          background: request.background,
          sourceImage: selection.sourceImage,
          referenceImage: selection.referenceImage,
          credential: {
            toolCode: IMAGE_EDIT_TOOL_CODE,
            secretId: modelSelection.credential.secretRef.id,
            providerId
          }
        },
        {
          timeoutMs
        }
      );
      this.logger.log(
        `[image-edit] requestId=${params.requestId} provider=${providerId} sourceIndex=${String(
          selection.sourceImageIndex
        )} referenceIndex=${selection.referenceImageIndex === null ? "none" : String(selection.referenceImageIndex)}`
      );
      const artifacts = await Promise.all(
        providerResult.images.map((image, index) =>
          this.persistEditedArtifact({
            assistantId: params.bundle.metadata.assistantId,
            workspaceId: params.bundle.metadata.workspaceId,
            sessionId: params.sessionId,
            requestId: params.requestId,
            filenameHint: request.filename,
            sourceFilename: selection.sourceFilename,
            image,
            index
          })
        )
      );
      if (artifacts.length === 0) {
        await this.releaseMonthlyMediaQuotaReservationBestEffort({
          assistantId: params.bundle.metadata.assistantId
        });
        return {
          payload: {
            toolCode: "image_edit",
            executionMode: "worker",
            provider: providerId,
            model: providerResult.model,
            prompt: request.prompt,
            revisedPrompt: null,
            sourceImageIndex: selection.sourceImageIndex,
            referenceImageIndex: selection.referenceImageIndex,
            sourceFilename: selection.sourceFilename,
            referenceFilename: selection.referenceFilename,
            size: request.size,
            artifacts: [],
            usage: providerResult.usage,
            action: "skipped",
            reason: "empty_result",
            warning: "Image-edit provider returned no images."
          },
          artifacts: [],
          isError: true
        };
      }

      const revisedPrompt =
        providerResult.images.find((image) => image.revisedPrompt !== null)?.revisedPrompt ?? null;
      this.logger.log(
        `[image-edit] completed requestId=${params.requestId} provider=${providerId} artifacts=${String(
          artifacts.length
        )} sourceIndex=${String(selection.sourceImageIndex)} referenceIndex=${
          selection.referenceImageIndex === null ? "none" : String(selection.referenceImageIndex)
        }`
      );
      return {
        payload: {
          toolCode: "image_edit",
          executionMode: "worker",
          provider: providerId,
          model: providerResult.model,
          prompt: request.prompt,
          revisedPrompt,
          sourceImageIndex: selection.sourceImageIndex,
          referenceImageIndex: selection.referenceImageIndex,
          sourceFilename: selection.sourceFilename,
          referenceFilename: selection.referenceFilename,
          size: request.size,
          artifacts,
          usage: providerResult.usage,
          action: "generated",
          reason: null,
          warning: this.mergeWarnings(modelSelection.warning, providerResult.warning)
        },
        artifacts,
        isError: false
      };
    } catch (error) {
      await this.releaseMonthlyMediaQuotaReservationBestEffort({
        assistantId: params.bundle.metadata.assistantId
      });
      this.logger.warn(
        `[image-edit] failed requestId=${params.requestId} sourceIndex=${String(
          selection.sourceImageIndex
        )} referenceIndex=${selection.referenceImageIndex === null ? "none" : String(selection.referenceImageIndex)}: ${
          error instanceof Error ? error.message : "Image edit failed."
        }`
      );
      return {
        payload: {
          toolCode: "image_edit",
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          revisedPrompt: null,
          sourceImageIndex: selection.sourceImageIndex,
          referenceImageIndex: selection.referenceImageIndex,
          sourceFilename: selection.sourceFilename,
          referenceFilename: selection.referenceFilename,
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

  private readImageEditArguments(args: Record<string, unknown>): RuntimeImageEditRequest | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) =>
        key !== "toolCode" &&
        key !== "prompt" &&
        key !== "filename" &&
        key !== "size" &&
        key !== "background" &&
        key !== "sourceImageIndex" &&
        key !== "referenceImageIndex"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    if ("toolCode" in args && args.toolCode !== IMAGE_EDIT_TOOL_CODE) {
      return new Error(`toolCode must be ${IMAGE_EDIT_TOOL_CODE}`);
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

    const sourceImageIndex = this.readOptionalPositiveImageIndex(args.sourceImageIndex);
    if ("sourceImageIndex" in args && args.sourceImageIndex !== null && sourceImageIndex === null) {
      return new Error("sourceImageIndex must be a positive integer when provided");
    }

    const referenceImageIndex = this.readOptionalPositiveImageIndex(args.referenceImageIndex);
    if (
      "referenceImageIndex" in args &&
      args.referenceImageIndex !== null &&
      referenceImageIndex === null
    ) {
      return new Error("referenceImageIndex must be a positive integer when provided");
    }

    return {
      toolCode: "image_edit",
      prompt,
      filename,
      size,
      background,
      sourceImageIndex,
      referenceImageIndex
    };
  }

  private async resolveImageSelection(
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

    const inferredSelection =
      request.sourceImageIndex === null || request.referenceImageIndex === null
        ? this.inferReferenceGuidedSelection(imageAttachments.length, request)
        : null;
    if (inferredSelection !== null) {
      this.logger.log(
        `[image-edit] inferred source/reference from prompt sourceIndex=${String(
          inferredSelection.sourceImageIndex
        )} referenceIndex=${String(inferredSelection.referenceImageIndex)}`
      );
    }
    const sourceImageIndex = inferredSelection?.sourceImageIndex ?? request.sourceImageIndex;
    const referenceImageIndex =
      inferredSelection?.referenceImageIndex ?? request.referenceImageIndex;

    if (imageAttachments.length > 1 && sourceImageIndex === null) {
      return {
        ok: false,
        reason: "source_image_selection_required",
        warning:
          "Multiple images are attached. Ask the user which numbered image is the source image, or set sourceImageIndex when the source image is already clear."
      };
    }

    const resolvedSourceImageIndex = sourceImageIndex ?? 1;
    const sourceAttachment = imageAttachments[resolvedSourceImageIndex - 1] ?? null;
    if (sourceAttachment === null) {
      return {
        ok: false,
        reason: "source_image_index_invalid",
        warning: "sourceImageIndex must point to one of the available chat image attachments."
      };
    }

    if (
      referenceImageIndex !== null &&
      (referenceImageIndex < 1 || referenceImageIndex > imageAttachments.length)
    ) {
      return {
        ok: false,
        reason: "reference_image_index_invalid",
        warning: "referenceImageIndex must point to one of the available chat image attachments."
      };
    }

    if (referenceImageIndex !== null && referenceImageIndex === resolvedSourceImageIndex) {
      return {
        ok: false,
        reason: "reference_image_same_as_source",
        warning: "referenceImageIndex must refer to a different image than sourceImageIndex."
      };
    }

    const loadedSource = await this.loadSelectedImage(sourceAttachment, "source");
    if (!loadedSource.ok) {
      return loadedSource;
    }

    const referenceAttachment =
      referenceImageIndex === null ? null : imageAttachments[referenceImageIndex - 1]!;
    const loadedReference =
      referenceAttachment === null
        ? null
        : await this.loadSelectedImage(referenceAttachment, "reference");
    if (loadedReference !== null && !loadedReference.ok) {
      return loadedReference;
    }

    return {
      ok: true,
      sourceImage: loadedSource.image,
      referenceImage: loadedReference?.image ?? null,
      sourceImageIndex: resolvedSourceImageIndex,
      referenceImageIndex,
      sourceFilename: sourceAttachment.filename,
      referenceFilename: referenceAttachment?.filename ?? null
    };
  }

  private inferReferenceGuidedSelection(
    imageAttachmentCount: number,
    request: RuntimeImageEditRequest
  ): { sourceImageIndex: number; referenceImageIndex: number } | null {
    if (imageAttachmentCount !== 2) {
      return null;
    }
    const normalizedPrompt = request.prompt.trim().toLowerCase();
    const mentionsSecondImageAsReference = SECOND_IMAGE_REFERENCE_PROMPT_MARKERS.some((marker) =>
      normalizedPrompt.includes(marker)
    );
    if (!mentionsSecondImageAsReference) {
      return null;
    }
    if (request.sourceImageIndex === null && request.referenceImageIndex === null) {
      return {
        sourceImageIndex: 1,
        referenceImageIndex: 2
      };
    }
    if (request.sourceImageIndex === 1 && request.referenceImageIndex === null) {
      return {
        sourceImageIndex: 1,
        referenceImageIndex: 2
      };
    }
    if (request.sourceImageIndex === null && request.referenceImageIndex === 2) {
      return {
        sourceImageIndex: 1,
        referenceImageIndex: 2
      };
    }
    return null;
  }

  private async loadSelectedImage(
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

    const buffer = await this.mediaObjectStorage.downloadObject(attachment.objectKey);
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
        filename: attachment.filename
      }
    };
  }

  private async persistEditedArtifact(input: {
    assistantId: string;
    workspaceId: string;
    sessionId: string;
    requestId: string;
    filenameHint: string | null;
    sourceFilename: string | null;
    image: {
      bytesBase64: string;
      mimeType: string;
      revisedPrompt: string | null;
    };
    index: number;
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
    const filename = this.resolveFilename(
      input.filenameHint,
      input.sourceFilename,
      input.index,
      extension
    );
    const file = await this.runtimeAssistantFileRegistryService.ensureAttachmentBackedFile({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      origin: "runtime_output",
      referenceId: artifactId,
      objectKey: stored.objectKey,
      filename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes
    });
    const runtimeFileRef = this.runtimeAssistantFileRegistryService.toRuntimeFileRef(file);

    return {
      artifactId,
      fileRef: runtimeFileRef.fileRef,
      file: runtimeFileRef,
      kind: "image",
      sourceToolCode: IMAGE_EDIT_TOOL_CODE,
      objectKey: stored.objectKey,
      mimeType: stored.mimeType,
      filename,
      sizeBytes: stored.sizeBytes,
      voiceNote: false
    };
  }

  private async releaseMonthlyMediaQuotaReservationBestEffort(input: {
    assistantId: string;
  }): Promise<void> {
    try {
      await this.persaiInternalApiClientService.releaseMonthlyMediaQuota({
        assistantId: input.assistantId,
        toolCode: IMAGE_EDIT_TOOL_CODE,
        units: 1
      });
    } catch (error) {
      this.logger.warn(
        `[image-edit] failed to release monthly media quota reservation: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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

  private readOptionalPositiveImageIndex(value: unknown): number | null {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
  }

  private isLikelyAnalysisOnlyPrompt(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase();
    const analysisMarkers = [
      "what do you see",
      "what is in this image",
      "describe this image",
      "describe the image",
      "analyze this image",
      "solve the task",
      "solve this task",
      "read the text",
      "extract the text",
      "ocr",
      "что ты видишь",
      "что изображено",
      "опиши",
      "проанализируй",
      "реши задачу",
      "прочитай текст",
      "извлеки текст"
    ];
    return analysisMarkers.some((marker) => normalized.includes(marker));
  }
}
