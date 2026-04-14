import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult
} from "@persai/runtime-contract";
import { ProviderVideoGenerationService } from "../../provider-video-generation.service";

@Controller("api/v1/providers")
export class ProviderVideoGenerationController {
  constructor(private readonly providerVideoGenerationService: ProviderVideoGenerationService) {}

  @Post("generate-video")
  @HttpCode(HttpStatus.OK)
  generateVideo(
    @Body() body: ProviderGatewayVideoGenerateRequest
  ): Promise<ProviderGatewayVideoGenerateResult> {
    return this.providerVideoGenerationService.generateVideo(body);
  }
}
