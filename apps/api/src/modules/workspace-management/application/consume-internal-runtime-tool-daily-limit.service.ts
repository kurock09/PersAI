import { BadRequestException, Injectable } from "@nestjs/common";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";

export interface ConsumeInternalRuntimeToolDailyLimitRequest {
  assistantId: string;
  toolCode: string;
  dailyCallLimit: number;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive integer.`);
  }
  return value;
}

@Injectable()
export class ConsumeInternalRuntimeToolDailyLimitService {
  constructor(
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseInput(payload: unknown): ConsumeInternalRuntimeToolDailyLimitRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Tool limit payload must be an object.");
    }

    const row = payload as Record<string, unknown>;
    return {
      assistantId: normalizeRequiredString(row.assistantId, "assistantId"),
      toolCode: normalizeRequiredString(row.toolCode, "toolCode"),
      dailyCallLimit: normalizePositiveInteger(row.dailyCallLimit, "dailyCallLimit")
    };
  }

  async execute(input: ConsumeInternalRuntimeToolDailyLimitRequest): Promise<{
    ok: true;
    currentCount: number;
    limit: number;
  }> {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
      assistantId: input.assistantId,
      toolCode: input.toolCode
    });
    const effectiveTool = resolved.tools[0];
    const effectiveLimit = effectiveTool?.dailyCallLimit ?? null;

    if (
      effectiveTool === undefined ||
      effectiveTool.activationStatus !== "active" ||
      effectiveLimit === null ||
      effectiveLimit <= 0
    ) {
      throw createAssistantInboundConflict(
        "tool_daily_limit_reached",
        `Daily tool usage policy for "${input.toolCode}" is no longer active on the effective plan.`,
        {
          toolCode: input.toolCode,
          runtimeReportedLimit: input.dailyCallLimit,
          effectivePlanCode: resolved.planCode
        }
      );
    }

    const result = await this.trackWorkspaceQuotaUsageService.consumeToolDailyLimit({
      assistant: resolved.assistant,
      toolCode: input.toolCode,
      dailyCallLimit: effectiveLimit
    });

    if (!result.allowed) {
      throw createAssistantInboundConflict(
        "tool_daily_limit_reached",
        `Daily tool usage limit reached for "${input.toolCode}".`,
        {
          toolCode: input.toolCode,
          currentCount: result.currentCount,
          limit: result.limit,
          runtimeReportedLimit: input.dailyCallLimit
        }
      );
    }

    return {
      ok: true,
      currentCount: result.currentCount,
      limit: effectiveLimit
    };
  }
}
