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

  async bumpReminderSchedulerEpoch(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ reminder_scheduler_epoch: number }[]>`
      UPDATE platform_config_generations
      SET reminder_scheduler_epoch = reminder_scheduler_epoch + 1, updated_at = NOW()
      WHERE id = 'global'
      RETURNING reminder_scheduler_epoch
    `;
    return result[0]?.reminder_scheduler_epoch ?? 1;
  }

  async currentReminderSchedulerEpoch(): Promise<number> {
    const row = await this.prisma.platformConfigGeneration.findUnique({
      where: { id: "global" },
      select: { reminderSchedulerEpoch: true }
    });
    return row?.reminderSchedulerEpoch ?? 1;
  }
}
