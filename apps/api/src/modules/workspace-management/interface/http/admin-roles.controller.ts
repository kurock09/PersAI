import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  HttpStatus,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ApiErrorHttpException } from "../../../platform-core/interface/http/api-error";
import { ManageAdminRolesService } from "../../application/manage-admin-roles.service";
import type {
  AdminRolePreviewState,
  AdminRoleState
} from "../../application/admin-role-management.types";

const STRICT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("api/v1/admin/roles")
export class AdminRolesController {
  constructor(private readonly manageAdminRolesService: ManageAdminRolesService) {}

  @Get()
  async list(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    roles: AdminRoleState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const roles = await this.manageAdminRolesService.list(userId);
    return { requestId: req.requestId ?? null, roles };
  }

  @Post()
  async create(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; role: AdminRoleState }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminRolesService.parseCreateInput(body);
    const role = await this.manageAdminRolesService.create(userId, input);
    return { requestId: req.requestId ?? null, role };
  }

  /**
   * Static path must be registered before `/:roleId` so "preview" is never captured as an id.
   */
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  async preview(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; preview: AdminRolePreviewState }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminRolesService.parsePreviewInput(body);
    const preview = await this.manageAdminRolesService.preview(userId, input);
    return { requestId: req.requestId ?? null, preview };
  }

  @Get(":roleId")
  async get(
    @Req() req: RequestWithPlatformContext,
    @Param("roleId") roleId: string
  ): Promise<{ requestId: string | null; role: AdminRoleState }> {
    const userId = this.resolveRequestUserId(req);
    const role = await this.manageAdminRolesService.get(userId, this.parseRoleId(roleId));
    return { requestId: req.requestId ?? null, role };
  }

  @Patch(":roleId")
  async update(
    @Req() req: RequestWithPlatformContext,
    @Param("roleId") roleId: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; role: AdminRoleState }> {
    const userId = this.resolveRequestUserId(req);
    const parsedRoleId = this.parseRoleId(roleId);
    const input = this.manageAdminRolesService.parseUpdateInput(body);
    const role = await this.manageAdminRolesService.update(userId, parsedRoleId, input);
    return { requestId: req.requestId ?? null, role };
  }

  @Delete(":roleId")
  async archive(
    @Req() req: RequestWithPlatformContext,
    @Param("roleId") roleId: string
  ): Promise<{ requestId: string | null; archived: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAdminRolesService.archive(userId, this.parseRoleId(roleId));
    return { requestId: req.requestId ?? null, archived: true };
  }

  @Put(":roleId/skills")
  async replaceSkills(
    @Req() req: RequestWithPlatformContext,
    @Param("roleId") roleId: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; role: AdminRoleState }> {
    const userId = this.resolveRequestUserId(req);
    const parsedRoleId = this.parseRoleId(roleId);
    const input = this.manageAdminRolesService.parseSkillsReplaceInput(body);
    const role = await this.manageAdminRolesService.replaceSkills(userId, parsedRoleId, input);
    return { requestId: req.requestId ?? null, role };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    const userId = req.resolvedAppUser?.id;
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return userId;
  }

  private parseRoleId(value: string): string {
    const normalized = value.trim();
    if (!STRICT_UUID_PATTERN.test(normalized)) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "admin_role_invalid_id",
        category: "validation",
        message: "roleId must be a valid UUID."
      });
    }
    return normalized;
  }
}
