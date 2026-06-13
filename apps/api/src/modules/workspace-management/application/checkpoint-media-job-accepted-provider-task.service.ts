import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PersaiRuntimeVideoGenerateProviderId } from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const ACTIVE_MEDIA_JOB_STATUSES = new Set(["queued", "running"]);

type AcceptedProviderTaskInput = {
  provider: PersaiRuntimeVideoGenerateProviderId;
  model: string | null;
  providerTaskId: string;
  acceptedAt: string;
  providerStage: "accepted";
  taskKind?: string | null;
};

@Injectable()
export class CheckpointMediaJobAcceptedProviderTaskService {
  private readonly logger = new Logger(CheckpointMediaJobAcceptedProviderTaskService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  parseInput(body: unknown): {
    mediaJobId: string;
    acceptedProviderTask: AcceptedProviderTaskInput;
  } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Checkpoint request must be a JSON object.");
    }
    const row = body as Record<string, unknown>;
    const mediaJobId = this.requiredString(row.mediaJobId, "mediaJobId");
    const acceptedProviderTask = row.acceptedProviderTask;
    if (
      acceptedProviderTask === null ||
      typeof acceptedProviderTask !== "object" ||
      Array.isArray(acceptedProviderTask)
    ) {
      throw new BadRequestException("acceptedProviderTask must be a JSON object.");
    }
    const accepted = acceptedProviderTask as Record<string, unknown>;
    const provider = accepted.provider;
    if (
      provider !== "openai" &&
      provider !== "runway" &&
      provider !== "kling" &&
      provider !== "heygen"
    ) {
      throw new BadRequestException(
        "acceptedProviderTask.provider must be a supported video provider."
      );
    }
    if (accepted.providerStage !== "accepted") {
      throw new BadRequestException('acceptedProviderTask.providerStage must be "accepted".');
    }
    return {
      mediaJobId,
      acceptedProviderTask: {
        provider,
        model: this.optionalNonEmptyString(accepted.model),
        providerTaskId: this.requiredString(
          accepted.providerTaskId,
          "acceptedProviderTask.providerTaskId"
        ),
        acceptedAt: this.requiredString(accepted.acceptedAt, "acceptedProviderTask.acceptedAt"),
        providerStage: "accepted",
        taskKind: this.optionalNonEmptyString(accepted.taskKind)
      }
    };
  }

  async execute(input: {
    mediaJobId: string;
    acceptedProviderTask: AcceptedProviderTaskInput;
  }): Promise<{ ok: true; checkpointed: boolean }> {
    const job = await this.prisma.assistantMediaJob.findUnique({
      where: { id: input.mediaJobId },
      select: { id: true, status: true, requestJson: true }
    });
    if (job === null) {
      throw new NotFoundException(`Media job "${input.mediaJobId}" was not found.`);
    }
    if (!ACTIVE_MEDIA_JOB_STATUSES.has(job.status)) {
      this.logger.warn(
        `media_job_checkpoint_skipped jobId=${job.id} status=${job.status} providerTaskId=${input.acceptedProviderTask.providerTaskId}`
      );
      return { ok: true, checkpointed: false };
    }

    const existingTaskId = this.readExistingProviderTaskId(job.requestJson);
    if (existingTaskId !== null) {
      if (existingTaskId === input.acceptedProviderTask.providerTaskId) {
        return { ok: true, checkpointed: false };
      }
      this.logger.warn(
        `media_job_checkpoint_conflict jobId=${job.id} existingTaskId=${existingTaskId} incomingTaskId=${input.acceptedProviderTask.providerTaskId}`
      );
      return { ok: true, checkpointed: false };
    }

    const updated = await this.prisma.assistantMediaJob.updateMany({
      where: {
        id: job.id,
        status: { in: ["queued", "running"] }
      },
      data: {
        requestJson: this.withAcceptedProviderTask(
          job.requestJson,
          input.acceptedProviderTask
        ) as never
      }
    });
    if (updated.count > 0) {
      this.logger.log(
        `media_job_checkpointed jobId=${job.id} provider=${input.acceptedProviderTask.provider} providerTaskId=${input.acceptedProviderTask.providerTaskId}`
      );
      return { ok: true, checkpointed: true };
    }
    return { ok: true, checkpointed: false };
  }

  private readExistingProviderTaskId(requestJson: unknown): string | null {
    const task = this.readAcceptedProviderTask(requestJson);
    if (task === null) {
      return null;
    }
    return task.providerTaskId;
  }

  private readAcceptedProviderTask(requestJson: unknown): AcceptedProviderTaskInput | null {
    if (requestJson === null || typeof requestJson !== "object" || Array.isArray(requestJson)) {
      return null;
    }
    const directToolExecution = (requestJson as Record<string, unknown>).directToolExecution;
    if (
      directToolExecution === null ||
      typeof directToolExecution !== "object" ||
      Array.isArray(directToolExecution)
    ) {
      return null;
    }
    const direct = directToolExecution as Record<string, unknown>;
    if (direct.toolCode !== "video_generate") {
      return null;
    }
    const request = direct.request;
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      return null;
    }
    const accepted = (request as Record<string, unknown>).acceptedProviderTask;
    if (accepted === null || typeof accepted !== "object" || Array.isArray(accepted)) {
      return null;
    }
    const row = accepted as Record<string, unknown>;
    const providerTaskId =
      typeof row.providerTaskId === "string" && row.providerTaskId.trim().length > 0
        ? row.providerTaskId.trim()
        : null;
    if (providerTaskId === null) {
      return null;
    }
    const provider = row.provider;
    if (
      provider !== "openai" &&
      provider !== "runway" &&
      provider !== "kling" &&
      provider !== "heygen"
    ) {
      return null;
    }
    return {
      provider,
      model: typeof row.model === "string" && row.model.trim().length > 0 ? row.model.trim() : null,
      providerTaskId,
      acceptedAt:
        typeof row.acceptedAt === "string" && row.acceptedAt.trim().length > 0
          ? row.acceptedAt.trim()
          : new Date().toISOString(),
      providerStage: "accepted",
      taskKind:
        typeof row.taskKind === "string" && row.taskKind.trim().length > 0
          ? row.taskKind.trim()
          : null
    };
  }

  private withAcceptedProviderTask(
    requestJson: unknown,
    accepted: AcceptedProviderTaskInput
  ): unknown {
    if (requestJson === null || typeof requestJson !== "object" || Array.isArray(requestJson)) {
      return requestJson;
    }
    const row = requestJson as Record<string, unknown>;
    const directToolExecution = row.directToolExecution;
    if (
      directToolExecution === null ||
      typeof directToolExecution !== "object" ||
      Array.isArray(directToolExecution)
    ) {
      return requestJson;
    }
    const direct = directToolExecution as Record<string, unknown>;
    if (direct.toolCode !== "video_generate") {
      return requestJson;
    }
    const request = direct.request;
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      return requestJson;
    }
    return {
      ...row,
      directToolExecution: {
        ...direct,
        request: {
          ...(request as Record<string, unknown>),
          acceptedProviderTask: {
            provider: accepted.provider,
            model: accepted.model,
            providerTaskId: accepted.providerTaskId,
            acceptedAt: accepted.acceptedAt,
            providerStage: "accepted",
            taskKind: accepted.taskKind ?? null
          }
        }
      }
    };
  }

  private requiredString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

  private optionalNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
