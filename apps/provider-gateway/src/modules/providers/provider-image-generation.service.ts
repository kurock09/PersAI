import { BadRequestException, Injectable } from "@nestjs/common";
import {
  PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS,
  MAX_RUNTIME_IMAGE_EDIT_COUNT,
  MIN_RUNTIME_IMAGE_EDIT_COUNT,
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  PERSAI_RUNTIME_IMAGE_BACKGROUNDS,
  type PersaiRuntimeImageEditProviderId,
  PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS,
  PERSAI_RUNTIME_IMAGE_GENERATE_SIZES,
  type ProviderGatewayImageEditRequest,
  type ProviderGatewayImageEditResult,
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
    const normalized = this.normalizeGenerateInput(input);
    const apiKey = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    switch (normalized.credential.providerId ?? "openai") {
      case "openai":
        return this.openaiProviderClient.generateImage(normalized, { apiKey });
    }
  }

  async editImage(input: ProviderGatewayImageEditRequest): Promise<ProviderGatewayImageEditResult> {
    const normalized = this.normalizeEditInput(input);
    const apiKey = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    switch (normalized.credential.providerId ?? "openai") {
      case "openai":
        return this.openaiProviderClient.editImage(normalized, { apiKey });
    }
  }

  private normalizeGenerateInput(
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
    if (!PERSAI_RUNTIME_IMAGE_BACKGROUNDS.includes(input.background)) {
      throw new BadRequestException("background must be a supported image background");
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
      model: this.normalizeOptionalModel(input.model, "model"),
      count: input.count,
      size: input.size,
      background: input.background,
      timeoutMs: this.normalizeOptionalPositiveInteger(input.timeoutMs, "timeoutMs"),
      credential: {
        toolCode: "image_generate",
        secretId: input.credential.secretId.trim(),
        providerId: input.credential.providerId ?? null
      }
    };
  }

  private normalizeEditInput(
    input: ProviderGatewayImageEditRequest
  ): ProviderGatewayImageEditRequest & {
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
    credential: ProviderGatewayImageEditRequest["credential"] & {
      providerId: PersaiRuntimeImageEditProviderId | null;
    };
  } {
    if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
      throw new BadRequestException("prompt must be a non-empty string");
    }
    if (
      !Number.isInteger(input.count) ||
      input.count < MIN_RUNTIME_IMAGE_EDIT_COUNT ||
      input.count > MAX_RUNTIME_IMAGE_EDIT_COUNT
    ) {
      throw new BadRequestException(
        `count must be an integer between ${String(MIN_RUNTIME_IMAGE_EDIT_COUNT)} and ${String(MAX_RUNTIME_IMAGE_EDIT_COUNT)}`
      );
    }
    if (input.size !== null && !PERSAI_RUNTIME_IMAGE_GENERATE_SIZES.includes(input.size)) {
      throw new BadRequestException("size must be a supported image-generation size or null");
    }
    if (!PERSAI_RUNTIME_IMAGE_BACKGROUNDS.includes(input.background)) {
      throw new BadRequestException("background must be a supported image background");
    }
    if (input.credential.toolCode !== "image_edit") {
      throw new BadRequestException('credential.toolCode must be "image_edit"');
    }
    if (
      typeof input.credential.secretId !== "string" ||
      input.credential.secretId.trim().length === 0
    ) {
      throw new BadRequestException("credential.secretId must be a non-empty string");
    }
    if (
      input.credential.providerId !== null &&
      !PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS.includes(input.credential.providerId)
    ) {
      throw new BadRequestException(
        "credential.providerId must be a supported image-edit provider or null"
      );
    }
    const sourceImage = this.normalizeEditImageInput(input.sourceImage, "sourceImage");
    const referenceImage =
      input.referenceImage === null || input.referenceImage === undefined
        ? null
        : this.normalizeEditImageInput(input.referenceImage, "referenceImage");

    return {
      prompt: input.prompt.trim(),
      model: this.normalizeOptionalModel(input.model, "model"),
      count: input.count,
      size: input.size,
      background: input.background,
      timeoutMs: this.normalizeOptionalPositiveInteger(input.timeoutMs, "timeoutMs"),
      sourceImage,
      referenceImage,
      credential: {
        toolCode: "image_edit",
        secretId: input.credential.secretId.trim(),
        providerId: input.credential.providerId ?? null
      }
    };
  }

  private normalizeEditImageInput(
    input: ProviderGatewayImageEditRequest["sourceImage"],
    field: "sourceImage" | "referenceImage"
  ): {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  } {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new BadRequestException(`${field} must be an object`);
    }
    if (typeof input.bytesBase64 !== "string" || input.bytesBase64.trim().length === 0) {
      throw new BadRequestException(`${field}.bytesBase64 must be a non-empty string`);
    }
    if (typeof input.mimeType !== "string" || input.mimeType.trim().length === 0) {
      throw new BadRequestException(`${field}.mimeType must be a non-empty string`);
    }

    const filename =
      input.filename === null || input.filename === undefined
        ? null
        : typeof input.filename === "string" && input.filename.trim().length > 0
          ? input.filename.trim()
          : null;
    if (input.filename !== undefined && input.filename !== null && filename === null) {
      throw new BadRequestException(`${field}.filename must be a non-empty string or null`);
    }

    return {
      bytesBase64: input.bytesBase64.trim(),
      mimeType: input.mimeType.trim(),
      filename
    };
  }

  private normalizeOptionalModel(value: unknown, path: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${path} must be a non-empty string or null`);
    }
    return value.trim();
  }

  private normalizeOptionalPositiveInteger(value: unknown, path: string): number | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (!Number.isInteger(value) || Number(value) <= 0) {
      throw new BadRequestException(`${path} must be a positive integer or null`);
    }
    return Number(value);
  }
}
