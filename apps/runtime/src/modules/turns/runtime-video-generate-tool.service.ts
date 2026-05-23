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
  type ProviderGatewayVideoGenerateRequest,
  type RuntimeAttachmentRef,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy,
  type RuntimeVideoGenerateRequest,
  type RuntimeVideoGenerateToolResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { buildGeneratedFileSemanticSummary } from "./generated-file-semantic-summary";
import { selectMediaModelForRequest } from "./media-model-routing";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";

const VIDEO_GENERATE_TOOL_CODE = "video_generate" as const;
const DEFAULT_VIDEO_GENERATE_TIMEOUT_MS = 600_000;
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
      referenceImageAlias: string | null;
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
    const modelSelection = selectMediaModelForRequest({
      toolCode: VIDEO_GENERATE_TOOL_CODE,
      credential
    });
    if ("reason" in modelSelection) {
      return {
        payload: {
          toolCode: VIDEO_GENERATE_TOOL_CODE,
          executionMode: "worker",
          provider: providerId,
          model: this.resolveVideoGenerateModelKey(credential),
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: request.size,
          referenceImageAlias: request.referenceImageAlias,
          referenceFilename: null,
          artifact: null,
          usage: null,
          action: "skipped",
          reason: modelSelection.reason,
          warning: modelSelection.warning
        },
        artifacts: [],
        isError: false
      };
    }

    const selection = await this.resolveReferenceImageSelection(
      params.availableAttachments,
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
              model: this.resolveVideoGenerateModelKey(credential),
              prompt: request.prompt,
              requestedSeconds: request.seconds,
              size: request.size,
              referenceImageAlias: selection.referenceImageAlias,
              referenceFilename: selection.referenceFilename,
              artifact: null,
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
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: this.resolveVideoGenerateModelKey(credential),
            prompt: request.prompt,
            requestedSeconds: request.seconds,
            size: request.size,
            referenceImageAlias: selection.referenceImageAlias,
            referenceFilename: selection.referenceFilename,
            artifact: null,
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
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            executionMode: "worker",
            provider: providerId,
            model: null,
            prompt: request.prompt,
            requestedSeconds: request.seconds,
            size: request.size,
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

    try {
      const quotaOutcome = await this.persaiInternalApiClientService.reserveMonthlyMediaQuota({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: VIDEO_GENERATE_TOOL_CODE,
        units: 1
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
            referenceImageAlias: selection.referenceImageAlias,
            referenceFilename: selection.referenceFilename,
            artifact: null,
            usage: null,
            action: "skipped",
            reason: quotaOutcome.code,
            warning: quotaOutcome.message,
            ...(quotaOutcome.guidance === null ? {} : { guidance: quotaOutcome.guidance })
          },
          artifacts: [],
          isError: false
        };
      }

      const providerResult = await this.providerGatewayClientService.generateVideo(
        {
          prompt: request.prompt,
          model: modelSelection.model,
          size: request.size,
          seconds: request.seconds,
          referenceImage: selection.referenceImage,
          credential: {
            toolCode: VIDEO_GENERATE_TOOL_CODE,
            secretId: modelSelection.credential.secretRef.id,
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
          provider: providerId,
          model: providerResult.model,
          prompt: request.prompt,
          requestedSeconds: request.seconds,
          size: providerResult.size ?? request.size,
          referenceImageAlias: selection.referenceImageAlias,
          referenceFilename: selection.referenceFilename,
          artifact,
          usage: providerResult.usage,
          action: "generated",
          reason: null,
          warning: this.mergeWarnings(modelSelection.warning, providerResult.warning)
        },
        artifacts: [artifact],
        isError: false
      };
    } catch (error) {
      await this.releaseMonthlyMediaQuotaReservationBestEffort({
        assistantId: params.bundle.metadata.assistantId
      });
      this.logger.warn(
        `[video-generate] failed requestId=${params.requestId} referenceAlias="${
          selection.referenceImageAlias ?? "none"
        }": ${error instanceof Error ? error.message : "Video generation failed."}`
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
          referenceImageAlias: selection.referenceImageAlias,
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
        ? 4
        : Number.isInteger(args.seconds) && this.isVideoGenerateSeconds(Number(args.seconds))
          ? Number(args.seconds)
          : null;
    if (seconds === null) {
      return new Error(
        `seconds must be one of ${PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS.join(", ")}`
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

    return {
      toolCode: VIDEO_GENERATE_TOOL_CODE,
      prompt,
      filename,
      size,
      seconds: seconds as PersaiRuntimeVideoGenerateSeconds,
      referenceImageAlias
    };
  }

  private async resolveReferenceImageSelection(
    attachments: RuntimeAttachmentRef[],
    request: RuntimeVideoGenerateRequest,
    requestId: string
  ): Promise<ResolvedVideoReferenceSelection> {
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    let referenceImageAlias = request.referenceImageAlias;
    if (referenceImageAlias === null) {
      const inferred = this.inferReferenceImageAlias(imageAttachments, request.prompt);
      if (inferred === "missing") {
        return {
          ok: false,
          reason: "reference_image_missing",
          warning:
            "The prompt implies a reference image, but no recent chat image attachment is available."
        };
      }
      if (inferred === "selection_required") {
        return {
          ok: false,
          reason: "reference_image_alias_required",
          warning:
            "Multiple reusable images are available. Ask the user which image alias should guide the generated video."
        };
      }
      if (typeof inferred === "string") {
        referenceImageAlias = inferred;
        this.logger.log(
          `[video-generate] inferred reference image alias="${referenceImageAlias}" requestId=${requestId}`
        );
      }
    }

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

  private inferReferenceImageAlias(
    imageAttachments: RuntimeAttachmentRef[],
    prompt: string
  ): string | "missing" | "selection_required" | null {
    if (!this.promptImpliesReferenceImage(prompt)) {
      return null;
    }
    if (imageAttachments.length === 0) {
      return "missing";
    }
    if (imageAttachments.length === 1) {
      return this.resolvePrimaryAttachmentAlias(imageAttachments[0]!);
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

  private async releaseMonthlyMediaQuotaReservationBestEffort(input: {
    assistantId: string;
  }): Promise<void> {
    try {
      await this.persaiInternalApiClientService.releaseMonthlyMediaQuota({
        assistantId: input.assistantId,
        toolCode: VIDEO_GENERATE_TOOL_CODE,
        units: 1
      });
    } catch (error) {
      this.logger.warn(
        `[video-generate] failed to release monthly media quota reservation: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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
