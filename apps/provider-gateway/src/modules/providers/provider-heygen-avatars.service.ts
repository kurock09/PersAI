import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  ProviderGatewayHeyGenCreatePhotoAvatarRequest,
  ProviderGatewayHeyGenCreatePhotoAvatarResult
} from "@persai/runtime-contract";
import { HeyGenProviderClient } from "./heygen/heygen-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

@Injectable()
export class ProviderHeyGenAvatarsService {
  constructor(
    private readonly heyGenProviderClient: HeyGenProviderClient,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async createPhotoAvatar(
    input: ProviderGatewayHeyGenCreatePhotoAvatarRequest
  ): Promise<ProviderGatewayHeyGenCreatePhotoAvatarResult> {
    const normalized = this.normalizeInput(input);
    const credentialValue = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    try {
      const { avatarId } = await this.heyGenProviderClient.createPhotoAvatar(
        {
          name: normalized.name,
          portraitImageBytesBase64: normalized.portraitImageBytesBase64,
          portraitImageMimeType: normalized.portraitImageMimeType
        },
        { credentialValue }
      );

      return {
        schema: "persai.providerGatewayHeyGenCreatePhotoAvatarResult.v1",
        provider: "heygen",
        avatarId,
        respondedAt: new Date().toISOString()
      };
    } catch (error) {
      // Re-throw ServiceUnavailableException unchanged (already structured).
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      // All other errors (HeyGen API failures, invalid response) surface as 503.
      // The caller (API side) distinguishes 4xx vs 5xx to set the right error code.
      const message =
        error instanceof Error ? error.message : "HeyGen avatar creation failed unexpectedly.";
      throw new ServiceUnavailableException({
        error: {
          code: "heygen_avatar_create_failed",
          message
        }
      });
    }
  }

  private normalizeInput(
    input: ProviderGatewayHeyGenCreatePhotoAvatarRequest
  ): ProviderGatewayHeyGenCreatePhotoAvatarRequest {
    if (input.schema !== "persai.providerGatewayHeyGenCreatePhotoAvatarRequest.v1") {
      throw new BadRequestException(
        `schema must be "persai.providerGatewayHeyGenCreatePhotoAvatarRequest.v1"`
      );
    }
    if (
      typeof input.credential?.secretId !== "string" ||
      input.credential.secretId.trim().length === 0
    ) {
      throw new BadRequestException("credential.secretId must be a non-empty string");
    }
    if (input.credential.providerId !== "heygen") {
      throw new BadRequestException('credential.providerId must be "heygen"');
    }
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new BadRequestException("name must be a non-empty string");
    }
    if (
      typeof input.portraitImageBytesBase64 !== "string" ||
      input.portraitImageBytesBase64.trim().length === 0
    ) {
      throw new BadRequestException("portraitImageBytesBase64 must be a non-empty string");
    }
    if (
      typeof input.portraitImageMimeType !== "string" ||
      input.portraitImageMimeType.trim().length === 0
    ) {
      throw new BadRequestException("portraitImageMimeType must be a non-empty string");
    }

    return {
      schema: "persai.providerGatewayHeyGenCreatePhotoAvatarRequest.v1",
      credential: {
        secretId: input.credential.secretId.trim(),
        providerId: "heygen"
      },
      name: input.name.trim(),
      portraitImageBytesBase64: input.portraitImageBytesBase64.trim(),
      portraitImageMimeType: input.portraitImageMimeType.trim()
    };
  }
}
