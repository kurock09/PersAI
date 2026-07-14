import { Body, Controller, Get, Param, Put, Req, UnauthorizedException } from "@nestjs/common";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAssistantRolesService } from "../../application/manage-assistant-roles.service";

@Controller("api/v1")
export class AssistantRolesController {
  constructor(private readonly manageAssistantRolesService: ManageAssistantRolesService) {}

  @Get("assistant/roles")
  async list(@Req() req: RequestWithPlatformContext): Promise<{ roles: unknown[] }> {
    const userId = this.resolveRequestUserId(req);
    const roles = await this.manageAssistantRolesService.listCatalog(userId);
    return { roles };
  }

  @Get("assistant/:assistantId/role")
  async getCurrentRole(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string
  ): Promise<{ assistantId: string; role: unknown }> {
    const userId = this.resolveRequestUserId(req);
    const parsedAssistantId = this.manageAssistantRolesService.parseAssistantId(assistantId);
    return this.manageAssistantRolesService.getCurrentRole(userId, parsedAssistantId);
  }

  @Put("assistant/:assistantId/role")
  async putCurrentRole(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Body() body: unknown
  ): Promise<{ assistantId: string; role: unknown }> {
    const userId = this.resolveRequestUserId(req);
    const parsedAssistantId = this.manageAssistantRolesService.parseAssistantId(assistantId);
    const input = this.manageAssistantRolesService.parseUpdateInput(body);
    return this.manageAssistantRolesService.putCurrentRole(userId, parsedAssistantId, input);
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
