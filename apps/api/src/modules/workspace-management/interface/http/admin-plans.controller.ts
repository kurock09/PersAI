import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminPlansService } from "../../application/manage-admin-plans.service";
import { ResolvePlanVisibilityService } from "../../application/resolve-plan-visibility.service";
import { ManageMediaPackageCatalogService } from "../../application/manage-media-package-catalog.service";
import type {
  AdminCreatePlanInput,
  AdminPlanState
} from "../../application/admin-plan-management.types";
import type { AdminPlanVisibilityState } from "../../application/plan-visibility.types";
import type {
  CreateMediaPackageCatalogItemInput,
  MediaPackageCatalogItemState,
  UpdateMediaPackageCatalogItemInput
} from "../../application/media-package.types";

@Controller("api/v1/admin/plans")
export class AdminPlansController {
  constructor(
    private readonly manageAdminPlansService: ManageAdminPlansService,
    private readonly resolvePlanVisibilityService: ResolvePlanVisibilityService,
    private readonly manageMediaPackageCatalogService: ManageMediaPackageCatalogService
  ) {}

  @Get()
  async listPlans(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    plans: AdminPlanState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const plans = await this.manageAdminPlansService.listPlans(userId);
    return {
      requestId: req.requestId ?? null,
      plans
    };
  }

  @Get("visibility")
  async getAdminVisibility(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    visibility: AdminPlanVisibilityState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const visibility = await this.resolvePlanVisibilityService.getAdminVisibility(userId);
    return {
      requestId: req.requestId ?? null,
      visibility
    };
  }

  @Post()
  async createPlan(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    plan: AdminPlanState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input: AdminCreatePlanInput = this.manageAdminPlansService.parseCreateInput(body);
    const plan = await this.manageAdminPlansService.createPlan(
      userId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      plan
    };
  }

  @Patch(":code")
  async updatePlan(
    @Req() req: RequestWithPlatformContext,
    @Param("code") code: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    plan: AdminPlanState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const patch = this.manageAdminPlansService.parseUpdatePatch(body);
    const plan = await this.manageAdminPlansService.updatePlan(
      userId,
      code,
      patch,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      plan
    };
  }

  @Delete(":code")
  async deletePlan(
    @Req() req: RequestWithPlatformContext,
    @Param("code") code: string
  ): Promise<{ requestId: string | null; ok: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAdminPlansService.deletePlan(userId, code, this.resolveStepUpToken(req));
    return {
      requestId: req.requestId ?? null,
      ok: true
    };
  }

  // ── Media package catalog endpoints ──────────────────────────────────────

  @Get("packages")
  async listPackages(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    packages: MediaPackageCatalogItemState[];
  }> {
    this.resolveRequestUserId(req);
    return {
      requestId: req.requestId ?? null,
      packages: await this.manageMediaPackageCatalogService.listAll()
    };
  }

  @Post("packages")
  async createPackage(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; package: MediaPackageCatalogItemState }> {
    this.resolveRequestUserId(req);
    const input = body as CreateMediaPackageCatalogItemInput;
    return {
      requestId: req.requestId ?? null,
      package: await this.manageMediaPackageCatalogService.create(input)
    };
  }

  @Patch("packages/:id")
  async updatePackage(
    @Req() req: RequestWithPlatformContext,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; package: MediaPackageCatalogItemState }> {
    this.resolveRequestUserId(req);
    const patch = body as UpdateMediaPackageCatalogItemInput;
    return {
      requestId: req.requestId ?? null,
      package: await this.manageMediaPackageCatalogService.update(id, patch)
    };
  }

  @Delete("packages/:id")
  async deletePackage(
    @Req() req: RequestWithPlatformContext,
    @Param("id") id: string
  ): Promise<{ requestId: string | null; ok: true }> {
    this.resolveRequestUserId(req);
    await this.manageMediaPackageCatalogService.delete(id);
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
