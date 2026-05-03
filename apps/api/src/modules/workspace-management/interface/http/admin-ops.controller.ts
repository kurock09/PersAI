import {
  Body,
  BadRequestException,
  Controller,
  Delete,
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
import { AdminDeleteUserService } from "../../application/admin-delete-user.service";
import { AdminAuthorizationService } from "../../application/admin-authorization.service";
import { ManageAdminAssistantPlanOverrideService } from "../../application/manage-admin-assistant-plan-override.service";
import {
  ManageAdminWorkspaceSubscriptionService,
  type AdminWorkspaceSubscriptionInput
} from "../../application/manage-admin-workspace-subscription.service";
import {
  ManageAdminOpsBillingSupportService,
  type AdminOpsBillingSupportActionInput
} from "../../application/manage-admin-ops-billing-support.service";

@Controller("api/v1/admin/ops")
export class AdminOpsController {
  constructor(
    private readonly resolveAdminOpsCockpitService: ResolveAdminOpsCockpitService,
    private readonly adminOpsUserDirectoryService: AdminOpsUserDirectoryService,
    private readonly reapplyAssistantService: ReapplyAssistantService,
    private readonly adminDeleteUserService: AdminDeleteUserService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly manageAdminAssistantPlanOverrideService: ManageAdminAssistantPlanOverrideService,
    private readonly manageAdminWorkspaceSubscriptionService: ManageAdminWorkspaceSubscriptionService,
    private readonly manageAdminOpsBillingSupportService: ManageAdminOpsBillingSupportService
  ) {}

  @Get("cockpit")
  async getOpsCockpit(
    @Req() req: RequestWithPlatformContext,
    @Query("userId") targetUserId?: string
  ): Promise<{
    requestId: string | null;
    cockpit: AdminOpsCockpitState;
  }> {
    const callerId = this.resolveRequestUserId(req);
    const trimmedTarget = targetUserId?.trim() || undefined;
    const cockpit = await this.resolveAdminOpsCockpitService.execute(callerId, trimmedTarget);
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
    const callerId = this.resolveRequestUserId(req);
    const offset = Math.max(0, parseInt(offsetRaw ?? "0", 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw ?? "50", 10) || 50));
    const trimmed = search?.trim();
    const result = await this.adminOpsUserDirectoryService.execute(callerId, {
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
    const callerId = this.resolveRequestUserId(req);
    if (!targetUserId || targetUserId.trim().length === 0) {
      throw new BadRequestException("userId is required.");
    }
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerId);
    await this.reapplyAssistantService.execute(targetUserId.trim());
    return { requestId: req.requestId ?? null, ok: true };
  }

  @Post("users/:userId/plan-override")
  @HttpCode(200)
  async setPlanOverride(
    @Req() req: RequestWithPlatformContext,
    @Param("userId") targetUserId: string,
    @Query("planCode") planCode?: string
  ): Promise<{ requestId: string | null; ok: boolean }> {
    const callerId = this.resolveRequestUserId(req);
    if (!targetUserId || targetUserId.trim().length === 0) {
      throw new BadRequestException("userId is required.");
    }
    const trimmedPlanCode = planCode?.trim() ?? "";
    if (trimmedPlanCode.length === 0) {
      throw new BadRequestException("planCode is required.");
    }
    await this.manageAdminAssistantPlanOverrideService.setOverride(
      callerId,
      targetUserId.trim(),
      trimmedPlanCode,
      this.resolveStepUpToken(req)
    );
    return { requestId: req.requestId ?? null, ok: true };
  }

  @Delete("users/:userId/plan-override")
  @HttpCode(200)
  async resetPlanOverride(
    @Req() req: RequestWithPlatformContext,
    @Param("userId") targetUserId: string
  ): Promise<{ requestId: string | null; ok: boolean }> {
    const callerId = this.resolveRequestUserId(req);
    if (!targetUserId || targetUserId.trim().length === 0) {
      throw new BadRequestException("userId is required.");
    }
    await this.manageAdminAssistantPlanOverrideService.resetOverride(
      callerId,
      targetUserId.trim(),
      this.resolveStepUpToken(req)
    );
    return { requestId: req.requestId ?? null, ok: true };
  }

  @Post("users/:userId/workspace-subscription")
  @HttpCode(200)
  async setWorkspaceSubscription(
    @Req() req: RequestWithPlatformContext,
    @Param("userId") targetUserId: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; ok: boolean; changed: boolean; workspaceId: string }> {
    const callerId = this.resolveRequestUserId(req);
    const input: AdminWorkspaceSubscriptionInput =
      this.manageAdminWorkspaceSubscriptionService.parseApplyInput(body);
    const result = await this.manageAdminWorkspaceSubscriptionService.setWorkspaceSubscription(
      callerId,
      targetUserId,
      input,
      this.resolveStepUpToken(req)
    );
    return { requestId: req.requestId ?? null, ...result };
  }

  @Delete("users/:userId/workspace-subscription")
  @HttpCode(200)
  async resetWorkspaceSubscription(
    @Req() req: RequestWithPlatformContext,
    @Param("userId") targetUserId: string
  ): Promise<{ requestId: string | null; ok: boolean; changed: boolean; workspaceId: string }> {
    const callerId = this.resolveRequestUserId(req);
    const result = await this.manageAdminWorkspaceSubscriptionService.resetWorkspaceSubscription(
      callerId,
      targetUserId,
      this.resolveStepUpToken(req)
    );
    return { requestId: req.requestId ?? null, ...result };
  }

  @Post("users/:userId/billing-support-action")
  @HttpCode(200)
  async runBillingSupportAction(
    @Req() req: RequestWithPlatformContext,
    @Param("userId") targetUserId: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    ok: boolean;
    changed: boolean;
    workspaceId: string;
    action: string;
    summary: string;
  }> {
    const callerId = this.resolveRequestUserId(req);
    const input: AdminOpsBillingSupportActionInput =
      this.manageAdminOpsBillingSupportService.parseActionInput(body);
    const result = await this.manageAdminOpsBillingSupportService.execute(
      callerId,
      targetUserId,
      input,
      this.resolveStepUpToken(req)
    );
    return { requestId: req.requestId ?? null, ...result };
  }

  @Delete("users/:userId")
  @HttpCode(200)
  async deleteUser(
    @Req() req: RequestWithPlatformContext,
    @Param("userId") targetUserId: string
  ): Promise<{ requestId: string | null; ok: boolean }> {
    const callerId = this.resolveRequestUserId(req);
    if (!targetUserId || targetUserId.trim().length === 0) {
      throw new BadRequestException("userId is required.");
    }
    if (targetUserId.trim() === callerId) {
      throw new BadRequestException("Cannot delete yourself.");
    }
    await this.adminDeleteUserService.execute(callerId, targetUserId.trim());
    return { requestId: req.requestId ?? null, ok: true };
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
