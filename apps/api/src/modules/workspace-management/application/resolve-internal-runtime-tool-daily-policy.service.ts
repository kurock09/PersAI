import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import type { Assistant } from "../domain/assistant.entity";

export type ResolvedInternalRuntimeToolDailyPolicyRow = {
  toolCode: string;
  activationStatus: "active" | "inactive";
  dailyCallLimit: number | null;
};

const PLATFORM_MANAGED_DAILY_QUOTA_TOOL_CODES = new Set([
  "summarize_context",
  "compact_context",
  "memory_write",
  "quota_status",
  "knowledge_search",
  "knowledge_fetch"
]);

@Injectable()
export class ResolveInternalRuntimeToolDailyPolicyService {
  constructor(
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository
  ) {}

  async execute(params: { assistantId: string; toolCode?: string }): Promise<{
    assistant: Assistant;
    planCode: string | null;
    tools: ResolvedInternalRuntimeToolDailyPolicyRow[];
  }> {
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
      params.assistantId
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
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });

    const planCode = subscription.planCode;
    if (planCode === null) {
      if (params.toolCode && PLATFORM_MANAGED_DAILY_QUOTA_TOOL_CODES.has(params.toolCode)) {
        return {
          assistant: resolved.assistant,
          planCode,
          tools: [this.platformManagedToolPolicy(params.toolCode)]
        };
      }
      if (params.toolCode) {
        throw new BadRequestException(
          `Tool "${params.toolCode}" is not present on effective plan "${String(planCode)}".`
        );
      }
      return { assistant: resolved.assistant, planCode: null, tools: [] };
    }

    const plan = await this.planCatalogRepository.findByCode(planCode);
    if (plan === null) {
      if (params.toolCode && PLATFORM_MANAGED_DAILY_QUOTA_TOOL_CODES.has(params.toolCode)) {
        return {
          assistant: resolved.assistant,
          planCode,
          tools: [this.platformManagedToolPolicy(params.toolCode)]
        };
      }
      if (params.toolCode) {
        throw new BadRequestException(
          `Tool "${params.toolCode}" is not present on effective plan "${planCode}".`
        );
      }
      return { assistant: resolved.assistant, planCode, tools: [] };
    }

    let activations = plan.toolActivations;
    if (params.toolCode) {
      activations = activations.filter((activation) => activation.toolCode === params.toolCode);
      if (activations.length === 0) {
        if (PLATFORM_MANAGED_DAILY_QUOTA_TOOL_CODES.has(params.toolCode)) {
          return {
            assistant: resolved.assistant,
            planCode,
            tools: [this.platformManagedToolPolicy(params.toolCode)]
          };
        }
        throw new BadRequestException(
          `Tool "${params.toolCode}" is not present on effective plan "${planCode}".`
        );
      }
    }

    return {
      assistant: resolved.assistant,
      planCode,
      tools: activations.map((activation) => ({
        toolCode: activation.toolCode,
        activationStatus: activation.activationStatus,
        dailyCallLimit: activation.dailyCallLimit
      }))
    };
  }

  private platformManagedToolPolicy(toolCode: string): ResolvedInternalRuntimeToolDailyPolicyRow {
    return {
      toolCode,
      activationStatus: "active",
      dailyCallLimit: null
    };
  }
}
