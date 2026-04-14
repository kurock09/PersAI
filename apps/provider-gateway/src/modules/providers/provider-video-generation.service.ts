import { BadRequestException, Injectable } from "@nestjs/common";
import {
  PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS,
  isPersaiRuntimeVideoGenerateModelKey,
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  type PersaiRuntimeVideoGenerateModelKey,
  type PersaiRuntimeVideoGenerateProviderId,
  type ProviderGatewayVideoGenerateRequest,
  type ProviderGatewayVideoGenerateResult
} from "@persai/runtime-contract";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

@Injectable()
export class ProviderVideoGenerationService {
  constructor(
    private readonly openaiProviderClient: OpenAIProviderClient,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const normalized = this.normalizeInput(input);
    const apiKey = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    switch (normalized.credential.providerId ?? "openai") {
      case "openai":
        return this.openaiProviderClient.generateVideo(normalized, { apiKey });
    }
  }

  private normalizeInput(
    input: ProviderGatewayVideoGenerateRequest
  ): ProviderGatewayVideoGenerateRequest & {
    model: PersaiRuntimeVideoGenerateModelKey | null;
    referenceImage: {
      bytesBase64: string;
      mimeType: string;
      filename: string | null;
    } | null;
    credential: ProviderGatewayVideoGenerateRequest["credential"] & {
      providerId: PersaiRuntimeVideoGenerateProviderId | null;
    };
  } {
    if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
      throw new BadRequestException("prompt must be a non-empty string");
    }
    if (input.size !== null && !PERSAI_RUNTIME_VIDEO_GENERATE_SIZES.includes(input.size)) {
      throw new BadRequestException("size must be a supported video-generation size or null");
    }
    if (!PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS.includes(input.seconds)) {
      throw new BadRequestException(
        `seconds must be one of ${PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS.join(", ")}`
      );
    }
    if (input.credential.toolCode !== "video_generate") {
      throw new BadRequestException('credential.toolCode must be "video_generate"');
    }
    if (
      typeof input.credential.secretId !== "string" ||
      input.credential.secretId.trim().length === 0
    ) {
      throw new BadRequestException("credential.secretId must be a non-empty string");
    }
    if (
      input.credential.providerId !== null &&
      !PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS.includes(input.credential.providerId)
    ) {
      throw new BadRequestException(
        "credential.providerId must be a supported video-generation provider or null"
      );
    }

    const referenceImage =
      input.referenceImage === null || input.referenceImage === undefined
        ? null
        : this.normalizeReferenceImage(input.referenceImage);
    const model = this.normalizeModel(input.model);

    return {
      prompt: input.prompt.trim(),
      model,
      size: input.size,
      seconds: input.seconds,
      referenceImage,
      credential: {
        toolCode: "video_generate",
        secretId: input.credential.secretId.trim(),
        providerId: input.credential.providerId ?? null
      }
    };
  }

  private normalizeReferenceImage(input: ProviderGatewayVideoGenerateRequest["referenceImage"]): {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  } {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new BadRequestException("referenceImage must be an object");
    }
    if (typeof input.bytesBase64 !== "string" || input.bytesBase64.trim().length === 0) {
      throw new BadRequestException("referenceImage.bytesBase64 must be a non-empty string");
    }
    if (typeof input.mimeType !== "string" || input.mimeType.trim().length === 0) {
      throw new BadRequestException("referenceImage.mimeType must be a non-empty string");
    }

    const filename =
      input.filename === null || input.filename === undefined
        ? null
        : typeof input.filename === "string" && input.filename.trim().length > 0
          ? input.filename.trim()
          : null;
    if (input.filename !== undefined && input.filename !== null && filename === null) {
      throw new BadRequestException("referenceImage.filename must be a non-empty string or null");
    }

    return {
      bytesBase64: input.bytesBase64.trim(),
      mimeType: input.mimeType.trim(),
      filename
    };
  }

  private normalizeModel(
    input: ProviderGatewayVideoGenerateRequest["model"]
  ): PersaiRuntimeVideoGenerateModelKey | null {
    if (input === null || input === undefined) {
      return null;
    }
    const normalized = typeof input === "string" ? input.trim() : "";
    if (isPersaiRuntimeVideoGenerateModelKey(normalized)) {
      return normalized;
    }
    throw new BadRequestException(
      `model must be one of ${PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS.join(", ")}, or null`
    );
  }
}
