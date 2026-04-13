import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult
} from "@persai/runtime-contract";
import { ProviderImageGenerationService } from "../../provider-image-generation.service";

@Controller("api/v1/providers")
export class ProviderImageGenerationController {
  constructor(private readonly providerImageGenerationService: ProviderImageGenerationService) {}

  @Post("generate-image")
  @HttpCode(HttpStatus.OK)
  generateImage(
    @Body() body: ProviderGatewayImageGenerateRequest
  ): Promise<ProviderGatewayImageGenerateResult> {
    return this.providerImageGenerationService.generateImage(body);
  }
}
