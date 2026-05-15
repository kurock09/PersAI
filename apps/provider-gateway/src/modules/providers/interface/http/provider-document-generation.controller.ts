import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayDocumentGenerateResult
} from "@persai/runtime-contract";
import { ProviderDocumentGenerationService } from "../../provider-document-generation.service";

@Controller("api/v1/providers")
export class ProviderDocumentGenerationController {
  constructor(
    private readonly providerDocumentGenerationService: ProviderDocumentGenerationService
  ) {}

  @Post("generate-document")
  @HttpCode(HttpStatus.OK)
  generateDocument(
    @Body() body: ProviderGatewayDocumentGenerateRequest
  ): Promise<ProviderGatewayDocumentGenerateResult> {
    return this.providerDocumentGenerationService.generateDocument(body);
  }
}
