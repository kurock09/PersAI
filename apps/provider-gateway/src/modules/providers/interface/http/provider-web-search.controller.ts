import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayWebSearchRequest,
  ProviderGatewayWebSearchResult
} from "@persai/runtime-contract";
import { ProviderWebSearchService } from "../../provider-web-search.service";

@Controller("api/v1/providers")
export class ProviderWebSearchController {
  constructor(private readonly providerWebSearchService: ProviderWebSearchService) {}

  @Post("web-search")
  @HttpCode(HttpStatus.OK)
  webSearch(
    @Body() body: ProviderGatewayWebSearchRequest
  ): Promise<ProviderGatewayWebSearchResult> {
    return this.providerWebSearchService.webSearch(body);
  }
}
