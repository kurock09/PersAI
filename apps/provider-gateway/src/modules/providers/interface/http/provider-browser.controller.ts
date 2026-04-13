import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayBrowserActionRequest,
  ProviderGatewayBrowserActionResult
} from "@persai/runtime-contract";
import { ProviderBrowserService } from "../../provider-browser.service";

@Controller("api/v1/providers")
export class ProviderBrowserController {
  constructor(private readonly providerBrowserService: ProviderBrowserService) {}

  @Post("browser-action")
  @HttpCode(HttpStatus.OK)
  browserAction(
    @Body() body: ProviderGatewayBrowserActionRequest
  ): Promise<ProviderGatewayBrowserActionResult> {
    return this.providerBrowserService.browserAction(body);
  }
}
