import { Controller, Get, Req } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageSitePagesService } from "../../application/manage-site-pages.service";

@Controller("api/v1/public")
export class PublicGeoHintController {
  constructor(private readonly manageSitePagesService: ManageSitePagesService) {}

  @Get("geo-hint")
  async getHint(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    hint: { suggestedCountryCode: string | null };
  }> {
    return {
      requestId: req.requestId ?? null,
      hint: {
        suggestedCountryCode: this.manageSitePagesService.resolveSuggestedCountryCode(req.headers)
      }
    };
  }
}
