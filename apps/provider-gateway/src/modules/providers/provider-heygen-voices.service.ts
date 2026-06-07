import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  ProviderGatewayHeyGenCreateVoiceCloneRequest,
  ProviderGatewayHeyGenCreateVoiceCloneResult
} from "@persai/runtime-contract";
import { HeyGenProviderClient, HeyGenProviderClientError } from "./heygen/heygen-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

@Injectable()
export class ProviderHeyGenVoicesService {
  constructor(
    private readonly heyGenProviderClient: HeyGenProviderClient,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async createVoiceClone(
    input: ProviderGatewayHeyGenCreateVoiceCloneRequest
  ): Promise<ProviderGatewayHeyGenCreateVoiceCloneResult> {
    const normalized = this.normalizeInput(input);
    const credentialValue = await this.persaiInternalApiClientService.resolveSecretValue(
      normalized.credential.secretId
    );

    try {
      const result = await this.heyGenProviderClient.createVoiceClone(
        {
          displayName: normalized.displayName,
          audioBytesBase64: normalized.audioBytesBase64,
          audioMimeType: normalized.audioMimeType,
          languageHint: normalized.languageHint ?? null,
          ...(normalized.removeBackgroundNoise === undefined
            ? {}
            : { removeBackgroundNoise: normalized.removeBackgroundNoise })
        },
        { credentialValue }
      );

      return {
        schema: "persai.providerGatewayHeyGenCreateVoiceCloneResult.v1",
        provider: "heygen",
        voiceCloneId: result.voiceCloneId,
        status: "complete",
        previewAudioUrl: result.previewAudioUrl,
        respondedAt: new Date().toISOString()
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof HeyGenProviderClientError) {
        if (error.httpStatus === 400 && error.providerCode === "resource_limit_reached") {
          throw new BadRequestException({
            error: { code: "heygen_voice_clone_limit_reached", message: error.providerMessage }
          });
        }
        if (error.httpStatus === 403 && error.providerCode === "plan_upgrade_required") {
          throw new BadRequestException({
            error: {
              code: "heygen_voice_clone_plan_upgrade_required",
              message: error.providerMessage
            }
          });
        }
        if (error.httpStatus === 401 || error.providerCode === "authentication_failed") {
          throw new ServiceUnavailableException({
            error: { code: "heygen_authentication_failed", message: error.providerMessage }
          });
        }
        if (error.httpStatus === 429 || error.providerCode === "rate_limit_exceeded") {
          throw new ServiceUnavailableException({
            error: { code: "heygen_rate_limited", message: error.providerMessage }
          });
        }
        if (error.httpStatus >= 400 && error.httpStatus < 500) {
          throw new BadRequestException({
            error: { code: "heygen_voice_clone_failed", message: error.providerMessage }
          });
        }
        throw new ServiceUnavailableException({
          error: { code: "heygen_unavailable", message: error.providerMessage }
        });
      }

      const message =
        error instanceof Error ? error.message : "HeyGen voice clone failed unexpectedly.";
      throw new ServiceUnavailableException({
        error: { code: "heygen_unavailable", message }
      });
    }
  }

  private normalizeInput(
    input: ProviderGatewayHeyGenCreateVoiceCloneRequest
  ): ProviderGatewayHeyGenCreateVoiceCloneRequest {
    if (input.schema !== "persai.providerGatewayHeyGenCreateVoiceCloneRequest.v1") {
      throw new BadRequestException(
        'schema must be "persai.providerGatewayHeyGenCreateVoiceCloneRequest.v1"'
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
    if (typeof input.displayName !== "string" || input.displayName.trim().length === 0) {
      throw new BadRequestException("displayName must be a non-empty string");
    }
    if (typeof input.audioBytesBase64 !== "string" || input.audioBytesBase64.trim().length === 0) {
      throw new BadRequestException("audioBytesBase64 must be a non-empty string");
    }
    if (typeof input.audioMimeType !== "string" || input.audioMimeType.trim().length === 0) {
      throw new BadRequestException("audioMimeType must be a non-empty string");
    }
    return {
      schema: "persai.providerGatewayHeyGenCreateVoiceCloneRequest.v1",
      credential: {
        secretId: input.credential.secretId.trim(),
        providerId: "heygen"
      },
      displayName: input.displayName.trim(),
      audioBytesBase64: input.audioBytesBase64.trim(),
      audioMimeType: input.audioMimeType.trim(),
      languageHint:
        typeof input.languageHint === "string" && input.languageHint.trim().length > 0
          ? input.languageHint.trim()
          : null,
      removeBackgroundNoise: input.removeBackgroundNoise === true
    };
  }
}
