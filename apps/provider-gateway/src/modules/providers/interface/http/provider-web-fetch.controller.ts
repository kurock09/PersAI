import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayWebFetchRequest,
  ProviderGatewayWebFetchResult
} from "@persai/runtime-contract";
import { ProviderWebFetchService } from "../../provider-web-fetch.service";

@Controller("api/v1/providers")
export class ProviderWebFetchController {
  constructor(private readonly providerWebFetchService: ProviderWebFetchService) {}

  @Post("web-fetch")
  @HttpCode(HttpStatus.OK)
  webFetch(@Body() body: ProviderGatewayWebFetchRequest): Promise<ProviderGatewayWebFetchResult> {
    return this.providerWebFetchService.webFetch(body);
  }
}
