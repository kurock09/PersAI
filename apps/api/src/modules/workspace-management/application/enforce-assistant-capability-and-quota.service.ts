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
import type { AssistantInboundSurface } from "./assistant-inbound.types";

type ResolvedQuotaLimits = {
  tokenBudgetLimit: bigint | null;
  activeWebChatsLimit: number;
};

export type AssistantInboundQuotaDecision =
  | { mode: "allow" }
  | {
      mode: "degrade_allowed";
      reason: AssistantInboundQuotaDegradeReason;
    };

export type AssistantInboundQuotaDegradeReason = "token_budget_limit_reached";

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
  }): Promise<AssistantInboundQuotaDecision> {
    const governance = await this.resolveGovernance(params.assistant.id);
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant: params.assistant,
      governance
    });
    const limits = await this.resolveLimits(params.assistant, governance);

    const surfaceAllowed = (() => {
      switch (params.surface) {
        case "web_chat":
        case "reminder_callback":
          return effectiveCapabilities.channelsAndSurfaces.webChat;
        case "telegram":
          return effectiveCapabilities.channelsAndSurfaces.telegram;
        case "whatsapp":
          return effectiveCapabilities.channelsAndSurfaces.whatsapp;
        case "max":
          return effectiveCapabilities.channelsAndSurfaces.max;
      }
    })();

    if (!surfaceAllowed) {
      throw createAssistantInboundConflict(
        "plan_feature_unavailable",
        `Inbound surface "${params.surface}" is unavailable for this assistant under current plan/governance capabilities.`
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

    if (
      params.surface === "web_chat" &&
      params.isNewThread &&
      params.activeSurfaceChatsCount >= limits.activeWebChatsLimit
    ) {
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
      return {
        mode: "degrade_allowed",
        reason: "token_budget_limit_reached"
      };
    }

    return { mode: "allow" };
  }

  async enforceWebChatTurn(params: {
    assistant: Assistant;
    isNewThread: boolean;
    activeWebChatsCount: number;
  }): Promise<AssistantInboundQuotaDecision> {
    return this.enforceInboundTurn({
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
      assistantPlanOverrideCode: governance.assistantPlanOverrideCode,
      assistantQuotaPlanCode: governance.quotaPlanCode
    });
    const plan =
      effectiveSubscription.planCode === null
        ? null
        : await this.assistantPlanCatalogRepository.findByCode(effectiveSubscription.planCode);

    const planHints = asObject(plan?.billingProviderHints ?? null);
    const quotaHints = asObject(planHints?.quotaAccounting ?? null);
    const tokenLimitFromHints = asInteger(quotaHints?.tokenBudgetLimit);
    const tokenLimitFromEntitlements = readLimitFromEntitlementLimits(
      plan?.entitlementModel?.limitsPermissions,
      "token_budget_limit"
    );

    return {
      tokenBudgetLimit: BigInt(
        tokenLimitFromHints ?? tokenLimitFromEntitlements ?? config.QUOTA_TOKEN_BUDGET_DEFAULT
      ),
      activeWebChatsLimit: config.WEB_ACTIVE_CHATS_CAP
    };
  }
}
