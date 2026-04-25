import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type { InternalBackgroundTaskItemState } from "./list-internal-background-task-items.service";

const BACKGROUND_TASK_LIST_LIMIT = 50;
const BACKGROUND_TASK_RUN_HISTORY_LIMIT = 5;

@Injectable()
export class ListAssistantBackgroundTaskItemsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(userId: string): Promise<InternalBackgroundTaskItemState[]> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const rows = await this.prisma.assistantBackgroundTask.findMany({
      where: {
        assistantId: assistant.id,
        status: { in: ["active", "disabled", "completed", "failed"] }
      },
      orderBy: [{ status: "asc" }, { nextRunAt: "asc" }, { updatedAt: "desc" }],
      take: BACKGROUND_TASK_LIST_LIMIT,
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: BACKGROUND_TASK_RUN_HISTORY_LIMIT,
          select: {
            id: true,
            status: true,
            scheduledRunAt: true,
            startedAt: true,
            finishedAt: true,
            pushText: true,
            deliveryTarget: true,
            errorMessage: true
          }
        }
      }
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      brief: row.brief,
      mode: row.mode,
      status: row.status,
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
      externalRef: row.externalRef,
      runCount: row.runCount,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      lastRunStatus: row.lastRunStatus,
      lastPushAt: row.lastPushAt?.toISOString() ?? null,
      lastErrorMessage: row.lastErrorMessage,
      recentRuns: row.runs.map((run) => ({
        id: run.id,
        status: run.status,
        scheduledRunAt: run.scheduledRunAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        pushText: run.pushText,
        deliveryTarget: run.deliveryTarget,
        errorMessage: run.errorMessage
      }))
    }));
  }
}
