import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayBrowserActionRequest,
  ProviderGatewayBrowserActionResult,
  ProviderGatewayBrowserSessionDeleteRequest,
  ProviderGatewayBrowserSessionOpenLiveRequest,
  ProviderGatewayBrowserSessionOpenLiveResult,
  ProviderGatewayBrowserSessionStartLoginRequest,
  ProviderGatewayBrowserSessionStartLoginResult,
  ProviderGatewayBrowserSessionVerifyRequest,
  ProviderGatewayBrowserSessionVerifyResult
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

  @Post("browser-session/start-login")
  @HttpCode(HttpStatus.OK)
  startLogin(
    @Body() body: ProviderGatewayBrowserSessionStartLoginRequest
  ): Promise<ProviderGatewayBrowserSessionStartLoginResult> {
    return this.providerBrowserService.startLogin(body);
  }

  @Post("browser-session/delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Body() body: ProviderGatewayBrowserSessionDeleteRequest): Promise<void> {
    await this.providerBrowserService.deleteSession(body);
  }

  @Post("browser-session/verify")
  @HttpCode(HttpStatus.OK)
  verifySession(
    @Body() body: ProviderGatewayBrowserSessionVerifyRequest
  ): Promise<ProviderGatewayBrowserSessionVerifyResult> {
    return this.providerBrowserService.verifySession(body);
  }

  @Post("browser-session/open-live")
  @HttpCode(HttpStatus.OK)
  openLiveSession(
    @Body() body: ProviderGatewayBrowserSessionOpenLiveRequest
  ): Promise<ProviderGatewayBrowserSessionOpenLiveResult> {
    return this.providerBrowserService.openLiveSession(body);
  }
}
