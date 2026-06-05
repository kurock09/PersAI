import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  ProviderGatewayHeyGenCreatePhotoAvatarRequest,
  ProviderGatewayHeyGenCreatePhotoAvatarResult
} from "@persai/runtime-contract";
import { HeyGenProviderClient, HeyGenProviderClientError } from "./heygen/heygen-provider.client";
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
      // Re-throw already-structured HTTP exceptions unchanged.
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) {
        throw error;
      }
      // HeyGen returned a non-2xx response with a known HTTP status.
      // 4xx → bad input from caller; surface as 400 so the API side maps it to
      //        heygen_avatar_create_failed (invalid portrait, param error, etc.).
      // 5xx / unknown → provider outage; surface as 503 (heygen_unavailable).
      if (error instanceof HeyGenProviderClientError) {
        if (error.httpStatus >= 400 && error.httpStatus < 500) {
          throw new BadRequestException({
            error: { code: "heygen_avatar_create_failed", message: error.providerMessage }
          });
        }
        throw new ServiceUnavailableException({
          error: { code: "heygen_unavailable", message: error.providerMessage }
        });
      }
      // Network / timeout / unexpected parse failure → 503.
      const message =
        error instanceof Error ? error.message : "HeyGen avatar creation failed unexpectedly.";
      throw new ServiceUnavailableException({
        error: { code: "heygen_unavailable", message }
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
