import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  type PersaiRuntimeImageGenerateProviderId,
  type PersaiRuntimeImageGenerateSize,
  type ProviderGatewayToolCall,
  type RuntimeImageGenerateRequest,
  type RuntimeImageGenerateToolResult,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";

export interface RuntimeImageGenerateToolExecutionResult {
  payload: RuntimeImageGenerateToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeImageGenerateToolService {
  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
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

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, "image_generate");
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

    const credential = this.resolveConfiguredCredentialRef(params.bundle, "image_generate");
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

    try {
      // ADR-074 L1.1 — always call the consumer endpoint, even when the
      // plan has no daily cap, so observability counts every billed
      // image. `units = request.count` so a single
      // `image_generate({ count: 4 })` advances the daily counter by 4
      // (matching the four artifacts OpenAI bills us for), instead of
      // by 1. The API rejects the *whole* batch if the requested count
      // would push the counter past a configured cap; we surface that
      // as a regular tool_quota_rejected outcome.
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "image_generate",
        dailyCallLimit: policy.dailyCallLimit,
        units: request.count
      });
      if (!quotaOutcome.allowed) {
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
            reason: quotaOutcome.code,
            warning: quotaOutcome.message
          },
          artifacts: [],
          isError: false
        };
      }

      const providerResult = await this.providerGatewayClientService.generateImage({
        prompt: request.prompt,
        count: request.count,
        size: request.size,
        credential: {
          toolCode: "image_generate",
          secretId: credential.secretRef.id,
          providerId
        }
      });
      const artifacts = await Promise.all(
        providerResult.images.map((image, index) =>
          this.persistGeneratedArtifact({
            assistantId: params.bundle.metadata.assistantId,
            sessionId: params.sessionId,
            requestId: params.requestId,
            filenameHint: request.filename,
            image,
            index
          })
        )
      );
      if (artifacts.length === 0) {
        return {
          payload: {
            toolCode: "image_generate",
            executionMode: "worker",
            provider: providerId,
            model: providerResult.model,
            prompt: request.prompt,
            revisedPrompt: null,
            requestedCount: request.count,
            size: request.size,
            artifacts: [],
            usage: providerResult.usage,
            action: "skipped",
            reason: "empty_result",
            warning: "Image provider returned no images."
          },
          artifacts: [],
          isError: true
        };
      }

      const revisedPrompt =
        providerResult.images.find((image) => image.revisedPrompt !== null)?.revisedPrompt ?? null;
      const warning =
        providerResult.images.length === request.count
          ? providerResult.warning
          : `Requested ${String(request.count)} image(s), received ${String(providerResult.images.length)}.`;
      return {
        payload: {
          toolCode: "image_generate",
          executionMode: "worker",
          provider: providerId,
          model: providerResult.model,
          prompt: request.prompt,
          revisedPrompt,
          requestedCount: request.count,
          size: request.size,
          artifacts,
          usage: providerResult.usage,
          action: "generated",
          reason: null,
          warning
        },
        artifacts,
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

  private readImageGenerateArguments(
    args: Record<string, unknown>
  ): RuntimeImageGenerateRequest | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) => key !== "prompt" && key !== "count" && key !== "filename" && key !== "size"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
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

    return {
      toolCode: "image_generate",
      prompt,
      count,
      filename,
      size
    };
  }

  private async persistGeneratedArtifact(input: {
    assistantId: string;
    sessionId: string;
    requestId: string;
    filenameHint: string | null;
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
      filename: this.resolveFilename(input.filenameHint, input.index, extension),
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
