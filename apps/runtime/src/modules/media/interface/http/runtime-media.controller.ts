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
import type { RuntimeMediaTranscriptionResult } from "@persai/runtime-contract";
import { RuntimeMediaTranscriptionService } from "../../runtime-media-transcription.service";

@Controller("api/v1/media")
export class RuntimeMediaController {
  constructor(
    private readonly runtimeMediaTranscriptionService: RuntimeMediaTranscriptionService
  ) {}

  @Post("transcribe")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
  transcribe(
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<RuntimeMediaTranscriptionResult> {
    if (!file) {
      throw new BadRequestException("Audio file is required.");
    }

    return this.runtimeMediaTranscriptionService.transcribeAudio({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname || null
    });
  }
}
