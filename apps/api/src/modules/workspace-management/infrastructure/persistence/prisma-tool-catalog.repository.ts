import { Injectable } from "@nestjs/common";
import type { ToolCatalogRepository } from "../../domain/tool-catalog.repository";
import type { ToolCatalogActivationView } from "../../domain/tool-catalog.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaToolCatalogRepository implements ToolCatalogRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async listToolsForPlanActivationView(
    planCode: string | null
  ): Promise<ToolCatalogActivationView[]> {
    const tools = await this.prisma.toolCatalogTool.findMany({
      where: {
        status: "active"
      },
      orderBy: [{ toolClass: "asc" }, { displayName: "asc" }],
      include: {
        planActivations:
          planCode === null
            ? false
            : {
                where: {
                  plan: {
                    code: planCode
                  }
                },
                take: 1
              }
      }
    });

    return tools.map((tool) => {
      const activation =
        Array.isArray(tool.planActivations) && tool.planActivations.length > 0
          ? tool.planActivations[0]
          : null;
      return {
        toolCode: tool.code,
        displayName: tool.displayName,
        description: tool.description,
        toolClass: tool.toolClass,
        capabilityGroup: tool.capabilityGroup,
        catalogStatus: tool.status,
        planActivationStatus: activation?.activationStatus ?? "inactive"
      };
    });
  }
}
