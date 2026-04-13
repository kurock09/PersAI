import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewaySpeechGenerateResult
} from "@persai/runtime-contract";
import { ProviderSpeechGenerationService } from "../../provider-speech-generation.service";

@Controller("api/v1/providers")
export class ProviderSpeechGenerationController {
  constructor(private readonly providerSpeechGenerationService: ProviderSpeechGenerationService) {}

  @Post("generate-speech")
  @HttpCode(HttpStatus.OK)
  generateSpeech(
    @Body() body: ProviderGatewaySpeechGenerateRequest
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    return this.providerSpeechGenerationService.generateSpeech(body);
  }
}
