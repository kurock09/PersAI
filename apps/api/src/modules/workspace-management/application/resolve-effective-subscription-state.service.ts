import { BadRequestException, forwardRef, Inject, Injectable } from "@nestjs/common";
import type { EffectiveSubscriptionState } from "./effective-subscription.types";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalog } from "../domain/assistant-plan-catalog.entity";
import {
  WORKSPACE_SUBSCRIPTION_REPOSITORY,
  type WorkspaceSubscriptionRepository
} from "../domain/workspace-subscription.repository";
import type { WorkspaceSubscription } from "../domain/workspace-subscription.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { resolveStoredPlanLifecyclePolicy } from "./plan-lifecycle-policy";
import { ManageWorkspaceSubscriptionLifecycleService } from "./manage-workspace-subscription-lifecycle.service";
import { BillingLifecycleProducerService } from "./billing-lifecycle-producer.service";

export type ResolveEffectiveSubscriptionInput = {
  userId: string;
  workspaceId: string;
  assistantId: string;
  assistantPlanOverrideCode: string | null;
  assistantQuotaPlanCode: string | null;
};

export type InitializeLifecycleNowInput = {
  userId: string;
  workspaceId: string;
  source: "system" | "admin";
};

@Injectable()
export class ResolveEffectiveSubscriptionStateService {
  constructor(
    @Inject(WORKSPACE_SUBSCRIPTION_REPOSITORY)
    private readonly workspaceSubscriptionRepository: WorkspaceSubscriptionRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly BillingLifecycleProducerService: BillingLifecycleProducerService,
    @Inject(forwardRef(() => ManageWorkspaceSubscriptionLifecycleService))
    private readonly manageWorkspaceSubscriptionLifecycleService: ManageWorkspaceSubscriptionLifecycleService
  ) {}

  /**
   * P3 precedence order:
   * 1) assistant governance explicit plan override
   * 2) workspace subscription row
   * 3) assistant governance quota plan fallback
   * 4) catalog default first-registration fallback
   * 5) none
   */
  async execute(input: ResolveEffectiveSubscriptionInput): Promise<EffectiveSubscriptionState> {
    const resolved = await this.resolveWithoutInitializing(input);
    if (resolved !== null) {
      return resolved;
    }

    const defaultPlan = await this.planCatalogRepository.findDefaultRegistrationPlan();
    if (defaultPlan !== null) {
      return this.createInitialWorkspaceSubscription(input.workspaceId, input.userId, defaultPlan);
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

  async executeReadOnly(
    input: ResolveEffectiveSubscriptionInput
  ): Promise<EffectiveSubscriptionState> {
    const resolved = await this.resolveWithoutInitializing(input);
    if (resolved !== null) {
      return resolved;
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

  private async resolveWithoutInitializing(
    input: ResolveEffectiveSubscriptionInput
  ): Promise<EffectiveSubscriptionState | null> {
    if (input.assistantPlanOverrideCode !== null) {
      return {
        source: "assistant_plan_override",
        status: "unconfigured",
        planCode: input.assistantPlanOverrideCode,
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      };
    }

    const workspaceSubscription = await this.workspaceSubscriptionRepository.findByWorkspaceId(
      input.workspaceId
    );
    if (workspaceSubscription !== null) {
      return this.resolveWorkspaceSubscription(input, workspaceSubscription);
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

    return null;
  }

  async initializeLifecycleNow(
    input: InitializeLifecycleNowInput
  ): Promise<EffectiveSubscriptionState> {
    const current = await this.workspaceSubscriptionRepository.findByWorkspaceId(input.workspaceId);
    if (current !== null) {
      throw new BadRequestException("Workspace subscription already exists.");
    }

    const defaultPlan = await this.planCatalogRepository.findDefaultRegistrationPlan();
    if (defaultPlan === null) {
      throw new BadRequestException("Default registration plan is not configured.");
    }

    return this.createInitialWorkspaceSubscription(input.workspaceId, input.userId, defaultPlan, {
      source: input.source
    });
  }

  private async resolveWorkspaceSubscription(
    input: ResolveEffectiveSubscriptionInput,
    workspaceSubscription: WorkspaceSubscription
  ): Promise<EffectiveSubscriptionState> {
    if (
      workspaceSubscription.cancelAtPeriodEnd &&
      workspaceSubscription.currentPeriodEndsAt !== null &&
      workspaceSubscription.currentPeriodEndsAt.getTime() <= Date.now()
    ) {
      await this.manageWorkspaceSubscriptionLifecycleService.applyCancelledPaidPeriodEndFallback({
        workspaceId: input.workspaceId,
        userId: input.userId,
        now: new Date()
      });
      const refreshed = await this.workspaceSubscriptionRepository.findByWorkspaceId(
        input.workspaceId
      );
      if (refreshed !== null) {
        return this.toEffectiveWorkspaceSubscription(refreshed);
      }
    }
    if (
      workspaceSubscription.status === "trialing" &&
      workspaceSubscription.trialEndsAt !== null &&
      workspaceSubscription.trialEndsAt.getTime() <= Date.now()
    ) {
      return this.applyExpiredTrialFallback(input.workspaceId, input.userId, workspaceSubscription);
    }

    return this.toEffectiveWorkspaceSubscription(workspaceSubscription);
  }

  private async createInitialWorkspaceSubscription(
    workspaceId: string,
    userId: string,
    defaultPlan: AssistantPlanCatalog,
    options?: {
      source?: "system" | "admin";
    }
  ): Promise<EffectiveSubscriptionState> {
    const source = options?.source ?? "system";
    if (defaultPlan.status !== "active") {
      throw new BadRequestException("Default registration plan must be active.");
    }

    const now = new Date();
    const trialPolicy = await this.resolveInitialTrialPolicy(defaultPlan, now);
    const created = await this.workspaceSubscriptionRepository.upsertFromBillingSnapshot({
      workspaceId,
      planCode: defaultPlan.code,
      status: trialPolicy.status,
      billingProvider: null,
      trialStartedAt: trialPolicy.trialStartedAt,
      trialEndsAt: trialPolicy.trialEndsAt,
      graceStartedAt: null,
      graceEndsAt: null,
      currentPeriodStartedAt: trialPolicy.currentPeriodStartedAt,
      currentPeriodEndsAt: trialPolicy.currentPeriodEndsAt,
      cancelAtPeriodEnd: false,
      providerCustomerRef: null,
      providerSubscriptionRef: null,
      metadata: {
        schema: "persai.subscriptionLifecycle.v1",
        lifecycleState: trialPolicy.status,
        lifecycleReason: defaultPlan.isTrialPlan
          ? "registration_default_trial"
          : "registration_default_plan",
        ...(trialPolicy.trialFallbackPlanCode !== null
          ? { trialFallbackPlanCode: trialPolicy.trialFallbackPlanCode }
          : {})
      }
    });
    const lifecycleEventIds: string[] = [];
    if (created.status === "trialing") {
      lifecycleEventIds.push(
        await this.appendLifecycleEvent({
          workspaceId,
          userId,
          subscriptionId: created.id,
          eventCode: "trial_started",
          previous: null,
          next: created,
          source
        })
      );
    }
    await this.markWorkspaceAssistantsConfigDirty(workspaceId);
    await this.BillingLifecycleProducerService.emitForLifecycleEventIds(lifecycleEventIds);
    return {
      ...this.toEffectiveWorkspaceSubscription(created),
      source: "catalog_default_fallback"
    };
  }

  private async resolveInitialTrialPolicy(
    defaultPlan: AssistantPlanCatalog,
    now: Date
  ): Promise<{
    status: "trialing" | "active";
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    currentPeriodStartedAt: string | null;
    currentPeriodEndsAt: string | null;
    trialFallbackPlanCode: string | null;
  }> {
    if (!defaultPlan.isTrialPlan) {
      return {
        status: "active",
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodStartedAt: null,
        currentPeriodEndsAt: null,
        trialFallbackPlanCode: null
      };
    }

    if (typeof defaultPlan.trialDurationDays !== "number" || defaultPlan.trialDurationDays <= 0) {
      throw new BadRequestException("Trial default registration plan must have trial duration.");
    }
    const lifecyclePolicy = resolveStoredPlanLifecyclePolicy(defaultPlan.billingProviderHints);
    const fallbackPlanCode = lifecyclePolicy.trialFallbackPlanCode;
    if (fallbackPlanCode === null) {
      throw new BadRequestException("Trial default registration plan must have a fallback plan.");
    }
    await this.assertFallbackPlanIsActive(fallbackPlanCode);

    const endsAt = new Date(now.getTime() + defaultPlan.trialDurationDays * 86_400_000);
    return {
      status: "trialing",
      trialStartedAt: now.toISOString(),
      trialEndsAt: endsAt.toISOString(),
      currentPeriodStartedAt: now.toISOString(),
      currentPeriodEndsAt: endsAt.toISOString(),
      trialFallbackPlanCode: fallbackPlanCode
    };
  }

  private async applyExpiredTrialFallback(
    workspaceId: string,
    userId: string,
    workspaceSubscription: WorkspaceSubscription
  ): Promise<EffectiveSubscriptionState> {
    const trialPlan = await this.planCatalogRepository.findByCode(workspaceSubscription.planCode);
    if (trialPlan === null) {
      throw new BadRequestException("Expired trial plan no longer exists.");
    }
    const fallbackPlanCode = resolveStoredPlanLifecyclePolicy(
      trialPlan.billingProviderHints
    ).trialFallbackPlanCode;
    if (fallbackPlanCode === null) {
      throw new BadRequestException("Expired trial plan does not have a fallback plan.");
    }
    await this.assertFallbackPlanIsActive(fallbackPlanCode);

    const updated = await this.workspaceSubscriptionRepository.upsertFromBillingSnapshot({
      workspaceId,
      planCode: fallbackPlanCode,
      status: "expired_fallback",
      billingProvider: null,
      trialStartedAt: workspaceSubscription.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: workspaceSubscription.trialEndsAt?.toISOString() ?? null,
      graceStartedAt: null,
      graceEndsAt: null,
      currentPeriodStartedAt: null,
      currentPeriodEndsAt: null,
      cancelAtPeriodEnd: false,
      providerCustomerRef: null,
      providerSubscriptionRef: null,
      metadata: {
        schema: "persai.subscriptionLifecycle.v1",
        lifecycleState: "trial_expired_fallback",
        lifecycleReason: "trial_expired_without_payment",
        previousPlanCode: workspaceSubscription.planCode,
        fallbackPlanCode,
        trialStartedAt: workspaceSubscription.trialStartedAt?.toISOString() ?? null,
        trialEndsAt: workspaceSubscription.trialEndsAt?.toISOString() ?? null
      }
    });
    const lifecycleEventIds: string[] = [];
    lifecycleEventIds.push(
      await this.appendLifecycleEvent({
        workspaceId,
        userId,
        subscriptionId: updated.id,
        eventCode: "trial_expired",
        previous: workspaceSubscription,
        next: updated,
        source: "system"
      })
    );
    lifecycleEventIds.push(
      await this.appendLifecycleEvent({
        workspaceId,
        userId,
        subscriptionId: updated.id,
        eventCode: "fallback_applied",
        previous: workspaceSubscription,
        next: updated,
        source: "system"
      })
    );
    await this.markWorkspaceAssistantsConfigDirty(workspaceId);
    await this.BillingLifecycleProducerService.emitForLifecycleEventIds(lifecycleEventIds);
    return {
      ...this.toEffectiveWorkspaceSubscription(updated),
      source: "subscription_trial_fallback"
    };
  }

  private async assertFallbackPlanIsActive(planCode: string): Promise<void> {
    const fallbackPlan = await this.planCatalogRepository.findByCode(planCode);
    if (fallbackPlan === null || fallbackPlan.status !== "active") {
      throw new BadRequestException("Subscription fallback plan must reference an active plan.");
    }
  }

  private toEffectiveWorkspaceSubscription(
    workspaceSubscription: WorkspaceSubscription
  ): EffectiveSubscriptionState {
    return {
      source: this.resolveWorkspaceSubscriptionSource(workspaceSubscription),
      status: workspaceSubscription.status,
      planCode: workspaceSubscription.planCode,
      trialEndsAt: workspaceSubscription.trialEndsAt?.toISOString() ?? null,
      graceStartedAt: workspaceSubscription.graceStartedAt?.toISOString() ?? null,
      graceEndsAt: workspaceSubscription.graceEndsAt?.toISOString() ?? null,
      currentPeriodStartedAt: workspaceSubscription.currentPeriodStartedAt?.toISOString() ?? null,
      currentPeriodEndsAt: workspaceSubscription.currentPeriodEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: workspaceSubscription.cancelAtPeriodEnd
    };
  }

  private resolveWorkspaceSubscriptionSource(
    workspaceSubscription: WorkspaceSubscription
  ): EffectiveSubscriptionState["source"] {
    if (workspaceSubscription.status !== "expired_fallback") {
      return "workspace_subscription";
    }
    const metadata =
      workspaceSubscription.metadata !== null &&
      typeof workspaceSubscription.metadata === "object" &&
      !Array.isArray(workspaceSubscription.metadata)
        ? (workspaceSubscription.metadata as Record<string, unknown>)
        : {};
    return metadata.lifecycleReason === "trial_expired_without_payment"
      ? "subscription_trial_fallback"
      : "subscription_paid_fallback";
  }

  private async markWorkspaceAssistantsConfigDirty(workspaceId: string): Promise<void> {
    await this.prisma.assistant.updateMany({
      where: { workspaceId },
      data: { configDirtyAt: new Date() }
    });
  }

  private async appendLifecycleEvent(input: {
    workspaceId: string;
    userId: string | null;
    subscriptionId: string;
    eventCode: string;
    previous: WorkspaceSubscription | null;
    next: WorkspaceSubscription;
    source: "system" | "admin" | "provider" | "manual";
  }): Promise<string> {
    const event = await this.prisma.workspaceSubscriptionLifecycleEvent.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        eventCode: input.eventCode,
        previousStatus: input.previous?.status ?? null,
        nextStatus: input.next.status,
        previousPlanCode: input.previous?.planCode ?? null,
        nextPlanCode: input.next.planCode,
        previousPeriodStartedAt: input.previous?.currentPeriodStartedAt ?? null,
        previousPeriodEndsAt: input.previous?.currentPeriodEndsAt ?? null,
        nextPeriodStartedAt: input.next.currentPeriodStartedAt,
        nextPeriodEndsAt: input.next.currentPeriodEndsAt,
        source: input.source,
        metadata: {}
      }
    });
    return event.id;
  }
}
