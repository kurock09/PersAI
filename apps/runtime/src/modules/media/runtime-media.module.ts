import { Module } from "@nestjs/common";
import { TurnsModule } from "../turns/turns.module";
import { RuntimeMediaController } from "./interface/http/runtime-media.controller";
import { RuntimeMediaTranscriptionService } from "./runtime-media-transcription.service";

@Module({
  imports: [TurnsModule],
  controllers: [RuntimeMediaController],
  providers: [RuntimeMediaTranscriptionService],
  exports: [RuntimeMediaTranscriptionService]
})
export class RuntimeMediaModule {}
