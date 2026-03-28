import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import type { Assistant } from "../domain/assistant.entity";
import {
  WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
  type WorkspaceQuotaAccountingRepository
} from "../domain/workspace-quota-accounting.repository";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import type { AssistantInboundSurface } from "./prepare-assistant-inbound-turn.service";

type ResolvedQuotaLimits = {
  tokenBudgetLimit: bigint | null;
  costOrTokenDrivingToolClassUnitsLimit: number | null;
  activeWebChatsLimit: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readLimitFromEntitlementLimits(items: unknown[] | undefined, key: string): number | null {
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    const row = asObject(item);
    if (row?.key === key) {
      return asInteger(row.limit);
    }
  }

  return null;
}

@Injectable()
export class EnforceAssistantCapabilityAndQuotaService {
  constructor(
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService
  ) {}

  async enforceInboundTurn(params: {
    assistant: Assistant;
    surface: AssistantInboundSurface;
    isNewThread: boolean;
    activeSurfaceChatsCount: number;
  }): Promise<void> {
    if (params.surface !== "web_chat") {
      throw createAssistantInboundConflict(
        "surface_not_supported",
        `Inbound surface "${params.surface}" is not supported.`
      );
    }

    const governance = await this.resolveGovernance(params.assistant.id);
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant: params.assistant,
      governance
    });
    const limits = await this.resolveLimits(params.assistant, governance);

    if (!effectiveCapabilities.channelsAndSurfaces.webChat) {
      throw createAssistantInboundConflict(
        "plan_feature_unavailable",
        "Web chat is unavailable for this assistant under current plan/governance capabilities."
      );
    }
    if (!effectiveCapabilities.mediaClasses.text) {
      throw createAssistantInboundConflict(
        "plan_feature_unavailable",
        "Text media class is unavailable for this assistant under current plan/governance capabilities."
      );
    }
    if (!effectiveCapabilities.toolClasses.utility.allowed) {
      throw createAssistantInboundConflict(
        "plan_feature_unavailable",
        "Utility tool class is unavailable for this assistant under current plan/governance capabilities."
      );
    }

    if (params.isNewThread && params.activeSurfaceChatsCount >= limits.activeWebChatsLimit) {
      throw createAssistantInboundConflict(
        "active_chat_cap_reached",
        `Active web chats cap reached (${limits.activeWebChatsLimit}). Archive an existing chat or continue in an existing thread.`,
        { limit: limits.activeWebChatsLimit }
      );
    }

    const quotaState = await this.workspaceQuotaAccountingRepository.findByWorkspaceId(
      params.assistant.workspaceId
    );

    if (
      limits.tokenBudgetLimit !== null &&
      quotaState !== null &&
      quotaState.tokenBudgetUsed >= limits.tokenBudgetLimit
    ) {
      throw createAssistantInboundConflict(
        "quota_limit_reached",
        "Token budget limit reached for current workspace plan. Upgrade or wait for quota refresh."
      );
    }

    if (
      limits.costOrTokenDrivingToolClassUnitsLimit !== null &&
      effectiveCapabilities.toolClasses.costDriving.quotaGoverned &&
      quotaState !== null &&
      quotaState.costOrTokenDrivingToolClassUnitsUsed >=
        limits.costOrTokenDrivingToolClassUnitsLimit
    ) {
      throw createAssistantInboundConflict(
        "quota_limit_reached",
        "Cost-driving tool class quota limit reached for current workspace plan."
      );
    }
  }

  async enforceWebChatTurn(params: {
    assistant: Assistant;
    isNewThread: boolean;
    activeWebChatsCount: number;
  }): Promise<void> {
    await this.enforceInboundTurn({
      assistant: params.assistant,
      surface: "web_chat",
      isNewThread: params.isNewThread,
      activeSurfaceChatsCount: params.activeWebChatsCount
    });
  }

  private async resolveGovernance(assistantId: string): Promise<AssistantGovernance> {
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistantId);
    if (governance === null) {
      throw new NotFoundException("Assistant governance does not exist for this assistant.");
    }
    return governance;
  }

  private async resolveLimits(
    assistant: Assistant,
    governance: AssistantGovernance
  ): Promise<ResolvedQuotaLimits> {
    const config = loadApiConfig(process.env);
    const effectiveSubscription = await this.resolveEffectiveSubscriptionStateService.execute({
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const plan =
      effectiveSubscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(effectiveSubscription.planCode);

    const planHints = asObject(plan?.billingProviderHints ?? null);
    const quotaHints = asObject(planHints?.quotaAccounting ?? null);
    const tokenLimitFromHints = asInteger(quotaHints?.tokenBudgetLimit);
    const costToolLimitFromHints = asInteger(quotaHints?.costOrTokenDrivingToolClassUnitsLimit);
    const tokenLimitFromEntitlements = readLimitFromEntitlementLimits(
      plan?.entitlementModel?.limitsPermissions,
      "token_budget_limit"
    );
    const costToolLimitFromEntitlements = readLimitFromEntitlementLimits(
      plan?.entitlementModel?.limitsPermissions,
      "cost_or_token_driving_tool_class_units_limit"
    );

    return {
      tokenBudgetLimit: BigInt(
        tokenLimitFromHints ?? tokenLimitFromEntitlements ?? config.QUOTA_TOKEN_BUDGET_DEFAULT
      ),
      costOrTokenDrivingToolClassUnitsLimit:
        costToolLimitFromHints ??
        costToolLimitFromEntitlements ??
        config.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT,
      activeWebChatsLimit: config.WEB_ACTIVE_CHATS_CAP
    };
  }
}
