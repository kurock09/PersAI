import { BadRequestException, Injectable } from "@nestjs/common";
import {
  PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS,
  PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  isPersaiRuntimeVideoGenerateModelKey,
  type PersaiRuntimeVideoGenerateProviderId,
  type ProviderGatewayVideoGenerateRequest,
  type ProviderGatewayVideoGenerateResult
} from "@persai/runtime-contract";
import { KlingProviderClient } from "./kling/kling-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { RunwayProviderClient } from "./runway/runway-provider.client";

@Injectable()
export class ProviderVideoGenerationService {
  constructor(
    private readonly openaiProviderClient: OpenAIProviderClient,
    private readonly runwayProviderClient: RunwayProviderClient,
    private readonly klingProviderClient: KlingProviderClient,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const normalized = this.normalizeInput(input);
    const credentialValue = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    switch (normalized.credential.providerId ?? "openai") {
      case "openai":
        return this.openaiProviderClient.generateVideo(normalized, { apiKey: credentialValue });
      case "runway":
        return this.runwayProviderClient.generateVideo(normalized, { apiKey: credentialValue });
      case "kling":
        return this.klingProviderClient.generateVideo(normalized, { credentialValue });
    }
  }

  private normalizeInput(
    input: ProviderGatewayVideoGenerateRequest
  ): ProviderGatewayVideoGenerateRequest & {
    model: string | null;
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
    if (!Number.isInteger(input.seconds) || input.seconds <= 0) {
      throw new BadRequestException("seconds must be a positive integer");
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

    const providerId = input.credential.providerId ?? null;
    const referenceImage =
      input.referenceImage === null || input.referenceImage === undefined
        ? null
        : this.normalizeReferenceImage(input.referenceImage);
    const model = this.normalizeModel(input.model, providerId);

    return {
      prompt: input.prompt.trim(),
      model,
      size: input.size,
      seconds: input.seconds,
      referenceImage,
      providerParameters: input.providerParameters ?? null,
      credential: {
        toolCode: "video_generate",
        secretId: input.credential.secretId.trim(),
        providerId
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
    input: ProviderGatewayVideoGenerateRequest["model"],
    providerId: PersaiRuntimeVideoGenerateProviderId | null
  ): string | null {
    if (input === null || input === undefined || input === "") {
      return null;
    }
    if (typeof input !== "string" || input.trim().length === 0) {
      throw new BadRequestException("model must be a non-empty string or null");
    }
    const normalized = input.trim();
    if (
      (providerId ?? "openai") === "openai" &&
      !isPersaiRuntimeVideoGenerateModelKey(normalized)
    ) {
      throw new BadRequestException(
        `model must be one of ${PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS.join(", ")}, or null for OpenAI video generation`
      );
    }
    return normalized;
  }
}
