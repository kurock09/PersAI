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
  type WorkspaceQuotaAccountingRepository,
  type WorkspaceQuotaLimitsInput
} from "../domain/workspace-quota-accounting.repository";
import {
  WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY,
  type WorkspaceToolDailyUsageRepository
} from "../domain/workspace-tool-daily-usage.repository";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";

type PlanQuotaHints = {
  tokenBudgetLimit: bigint | null;
  costOrTokenDrivingToolClassUnitsLimit: number | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = asInteger(value);
  return parsed === null || parsed === 0 ? null : parsed;
}

function readQuotaHintFromLimitsPermissions(
  limitsPermissions: unknown[] | undefined,
  key: string
): number | null {
  if (!Array.isArray(limitsPermissions)) {
    return null;
  }

  for (const item of limitsPermissions) {
    const row = asObject(item);
    if (row?.key !== key) {
      continue;
    }
    return asPositiveInteger(row.limit);
  }

  return null;
}

function parsePlanQuotaHints(
  planHints: unknown,
  limitsPermissions: unknown[] | undefined
): PlanQuotaHints {
  const objectHints = asObject(planHints);
  const quotaHints = asObject(objectHints?.quotaAccounting ?? null);
  const tokenBudgetLimit =
    asPositiveInteger(quotaHints?.tokenBudgetLimit) ??
    readQuotaHintFromLimitsPermissions(limitsPermissions, "token_budget_limit");
  const toolClassLimit =
    asPositiveInteger(quotaHints?.costOrTokenDrivingToolClassUnitsLimit) ??
    readQuotaHintFromLimitsPermissions(
      limitsPermissions,
      "cost_or_token_driving_tool_class_units_limit"
    );

  return {
    tokenBudgetLimit: tokenBudgetLimit === null ? null : BigInt(tokenBudgetLimit),
    costOrTokenDrivingToolClassUnitsLimit: toolClassLimit
  };
}

function estimateTokens(message: string): number {
  const trimmedLength = message.trim().length;
  if (trimmedLength === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmedLength / 4));
}

@Injectable()
export class TrackWorkspaceQuotaUsageService {
  constructor(
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    @Inject(WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY)
    private readonly workspaceQuotaAccountingRepository: WorkspaceQuotaAccountingRepository,
    @Inject(WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY)
    private readonly toolDailyUsageRepository: WorkspaceToolDailyUsageRepository,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService
  ) {}

  async recordWebChatTurnUsage(params: {
    assistant: Assistant;
    userContent: string;
    assistantContent: string;
    source:
      | "web_chat_turn_sync"
      | "web_chat_turn_stream_completed"
      | "web_chat_turn_stream_partial";
  }): Promise<void> {
    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant: params.assistant,
      governance
    });

    const tokenDelta = BigInt(
      estimateTokens(params.userContent) + estimateTokens(params.assistantContent)
    );
    if (tokenDelta > BigInt(0)) {
      await this.workspaceQuotaAccountingRepository.incrementUsage({
        workspaceId: params.assistant.workspaceId,
        assistantId: params.assistant.id,
        userId: params.assistant.userId,
        dimension: "token_budget",
        delta: tokenDelta,
        source: params.source,
        metadata: {
          estimator: "chars_div_4_ceil_v1"
        },
        limits
      });
    }

    if (effectiveCapabilities.toolClasses.costDriving.quotaGoverned) {
      await this.workspaceQuotaAccountingRepository.incrementUsage({
        workspaceId: params.assistant.workspaceId,
        assistantId: params.assistant.id,
        userId: params.assistant.userId,
        dimension: "cost_or_token_driving_tool_class",
        delta: BigInt(1),
        source: params.source,
        metadata: {
          classKey: "cost_driving",
          costDrivingAllowed: effectiveCapabilities.toolClasses.costDriving.allowed
        },
        limits
      });
    }
  }

  async refreshActiveWebChatsUsage(params: {
    assistant: Assistant;
    activeWebChatsCurrent: number;
    source: "web_chat_turn_prepare" | "web_chat_archive" | "web_chat_hard_delete";
  }): Promise<void> {
    const governance = await this.resolveGovernance(params.assistant.id);
    const limits = await this.resolveLimits(params.assistant, governance);

    await this.workspaceQuotaAccountingRepository.refreshActiveWebChatsUsage({
      workspaceId: params.assistant.workspaceId,
      assistantId: params.assistant.id,
      userId: params.assistant.userId,
      currentActiveWebChats: params.activeWebChatsCurrent,
      source: params.source,
      limits
    });
  }

  async checkToolDailyLimit(params: {
    workspaceId: string;
    toolCode: string;
    dailyCallLimit: number | null;
  }): Promise<{ allowed: boolean; currentCount: number; limit: number | null }> {
    if (params.dailyCallLimit === null || params.dailyCallLimit <= 0) {
      return { allowed: true, currentCount: 0, limit: null };
    }
    const today = new Date();
    const dateOnly = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    const currentCount = await this.toolDailyUsageRepository.getUsageForDate(
      params.workspaceId,
      params.toolCode,
      dateOnly
    );
    return {
      allowed: currentCount < params.dailyCallLimit,
      currentCount,
      limit: params.dailyCallLimit
    };
  }

  async incrementToolDailyUsage(workspaceId: string, toolCode: string): Promise<number> {
    return this.toolDailyUsageRepository.incrementAndGet(workspaceId, toolCode);
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
  ): Promise<WorkspaceQuotaLimitsInput> {
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
    const planQuotaHints = parsePlanQuotaHints(
      plan?.billingProviderHints ?? null,
      plan?.entitlementModel?.limitsPermissions
    );

    return {
      tokenBudgetLimit:
        planQuotaHints.tokenBudgetLimit ?? BigInt(config.QUOTA_TOKEN_BUDGET_DEFAULT),
      costOrTokenDrivingToolClassUnitsLimit:
        planQuotaHints.costOrTokenDrivingToolClassUnitsLimit ??
        config.QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT,
      activeWebChatsLimit: config.WEB_ACTIVE_CHATS_CAP
    };
  }
}
