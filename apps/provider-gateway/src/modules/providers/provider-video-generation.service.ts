import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
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

    try {
      switch (normalized.credential.providerId ?? "openai") {
        case "openai":
          return this.openaiProviderClient.generateVideo(normalized, { apiKey: credentialValue });
        case "runway":
          return this.runwayProviderClient.generateVideo(normalized, { apiKey: credentialValue });
        case "kling":
          return this.klingProviderClient.generateVideo(normalized, { credentialValue });
      }
    } catch (error) {
      const pollingLoss = this.readAcceptedPrimaryUnconfirmedError(error);
      if (pollingLoss !== null) {
        throw new ServiceUnavailableException({
          error: {
            code: "accepted_primary_unconfirmed",
            message:
              "Provider task was accepted, but polling continuity was lost before terminal status.",
            retryable: true,
            providerStatus: pollingLoss
          }
        });
      }
      throw error;
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
    referenceTailImage: {
      bytesBase64: string;
      mimeType: string;
      filename: string | null;
    } | null;
    voiceIds: string[] | null;
    acceptedTask: ProviderGatewayVideoGenerateRequest["acceptedTask"];
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
    const referenceTailImage =
      input.referenceTailImage === null || input.referenceTailImage === undefined
        ? null
        : this.normalizeReferenceImage(input.referenceTailImage);
    const model = this.normalizeModel(input.model, providerId);
    const voiceIds = this.normalizeVoiceIds(input.voiceIds);

    return {
      prompt: input.prompt.trim(),
      model,
      size: input.size,
      seconds: input.seconds,
      referenceImage,
      referenceTailImage,
      voiceIds,
      providerParameters: input.providerParameters ?? null,
      acceptedTask: input.acceptedTask ?? null,
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

  private normalizeVoiceIds(
    input: ProviderGatewayVideoGenerateRequest["voiceIds"]
  ): string[] | null {
    if (input === null || input === undefined) {
      return null;
    }
    if (!Array.isArray(input) || input.length === 0) {
      throw new BadRequestException("voiceIds must be a non-empty array when provided");
    }
    const normalized = Array.from(
      new Set(
        input.map((entry) => {
          if (typeof entry !== "string" || entry.trim().length === 0) {
            throw new BadRequestException("voiceIds must contain only non-empty strings");
          }
          return entry.trim();
        })
      )
    );
    return normalized.length > 0 ? normalized : null;
  }

  private readAcceptedPrimaryUnconfirmedError(error: unknown): Record<string, unknown> | null {
    const message = error instanceof Error ? error.message : null;
    if (message === null) {
      return null;
    }
    const marker = "PERSAI_VIDEO_POLLING_LOST::";
    const markerIndex = message.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }
    const payloadText = message.slice(markerIndex + marker.length).trim();
    if (payloadText.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(payloadText);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}
