import { Injectable } from "@nestjs/common";
import type { ResolvedActiveAssistantContext } from "./resolve-active-assistant.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class SwitchActiveAssistantService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(input: {
    userId: string;
    assistantId: string;
  }): Promise<ResolvedActiveAssistantContext> {
    const resolved = await this.resolveActiveAssistantService.execute(input);
    await this.prisma.workspaceMember.update({
      where: { id: resolved.workspaceMemberId },
      data: { activeAssistantId: resolved.assistantId }
    });
    return resolved;
  }
}
