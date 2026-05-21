import { Body, Controller, Get, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminToolPathPricingService } from "../../application/manage-admin-tool-path-pricing.service";
import type { AdminToolPathPricingCatalogState } from "../../application/tool-path-pricing-catalog";

@Controller("api/v1/admin/tools/economics")
export class AdminToolPathPricingController {
  constructor(
    private readonly manageAdminToolPathPricingService: ManageAdminToolPathPricingService
  ) {}

  @Get()
  async getCatalog(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    catalog: AdminToolPathPricingCatalogState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const catalog = await this.manageAdminToolPathPricingService.getCatalog(userId);
    return {
      requestId: req.requestId ?? null,
      catalog
    };
  }

  @Put()
  async putCatalog(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    catalog: AdminToolPathPricingCatalogState;
    configGeneration: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminToolPathPricingService.parseUpdateInput(body);
    const result = await this.manageAdminToolPathPricingService.updateCatalog(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      ...result
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private resolveStepUpToken(req: RequestWithPlatformContext): string | null {
    const header = req.headers["x-persai-step-up-token"];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return typeof header === "string" ? header : null;
  }
}
