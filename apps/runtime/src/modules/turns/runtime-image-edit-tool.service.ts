import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
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

const SUPPORTED_IMAGE_EDIT_INPUT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    currentAttachments: RuntimeAttachmentRef[];
    sessionId: string;
    requestId: string;
  }): Promise<RuntimeImageEditToolExecutionResult> {
    const request = this.readImageEditArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: "image_edit",
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
          toolCode: "image_edit",
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

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, "image_edit");
    if (policy === null) {
      return {
        payload: {
          toolCode: "image_edit",
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

    const credential = this.resolveConfiguredCredentialRef(params.bundle, "image_edit");
    if (credential === null) {
      return {
        payload: {
          toolCode: "image_edit",
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
          toolCode: "image_edit",
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

    const selection = await this.resolveImageSelection(params.currentAttachments, request);
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

    try {
      if (policy.dailyCallLimit !== null) {
        const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
          assistantId: params.bundle.metadata.assistantId,
          toolCode: "image_edit",
          dailyCallLimit: policy.dailyCallLimit
        });
        if (!quotaOutcome.allowed) {
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
              reason: quotaOutcome.code,
              warning: quotaOutcome.message
            },
            artifacts: [],
            isError: false
          };
        }
      }

      const providerResult = await this.providerGatewayClientService.editImage({
        prompt: request.prompt,
        size: request.size,
        sourceImage: selection.sourceImage,
        referenceImage: selection.referenceImage,
        credential: {
          toolCode: "image_edit",
          secretId: credential.secretRef.id,
          providerId
        }
      });
      const artifacts = await Promise.all(
        providerResult.images.map((image, index) =>
          this.persistEditedArtifact({
            assistantId: params.bundle.metadata.assistantId,
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
          warning: providerResult.warning
        },
        artifacts,
        isError: false
      };
    } catch (error) {
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
        key !== "prompt" &&
        key !== "filename" &&
        key !== "size" &&
        key !== "sourceImageIndex" &&
        key !== "referenceImageIndex"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
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
        warning: "Attach an image in the current message before using image_edit."
      };
    }

    if (imageAttachments.length > 1 && request.sourceImageIndex === null) {
      return {
        ok: false,
        reason: "source_image_selection_required",
        warning:
          "Multiple images are attached. Ask the user which numbered image is the source image, or set sourceImageIndex when the source image is already clear."
      };
    }

    const sourceImageIndex = request.sourceImageIndex ?? 1;
    const sourceAttachment = imageAttachments[sourceImageIndex - 1] ?? null;
    if (sourceAttachment === null) {
      return {
        ok: false,
        reason: "source_image_index_invalid",
        warning: "sourceImageIndex must point to one of the current message image attachments."
      };
    }

    if (
      request.referenceImageIndex !== null &&
      (request.referenceImageIndex < 1 || request.referenceImageIndex > imageAttachments.length)
    ) {
      return {
        ok: false,
        reason: "reference_image_index_invalid",
        warning: "referenceImageIndex must point to one of the current message image attachments."
      };
    }

    if (request.referenceImageIndex !== null && request.referenceImageIndex === sourceImageIndex) {
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
      request.referenceImageIndex === null
        ? null
        : imageAttachments[request.referenceImageIndex - 1]!;
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
      sourceImageIndex,
      referenceImageIndex: request.referenceImageIndex,
      sourceFilename: sourceAttachment.filename,
      referenceFilename: referenceAttachment?.filename ?? null
    };
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

    return {
      artifactId,
      kind: "image",
      objectKey: stored.objectKey,
      mimeType: stored.mimeType,
      filename: this.resolveFilename(
        input.filenameHint,
        input.sourceFilename,
        input.index,
        extension
      ),
      sizeBytes: stored.sizeBytes,
      voiceNote: false
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
