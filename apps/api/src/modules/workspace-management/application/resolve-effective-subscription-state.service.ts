import { Inject, Injectable } from "@nestjs/common";
import type { EffectiveSubscriptionState } from "./effective-subscription.types";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import {
  WORKSPACE_SUBSCRIPTION_REPOSITORY,
  type WorkspaceSubscriptionRepository
} from "../domain/workspace-subscription.repository";

export type ResolveEffectiveSubscriptionInput = {
  userId: string;
  workspaceId: string;
  assistantId: string;
  assistantQuotaPlanCode: string | null;
};

@Injectable()
export class ResolveEffectiveSubscriptionStateService {
  constructor(
    @Inject(WORKSPACE_SUBSCRIPTION_REPOSITORY)
    private readonly workspaceSubscriptionRepository: WorkspaceSubscriptionRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository
  ) {}

  /**
   * P3 precedence order:
   * 1) workspace subscription row
   * 2) assistant governance quota plan fallback
   * 3) catalog default first-registration fallback
   * 4) none
   */
  async execute(input: ResolveEffectiveSubscriptionInput): Promise<EffectiveSubscriptionState> {
    const workspaceSubscription = await this.workspaceSubscriptionRepository.findByWorkspaceId(
      input.workspaceId
    );
    if (workspaceSubscription !== null) {
      return {
        source: "workspace_subscription",
        status: workspaceSubscription.status,
        planCode: workspaceSubscription.planCode,
        trialEndsAt: workspaceSubscription.trialEndsAt?.toISOString() ?? null,
        currentPeriodEndsAt: workspaceSubscription.currentPeriodEndsAt?.toISOString() ?? null,
        cancelAtPeriodEnd: workspaceSubscription.cancelAtPeriodEnd
      };
    }

    if (input.assistantQuotaPlanCode !== null) {
      return {
        source: "assistant_plan_fallback",
        status: "unconfigured",
        planCode: input.assistantQuotaPlanCode,
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      };
    }

    const defaultPlan = await this.planCatalogRepository.findDefaultRegistrationPlan();
    if (defaultPlan !== null) {
      return {
        source: "catalog_default_fallback",
        status: "unconfigured",
        planCode: defaultPlan.code,
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      };
    }

    return {
      source: "none",
      status: "unconfigured",
      planCode: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false
    };
  }
}
