import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminSafetyControlsService } from "../../application/manage-admin-safety-controls.service";

@Controller("api/v1/admin/safety-controls")
export class AdminSafetyControlsController {
  constructor(
    private readonly manageAdminSafetyControlsService: ManageAdminSafetyControlsService
  ) {}

  @Get("restrictions")
  async listRestrictions(
    @Req() req: RequestWithPlatformContext,
    @Query("userId") userId?: string
  ): Promise<{
    requestId: string | null;
    activeCount: number;
    restrictions: Awaited<
      ReturnType<ManageAdminSafetyControlsService["listActiveRestrictions"]>
    >["restrictions"];
  }> {
    const adminUserId = this.resolveRequestUserId(req);
    const result = await this.manageAdminSafetyControlsService.listActiveRestrictions(
      adminUserId,
      userId
    );
    return {
      requestId: req.requestId ?? null,
      ...result
    };
  }

  @Get("cases")
  async listCases(
    @Req() req: RequestWithPlatformContext,
    @Query("userId") userId?: string,
    @Query("caseId") caseId?: string
  ): Promise<{
    requestId: string | null;
    cases: Awaited<ReturnType<ManageAdminSafetyControlsService["listModerationCases"]>>["cases"];
  }> {
    const adminUserId = this.resolveRequestUserId(req);
    const result = await this.manageAdminSafetyControlsService.listModerationCases(adminUserId, {
      ...(userId !== undefined ? { userId } : {}),
      ...(caseId !== undefined ? { caseId } : {})
    });
    return {
      requestId: req.requestId ?? null,
      ...result
    };
  }

  @Post("unblock")
  @HttpCode(HttpStatus.OK)
  async unblock(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    unblock: Awaited<ReturnType<ManageAdminSafetyControlsService["unblock"]>>;
  }> {
    const adminUserId = this.resolveRequestUserId(req);
    const input = this.manageAdminSafetyControlsService.parseUnblockInput(body);
    const unblock = await this.manageAdminSafetyControlsService.unblock(adminUserId, input);
    return {
      requestId: req.requestId ?? null,
      unblock
    };
  }

  @Post("restrict")
  @HttpCode(HttpStatus.OK)
  async restrict(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    restrict: Awaited<ReturnType<ManageAdminSafetyControlsService["restrict"]>>;
  }> {
    const adminUserId = this.resolveRequestUserId(req);
    const input = this.manageAdminSafetyControlsService.parseRestrictInput(body);
    const restrict = await this.manageAdminSafetyControlsService.restrict(
      adminUserId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      restrict
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
