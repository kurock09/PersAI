import { BadRequestException, Injectable } from "@nestjs/common";
import {
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  type PersaiRuntimeImageGenerateProviderId,
  type ProviderGatewayImageGenerateRequest,
  type ProviderGatewayImageGenerateResult
} from "@persai/runtime-contract";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

@Injectable()
export class ProviderImageGenerationService {
  constructor(
    private readonly openaiProviderClient: OpenAIProviderClient,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async generateImage(
    input: ProviderGatewayImageGenerateRequest
  ): Promise<ProviderGatewayImageGenerateResult> {
    const normalized = this.normalizeInput(input);
    const apiKey = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    switch (normalized.credential.providerId ?? "openai") {
      case "openai":
        return this.openaiProviderClient.generateImage(normalized, { apiKey });
    }
  }

  private normalizeInput(
    input: ProviderGatewayImageGenerateRequest
  ): ProviderGatewayImageGenerateRequest & {
    credential: ProviderGatewayImageGenerateRequest["credential"] & {
      providerId: PersaiRuntimeImageGenerateProviderId | null;
    };
  } {
    if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
      throw new BadRequestException("prompt must be a non-empty string");
    }
    if (
      !Number.isInteger(input.count) ||
      input.count < MIN_RUNTIME_IMAGE_GENERATE_COUNT ||
      input.count > MAX_RUNTIME_IMAGE_GENERATE_COUNT
    ) {
      throw new BadRequestException(
        `count must be an integer between ${String(MIN_RUNTIME_IMAGE_GENERATE_COUNT)} and ${String(MAX_RUNTIME_IMAGE_GENERATE_COUNT)}`
      );
    }
    if (input.size !== null && !PERSAI_RUNTIME_IMAGE_GENERATE_SIZES.includes(input.size)) {
      throw new BadRequestException("size must be a supported image-generation size or null");
    }
    if (input.credential.toolCode !== "image_generate") {
      throw new BadRequestException('credential.toolCode must be "image_generate"');
    }
    if (
      typeof input.credential.secretId !== "string" ||
      input.credential.secretId.trim().length === 0
    ) {
      throw new BadRequestException("credential.secretId must be a non-empty string");
    }
    if (
      input.credential.providerId !== null &&
      !PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS.includes(input.credential.providerId)
    ) {
      throw new BadRequestException(
        "credential.providerId must be a supported image-generation provider or null"
      );
    }

    return {
      prompt: input.prompt.trim(),
      count: input.count,
      size: input.size,
      credential: {
        toolCode: "image_generate",
        secretId: input.credential.secretId.trim(),
        providerId: input.credential.providerId ?? null
      }
    };
  }
}
