import { Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class BumpConfigGenerationService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ generation: number }[]>`
      UPDATE platform_config_generations
      SET generation = generation + 1, updated_at = NOW()
      WHERE id = 'global'
      RETURNING generation
    `;
    return result[0]?.generation ?? 1;
  }

  async current(): Promise<number> {
    const row = await this.prisma.platformConfigGeneration.findUnique({
      where: { id: "global" },
      select: { generation: true }
    });
    return row?.generation ?? 1;
  }
}
