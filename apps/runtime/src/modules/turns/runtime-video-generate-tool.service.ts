import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  type PersaiRuntimeVideoGenerateProviderId,
  type PersaiRuntimeVideoGenerateSeconds,
  type PersaiRuntimeVideoGenerateSize,
  type ProviderGatewayToolCall,
  type RuntimeAttachmentRef,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy,
  type RuntimeVideoGenerateRequest,
  type RuntimeVideoGenerateToolResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";

const VIDEO_GENERATE_TOOL_CODE = "video_generate" as const;
const DEFAULT_VIDEO_GENERATE_TIMEOUT_MS = 300_000;
const SUPPORTED_VIDEO_REFERENCE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp"
]);
const REFERENCE_IMAGE_PROMPT_MARKERS = [
  "reference image",
  "reference photo",
  "attached image",
  "attached photo",
  "this image",
  "this photo",
  "animate this image",
  "animate this photo",
  "turn this image into",
  "turn this photo into",
  "use the image as reference",
  "use the photo as reference",
  "по рефу",
  "по референсу",
  "референс",
  "эту картинку",
  "эту фотографию",
  "анимируй это фото",
  "анимируй эту картинку",
  "сделай видео по фото"
] as const;

type ResolvedVideoReferenceSelection =
  | {
      ok: true;
      referenceImage: {
        bytesBase64: string;
        mimeType: string;
        filename: string | null;
      } | null;
      referenceImageIndex: number | null;
      referenceFilename: string | null;
    }
  | {
      ok: false;
      reason: string;
      warning: string;
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
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    currentAttachments: RuntimeAttachmentRef[];
    sessionId: string;
    requestId: string;
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
          referenceImageIndex: null,
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
          referenceImageIndex: request.referenceImageIndex,
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
          referenceImageIndex: request.referenceImageIndex,
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
          referenceImageIndex: request.referenceImageIndex,
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

    const selection = await this.resolveReferenceImageSelection(
      params.currentAttachments,
      request,
      params.requestId
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
          referenceImageIndex: request.referenceImageIndex,
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

    try {
      if (policy.dailyCallLimit !== null) {
        const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
          assistantId: params.bundle.metadata.assistantId,
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          dailyCallLimit: policy.dailyCallLimit
        });
        if (!quotaOutcome.allowed) {
          return {
            payload: {
              toolCode: VIDEO_GENERATE_TOOL_CODE,
              executionMode: "worker",
              provider: providerId,
              model: null,
              prompt: request.prompt,
              requestedSeconds: request.seconds,
              size: request.size,
              referenceImageIndex: selection.referenceImageIndex,
              referenceFilename: selection.referenceFilename,
              artifact: null,
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

      const providerResult = await this.providerGatewayClientService.generateVideo(
        {
          prompt: request.prompt,
          size: request.size,
          seconds: request.seconds,
          referenceImage: selection.referenceImage,
          credential: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            secretId: credential.secretRef.id,
            providerId
          }
        },
        {
          timeoutMs: this.resolveWorkerTimeoutMs(params.bundle)
        }
      );
      this.logger.log(
        `[video-generate] requestId=${params.requestId} provider=${providerId} seconds=${String(
          request.seconds
        )} referenceIndex=${selection.referenceImageIndex === null ? "none" : String(selection.referenceImageIndex)}`
      );

      const artifact = await this.persistGeneratedArtifact({
        assistantId: params.bundle.metadata.assistantId,
        sessionId: params.sessionId,
        requestId: params.requestId,
        filenameHint: request.filename,
        referenceFilename: selection.referenceFilename,
        video: providerResult.video
      });

      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: providerResult.model,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: providerResult.size ?? request.size,
          referenceImageIndex: selection.referenceImageIndex,
          referenceFilename: selection.referenceFilename,
          artifact,
          usage: providerResult.usage,
          action: "generated",
          reason: null,
          warning: providerResult.warning
        },
        artifacts: [artifact],
        isError: false
      };
    } catch (error) {
      this.logger.warn(
        `[video-generate] failed requestId=${params.requestId} referenceIndex=${
          selection.referenceImageIndex === null ? "none" : String(selection.referenceImageIndex)
        }: ${error instanceof Error ? error.message : "Video generation failed."}`
      );
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: null,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: request.size,
          referenceImageIndex: selection.referenceImageIndex,
          referenceFilename: selection.referenceFilename,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: "video_generation_failed",
          warning: error instanceof Error ? error.message : "Video generation failed."
        },
        artifacts: [],
        isError: true
      };
    }
  }

  private readVideoGenerateArguments(
    args: Record<string, unknown>
  ): RuntimeVideoGenerateRequest | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) =>
        key !== "prompt" &&
        key !== "filename" &&
        key !== "size" &&
        key !== "seconds" &&
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
        ? 4
        : Number.isInteger(args.seconds) && this.isVideoGenerateSeconds(Number(args.seconds))
          ? Number(args.seconds)
          : null;
    if (seconds === null) {
      return new Error(
        `seconds must be one of ${PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS.join(", ")}`
      );
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
      toolCode: VIDEO_GENERATE_TOOL_CODE,
      prompt,
      filename,
      size,
      seconds: seconds as PersaiRuntimeVideoGenerateSeconds,
      referenceImageIndex
    };
  }

  private async resolveReferenceImageSelection(
    attachments: RuntimeAttachmentRef[],
    request: RuntimeVideoGenerateRequest,
    requestId: string
  ): Promise<ResolvedVideoReferenceSelection> {
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    let referenceImageIndex = request.referenceImageIndex;
    if (referenceImageIndex === null) {
      const inferred = this.inferReferenceImageIndex(imageAttachments.length, request.prompt);
      if (inferred === "missing") {
        return {
          ok: false,
          reason: "reference_image_missing",
          warning:
            "The prompt implies a reference image, but no current-turn image attachment is available."
        };
      }
      if (inferred === "selection_required") {
        return {
          ok: false,
          reason: "reference_image_selection_required",
          warning:
            "Multiple images are attached. Set referenceImageIndex to the numbered image that should guide the generated video."
        };
      }
      if (typeof inferred === "number") {
        referenceImageIndex = inferred;
        this.logger.log(
          `[video-generate] inferred reference image index=${String(referenceImageIndex)} requestId=${requestId}`
        );
      }
    }

    if (referenceImageIndex === null) {
      return {
        ok: true,
        referenceImage: null,
        referenceImageIndex: null,
        referenceFilename: null
      };
    }

    if (imageAttachments.length === 0) {
      return {
        ok: false,
        reason: "reference_image_missing",
        warning: "Attach an image in the current message before using referenceImageIndex."
      };
    }

    const attachment = imageAttachments[referenceImageIndex - 1] ?? null;
    if (attachment === null) {
      return {
        ok: false,
        reason: "reference_image_index_invalid",
        warning: "referenceImageIndex must point to one of the current message image attachments."
      };
    }

    const loadedReference = await this.loadReferenceImage(attachment);
    if (!loadedReference.ok) {
      return loadedReference;
    }

    return {
      ok: true,
      referenceImage: loadedReference.image,
      referenceImageIndex,
      referenceFilename: attachment.filename
    };
  }

  private inferReferenceImageIndex(
    imageAttachmentCount: number,
    prompt: string
  ): number | "missing" | "selection_required" | null {
    if (!this.promptImpliesReferenceImage(prompt)) {
      return null;
    }
    if (imageAttachmentCount === 0) {
      return "missing";
    }
    if (imageAttachmentCount === 1) {
      return 1;
    }
    return "selection_required";
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
          "video_generate currently supports PNG, JPEG, and WebP current-turn reference images."
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
    sessionId: string;
    requestId: string;
    filenameHint: string | null;
    referenceFilename: string | null;
    video: {
      bytesBase64: string;
      mimeType: string;
    };
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

    return {
      artifactId,
      kind: "video",
      objectKey: stored.objectKey,
      mimeType: stored.mimeType,
      filename: this.resolveFilename(input.filenameHint, input.referenceFilename, extension),
      sizeBytes: stored.sizeBytes,
      voiceNote: false
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

  private normalizeReferenceImageMimeType(mimeType: string): string | null {
    const normalized = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    return SUPPORTED_VIDEO_REFERENCE_IMAGE_MIME_TYPES.has(normalized) ? normalized : null;
  }

  private promptImpliesReferenceImage(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase();
    return REFERENCE_IMAGE_PROMPT_MARKERS.some((marker) => normalized.includes(marker));
  }

  private isVideoGenerateSize(value: string): value is PersaiRuntimeVideoGenerateSize {
    return PERSAI_RUNTIME_VIDEO_GENERATE_SIZES.includes(value as PersaiRuntimeVideoGenerateSize);
  }

  private isVideoGenerateSeconds(value: number): value is PersaiRuntimeVideoGenerateSeconds {
    return PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS.includes(
      value as PersaiRuntimeVideoGenerateSeconds
    );
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

  private readOptionalPositiveImageIndex(value: unknown): number | null {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
  }
}
