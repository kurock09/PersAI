import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageSitePagesService } from "../../application/manage-site-pages.service";
import type { PublicSitePageState } from "../../application/site-page.types";

@Controller("api/v1/public/site-pages")
export class PublicSitePagesController {
  constructor(private readonly manageSitePagesService: ManageSitePagesService) {}

  @Get(":slug")
  async getPage(
    @Req() req: RequestWithPlatformContext,
    @Param("slug") rawSlug: string,
    @Query("market") market: string | undefined,
    @Query("locale") locale: string | undefined
  ): Promise<{
    requestId: string | null;
    page: PublicSitePageState;
    resolvedMarket: "rf" | "intl";
    resolvedLocale: "ru" | "en";
  }> {
    const slug = this.manageSitePagesService.parseSlug(rawSlug);
    const result = await this.manageSitePagesService.getPublicPage(
      slug,
      { market, locale },
      req.headers
    );
    return {
      requestId: req.requestId ?? null,
      page: result.page,
      resolvedMarket: result.resolvedMarket,
      resolvedLocale: result.resolvedLocale
    };
  }
}
