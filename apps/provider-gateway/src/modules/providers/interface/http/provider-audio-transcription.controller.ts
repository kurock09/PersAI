import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { ProviderGatewayAudioTranscriptionResult } from "@persai/runtime-contract";
import { ProviderAudioTranscriptionService } from "../../provider-audio-transcription.service";

@Controller("api/v1/providers")
export class ProviderAudioTranscriptionController {
  constructor(
    private readonly providerAudioTranscriptionService: ProviderAudioTranscriptionService
  ) {}

  @Post("transcribe-audio")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
  transcribeAudio(
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<ProviderGatewayAudioTranscriptionResult> {
    if (!file) {
      throw new BadRequestException("Audio file is required.");
    }

    return this.providerAudioTranscriptionService.transcribeAudio({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname || null
    });
  }
}
