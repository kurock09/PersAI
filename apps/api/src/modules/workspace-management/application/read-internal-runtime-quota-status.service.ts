import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  AssistantMonthlyMediaQuotaSnapshot,
  AssistantQuotaBucketSnapshot
} from "./track-workspace-quota-usage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";

export type ReadInternalRuntimeQuotaStatusRequest = {
  assistantId: string;
  toolCode?: string;
};

export type ToolDailyQuotaStatusRow = {
  toolCode: string;
  activationStatus: string;
  dailyCallLimit: number | null;
  currentCount: number;
  allowed: boolean;
};

@Injectable()
export class ReadInternalRuntimeQuotaStatusService {
  constructor(
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseInput(payload: unknown): ReadInternalRuntimeQuotaStatusRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Tool quota check payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    if (typeof row.assistantId !== "string" || row.assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId must be a non-empty string.");
    }
    const out: ReadInternalRuntimeQuotaStatusRequest = {
      assistantId: row.assistantId.trim()
    };
    if (typeof row.toolCode === "string" && row.toolCode.trim().length > 0) {
      out.toolCode = row.toolCode.trim();
    }
    return out;
  }

  async execute(input: ReadInternalRuntimeQuotaStatusRequest): Promise<{
    ok: true;
    planCode: string | null;
    tools: ToolDailyQuotaStatusRow[];
    buckets: AssistantQuotaBucketSnapshot[];
    monthlyMediaQuotas: AssistantMonthlyMediaQuotaSnapshot;
  }> {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute(
      input.toolCode
        ? {
            assistantId: input.assistantId,
            toolCode: input.toolCode
          }
        : {
            assistantId: input.assistantId
          }
    );

    const tools: ToolDailyQuotaStatusRow[] = [];
    for (const act of resolved.tools) {
      const dailyCallLimit = act.dailyCallLimit;
      const check =
        dailyCallLimit === null || dailyCallLimit <= 0
          ? { allowed: true, currentCount: 0, limit: null as number | null }
          : await this.trackWorkspaceQuotaUsageService.checkToolDailyLimit({
              workspaceId: resolved.assistant.workspaceId,
              toolCode: act.toolCode,
              dailyCallLimit
            });

      const activeOnPlan = act.activationStatus === "active";
      const underDailyCap =
        dailyCallLimit === null ||
        dailyCallLimit <= 0 ||
        (check.limit !== null && check.currentCount < check.limit);
      const allowed = activeOnPlan && underDailyCap;

      tools.push({
        toolCode: act.toolCode,
        activationStatus: act.activationStatus,
        dailyCallLimit,
        currentCount: check.currentCount,
        allowed
      });
    }

    const snapshot = await this.trackWorkspaceQuotaUsageService.resolveAssistantQuotaSnapshot(
      resolved.assistant
    );
    const monthlyMediaQuotas =
      await this.trackWorkspaceQuotaUsageService.resolveAssistantMonthlyMediaQuotaSnapshot(
        resolved.assistant
      );

    return {
      ok: true,
      planCode: resolved.planCode,
      tools,
      buckets: snapshot.buckets,
      monthlyMediaQuotas
    };
  }
}
