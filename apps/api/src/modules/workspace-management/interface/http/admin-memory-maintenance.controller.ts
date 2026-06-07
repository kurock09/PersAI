import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageAdminMemoryBackfillService,
  type MemoryBackfillImpact,
  type MemoryBackfillResult
} from "../../application/manage-admin-memory-backfill.service";

@Controller("api/v1/admin/memory-backfill")
export class AdminMemoryMaintenanceController {
  constructor(
    private readonly manageAdminMemoryBackfillService: ManageAdminMemoryBackfillService
  ) {}

  @HttpCode(200)
  @Post("preview")
  async previewMemoryBackfill(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    impact: MemoryBackfillImpact;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminMemoryBackfillService.parseInput(body);
    const impact = await this.manageAdminMemoryBackfillService.preview(userId, input);
    return {
      requestId: req.requestId ?? null,
      impact
    };
  }

  @HttpCode(200)
  @Post("apply")
  async applyMemoryBackfill(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    result: MemoryBackfillResult;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminMemoryBackfillService.parseInput(body);
    const result = await this.manageAdminMemoryBackfillService.apply(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      result
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
