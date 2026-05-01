import { Body, Controller, Get, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAssistantSkillsService } from "../../application/manage-assistant-skills.service";
import type { AssistantSkillCatalogItemState } from "../../application/skill-management.types";

@Controller("api/v1/assistant/skills")
export class AssistantSkillsController {
  constructor(private readonly manageAssistantSkillsService: ManageAssistantSkillsService) {}

  @Get()
  async list(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    skills: AssistantSkillCatalogItemState[];
    assignedSkillIds: string[];
    limit: number | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const state = await this.manageAssistantSkillsService.list(userId);
    return {
      requestId: req.requestId ?? null,
      skills: state.skills,
      assignedSkillIds: state.assignedSkillIds,
      limit: state.limit
    };
  }

  @Put()
  async replaceAssignments(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    skills: AssistantSkillCatalogItemState[];
    assignedSkillIds: string[];
    limit: number | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAssistantSkillsService.parseAssignmentsInput(body);
    const state = await this.manageAssistantSkillsService.replaceAssignments(
      userId,
      input.skillIds
    );
    return {
      requestId: req.requestId ?? null,
      skills: state.skills,
      assignedSkillIds: state.assignedSkillIds,
      limit: state.limit
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
