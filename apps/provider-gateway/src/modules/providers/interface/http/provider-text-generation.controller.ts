import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { ProviderTextGenerationService } from "../../provider-text-generation.service";

@Controller("api/v1/providers")
export class ProviderTextGenerationController {
  constructor(private readonly providerTextGenerationService: ProviderTextGenerationService) {}

  @Post("generate-text")
  @HttpCode(HttpStatus.OK)
  generateText(
    @Body() body: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    return this.providerTextGenerationService.generateText(body);
  }
}
