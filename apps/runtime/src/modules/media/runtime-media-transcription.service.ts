import { BadRequestException, Injectable } from "@nestjs/common";
import type { RuntimeMediaTranscriptionResult } from "@persai/runtime-contract";
import { ProviderGatewayClientService } from "../turns/provider-gateway.client.service";

@Injectable()
export class RuntimeMediaTranscriptionService {
  constructor(private readonly providerGatewayClientService: ProviderGatewayClientService) {}

  async transcribeAudio(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }): Promise<RuntimeMediaTranscriptionResult> {
    this.assertValidInput(input);
    return this.providerGatewayClientService.transcribeAudio(input);
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
      throw new BadRequestException("Media transcription accepts only audio MIME types.");
    }
  }
}
