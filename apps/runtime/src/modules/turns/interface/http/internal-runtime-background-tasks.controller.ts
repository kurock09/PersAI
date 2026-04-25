import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type {
  RuntimeBackgroundTaskEvaluationRequest,
  RuntimeBackgroundTaskEvaluationResult
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../../../runtime-config";
import { RuntimeBackgroundTaskEvaluationService } from "../../runtime-background-task-evaluation.service";
import {
  assertRuntimeInternalApiAuthorized,
  type RuntimeInternalRequestLike
} from "./assert-runtime-internal-auth";

@Controller("api/v1/internal/runtime/background-tasks")
export class InternalRuntimeBackgroundTasksController {
  constructor(
    private readonly runtimeBackgroundTaskEvaluationService: RuntimeBackgroundTaskEvaluationService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  @HttpCode(200)
  @Post("evaluate")
  async evaluate(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: unknown
  ): Promise<RuntimeBackgroundTaskEvaluationResult> {
    this.assertAuthorized(req);
    const input = this.parseInput(body);
    return this.runtimeBackgroundTaskEvaluationService.evaluate(input);
  }

  private assertAuthorized(req: RuntimeInternalRequestLike): void {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for runtime internal endpoints.",
      "Internal runtime authorization failed."
    );
  }

  private parseInput(body: unknown): RuntimeBackgroundTaskEvaluationRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Background-task evaluation request must be a JSON object.");
    }
    const row = body as Record<string, unknown>;
    const task = row.task;
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      throw new BadRequestException("task must be a JSON object.");
    }
    const taskRow = task as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      runtimeBundleDocument: this.requiredString(
        row.runtimeBundleDocument,
        "runtimeBundleDocument"
      ),
      task: {
        id: this.requiredString(taskRow.id, "task.id"),
        title: this.requiredString(taskRow.title, "task.title"),
        brief: this.requiredString(taskRow.brief, "task.brief"),
        scheduleJson: taskRow.scheduleJson ?? null,
        pushPolicyJson: taskRow.pushPolicyJson ?? null,
        scheduledRunAt: this.requiredString(taskRow.scheduledRunAt, "task.scheduledRunAt"),
        runCount: this.integer(taskRow.runCount, "task.runCount"),
        lastRunStatus:
          typeof taskRow.lastRunStatus === "string"
            ? (taskRow.lastRunStatus as RuntimeBackgroundTaskEvaluationRequest["task"]["lastRunStatus"])
            : null,
        lastRunAt: typeof taskRow.lastRunAt === "string" ? taskRow.lastRunAt : null
      }
    };
  }

  private requiredString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
  }

  private integer(value: unknown, fieldName: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${fieldName} must be a non-negative integer.`);
    }
    return value;
  }
}
