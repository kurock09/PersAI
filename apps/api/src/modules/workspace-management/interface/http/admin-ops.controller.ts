import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ResolveAdminOpsCockpitService } from "../../application/resolve-admin-ops-cockpit.service";
import type { AdminOpsCockpitState } from "../../application/ops-cockpit.types";
import {
  AdminOpsUserDirectoryService,
  type AdminOpsUserDirectoryResult
} from "../../application/admin-ops-user-directory.service";
import { ReapplyAssistantService } from "../../application/reapply-assistant.service";

@Controller("api/v1/admin/ops")
export class AdminOpsController {
  constructor(
    private readonly resolveAdminOpsCockpitService: ResolveAdminOpsCockpitService,
    private readonly adminOpsUserDirectoryService: AdminOpsUserDirectoryService,
    private readonly reapplyAssistantService: ReapplyAssistantService
  ) {}

  @Get("cockpit")
  async getOpsCockpit(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    cockpit: AdminOpsCockpitState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const cockpit = await this.resolveAdminOpsCockpitService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      cockpit
    };
  }

  @Get("users")
  async listUsers(
    @Req() req: RequestWithPlatformContext,
    @Query("q") search?: string,
    @Query("offset") offsetRaw?: string,
    @Query("limit") limitRaw?: string
  ): Promise<{
    requestId: string | null;
    users: AdminOpsUserDirectoryResult["users"];
    total: number;
  }> {
    this.resolveRequestUserId(req);
    const offset = Math.max(0, parseInt(offsetRaw ?? "0", 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw ?? "50", 10) || 50));
    const trimmed = search?.trim();
    const result = await this.adminOpsUserDirectoryService.execute({
      ...(trimmed ? { search: trimmed } : {}),
      offset,
      limit
    });
    return { requestId: req.requestId ?? null, ...result };
  }

  @Post("users/:userId/reapply")
  @HttpCode(200)
  async reapplyForUser(
    @Req() req: RequestWithPlatformContext,
    @Param("userId") targetUserId: string
  ): Promise<{ requestId: string | null; ok: boolean }> {
    this.resolveRequestUserId(req);
    if (!targetUserId || targetUserId.trim().length === 0) {
      throw new BadRequestException("userId is required.");
    }
    await this.reapplyAssistantService.execute(targetUserId.trim());
    return { requestId: req.requestId ?? null, ok: true };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
