import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageSitePagesService } from "../../application/manage-site-pages.service";
import type { SitePageState } from "../../application/site-page.types";

@Controller("api/v1/admin/site-pages")
export class AdminSitePagesController {
  constructor(private readonly manageSitePagesService: ManageSitePagesService) {}

  @Get()
  async listPages(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    pages: SitePageState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    return {
      requestId: req.requestId ?? null,
      pages: await this.manageSitePagesService.listAdminPages(userId)
    };
  }

  @Put(":slug")
  async putDraft(
    @Req() req: RequestWithPlatformContext,
    @Param("slug") rawSlug: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; page: SitePageState }> {
    const userId = this.resolveRequestUserId(req);
    const slug = this.manageSitePagesService.parseSlug(rawSlug);
    const input = this.manageSitePagesService.parseSaveDraftInput(body);
    return {
      requestId: req.requestId ?? null,
      page: await this.manageSitePagesService.saveDraft(userId, slug, input)
    };
  }

  @Post(":slug/publish")
  async publish(
    @Req() req: RequestWithPlatformContext,
    @Param("slug") rawSlug: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; page: SitePageState }> {
    const userId = this.resolveRequestUserId(req);
    const slug = this.manageSitePagesService.parseSlug(rawSlug);
    const input = this.manageSitePagesService.parsePublishInput(body);
    return {
      requestId: req.requestId ?? null,
      page: await this.manageSitePagesService.publish(userId, slug, input)
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    const userId = req.userId ?? req.resolvedAppUser?.id ?? null;
    if (typeof userId !== "string" || userId.length === 0) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return userId;
  }
}
