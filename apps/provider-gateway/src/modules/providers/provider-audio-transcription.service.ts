import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { ProviderGatewayAudioTranscriptionResult } from "@persai/runtime-contract";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { ProviderWarmupService } from "./provider-warmup.service";

@Injectable()
export class ProviderAudioTranscriptionService {
  constructor(
    private readonly providerWarmupService: ProviderWarmupService,
    private readonly openaiProviderClient: OpenAIProviderClient
  ) {}

  async transcribeAudio(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }): Promise<ProviderGatewayAudioTranscriptionResult> {
    this.assertValidInput(input);
    this.assertOpenAiReady();
    return this.openaiProviderClient.transcribeAudio(input);
  }

  private assertValidInput(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }): void {
    if (input.buffer.length === 0) {
      throw new BadRequestException("Audio file must not be empty.");
    }
    if (input.mimeType.trim().length === 0) {
      throw new BadRequestException("Audio file MIME type must be provided.");
    }
    if (!input.mimeType.startsWith("audio/")) {
      throw new BadRequestException("Audio transcription accepts only audio MIME types.");
    }
  }

  private assertOpenAiReady(): void {
    const providerState = this.providerWarmupService
      .getSnapshot()
      .providers.find((provider) => provider.provider === "openai");
    if (!providerState || providerState.state !== "ready") {
      throw new ServiceUnavailableException('Provider "openai" is not ready.');
    }
  }
}
