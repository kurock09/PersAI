import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";

export type CheckInternalRuntimeToolDailyLimitRequest = {
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
export class CheckInternalRuntimeToolDailyLimitService {
  constructor(
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseInput(payload: unknown): CheckInternalRuntimeToolDailyLimitRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Tool quota check payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    if (typeof row.assistantId !== "string" || row.assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId must be a non-empty string.");
    }
    const out: CheckInternalRuntimeToolDailyLimitRequest = {
      assistantId: row.assistantId.trim()
    };
    if (typeof row.toolCode === "string" && row.toolCode.trim().length > 0) {
      out.toolCode = row.toolCode.trim();
    }
    return out;
  }

  async execute(input: CheckInternalRuntimeToolDailyLimitRequest): Promise<{
    ok: true;
    planCode: string | null;
    tools: ToolDailyQuotaStatusRow[];
  }> {
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
      input.assistantId
    );
    const governance = await this.assistantGovernanceRepository.findByAssistantId(
      resolved.assistantId
    );
    if (governance === null) {
      throw new NotFoundException("Assistant governance does not exist for this assistant.");
    }

    const subscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
      assistantId: resolved.assistantId,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });

    const planCode = subscription.planCode;
    if (planCode === null) {
      return { ok: true, planCode: null, tools: [] };
    }

    const plan = await this.planCatalogRepository.findByCode(planCode);
    if (plan === null) {
      return { ok: true, planCode, tools: [] };
    }

    let activations = plan.toolActivations;
    if (input.toolCode) {
      activations = activations.filter((a) => a.toolCode === input.toolCode);
      if (activations.length === 0) {
        throw new BadRequestException(
          `Tool "${input.toolCode}" is not present on effective plan "${planCode}".`
        );
      }
    }

    const tools: ToolDailyQuotaStatusRow[] = [];
    for (const act of activations) {
      const dailyCallLimit = act.dailyCallLimit;
      const check =
        dailyCallLimit === null || dailyCallLimit <= 0
          ? { allowed: true, currentCount: 0, limit: null as number | null }
          : await this.trackWorkspaceQuotaUsageService.checkToolDailyLimit({
              workspaceId: resolved.workspaceId,
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

    return { ok: true, planCode, tools };
  }
}
