import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { BillingProviderSubscriptionSnapshot } from "./billing-provider.port";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  WORKSPACE_SUBSCRIPTION_REPOSITORY,
  type WorkspaceSubscriptionRepository
} from "../domain/workspace-subscription.repository";
import {
  ASSISTANT_PLAN_CATALOG_REPOSITORY,
  type AssistantPlanCatalogRepository
} from "../domain/assistant-plan-catalog.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type {
  WorkspaceSubscription,
  WorkspaceSubscriptionStatus
} from "../domain/workspace-subscription.entity";
import { resolveStoredPlanLifecyclePolicy } from "./plan-lifecycle-policy";
import { ApplyWorkspaceSubscriptionBillingEventService } from "./apply-workspace-subscription-billing-event.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { MaterializationRolloutService } from "./materialization-rollout.service";

const WORKSPACE_SUBSCRIPTION_STATUSES: readonly WorkspaceSubscriptionStatus[] = [
  "trialing",
  "active",
  "grace_period",
  "past_due",
  "paused",
  "canceled",
  "expired",
  "expired_fallback"
] as const;

export type AdminWorkspaceSubscriptionInput = {
  planCode: string;
  status?: WorkspaceSubscriptionStatus;
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  graceStartedAt?: string | null;
  graceEndsAt?: string | null;
  currentPeriodStartedAt?: string | null;
  currentPeriodEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  billingProvider?: string | null;
  providerCustomerRef?: string | null;
  providerSubscriptionRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class ManageAdminWorkspaceSubscriptionService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(WORKSPACE_SUBSCRIPTION_REPOSITORY)
    private readonly workspaceSubscriptionRepository: WorkspaceSubscriptionRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly planCatalogRepository: AssistantPlanCatalogRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly applyWorkspaceSubscriptionBillingEventService: ApplyWorkspaceSubscriptionBillingEventService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly materializationRolloutService: MaterializationRolloutService
  ) {}

  parseApplyInput(body: unknown): AdminWorkspaceSubscriptionInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const record = body as Record<string, unknown>;
    const status = this.parseOptionalStatus(record.status);
    const trialStartedAt = this.parseOptionalIsoDate(record.trialStartedAt, "trialStartedAt");
    const trialEndsAt = this.parseOptionalIsoDate(record.trialEndsAt, "trialEndsAt");
    const currentPeriodStartedAt = this.parseOptionalIsoDate(
      record.currentPeriodStartedAt,
      "currentPeriodStartedAt"
    );
    const graceStartedAt = this.parseOptionalIsoDate(record.graceStartedAt, "graceStartedAt");
    const graceEndsAt = this.parseOptionalIsoDate(record.graceEndsAt, "graceEndsAt");
    const currentPeriodEndsAt = this.parseOptionalIsoDate(
      record.currentPeriodEndsAt,
      "currentPeriodEndsAt"
    );
    const cancelAtPeriodEnd = this.parseOptionalBoolean(
      record.cancelAtPeriodEnd,
      "cancelAtPeriodEnd"
    );
    const billingProvider = this.parseOptionalNullableString(
      record.billingProvider,
      "billingProvider"
    );
    const providerCustomerRef = this.parseOptionalNullableString(
      record.providerCustomerRef,
      "providerCustomerRef"
    );
    const providerSubscriptionRef = this.parseOptionalNullableString(
      record.providerSubscriptionRef,
      "providerSubscriptionRef"
    );
    const metadata = this.parseOptionalMetadata(record.metadata);

    return {
      planCode: this.parseRequiredString(record.planCode, "planCode"),
      ...(status !== undefined ? { status } : {}),
      ...(trialStartedAt !== undefined ? { trialStartedAt } : {}),
      ...(trialEndsAt !== undefined ? { trialEndsAt } : {}),
      ...(graceStartedAt !== undefined ? { graceStartedAt } : {}),
      ...(graceEndsAt !== undefined ? { graceEndsAt } : {}),
      ...(currentPeriodStartedAt !== undefined ? { currentPeriodStartedAt } : {}),
      ...(currentPeriodEndsAt !== undefined ? { currentPeriodEndsAt } : {}),
      ...(cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd } : {}),
      ...(billingProvider !== undefined ? { billingProvider } : {}),
      ...(providerCustomerRef !== undefined ? { providerCustomerRef } : {}),
      ...(providerSubscriptionRef !== undefined ? { providerSubscriptionRef } : {}),
      ...(metadata !== undefined ? { metadata } : {})
    };
  }

  async setWorkspaceSubscription(
    callerUserId: string,
    targetUserId: string,
    input: AdminWorkspaceSubscriptionInput,
    stepUpToken: string | null
  ): Promise<{ ok: true; changed: boolean; workspaceId: string }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      callerUserId,
      "admin.plan.update",
      stepUpToken
    );
    const assistant = await this.requireAssistantByUserId(targetUserId);
    const snapshot = await this.toSnapshotWithTrialDefaults(assistant.workspaceId, input);
    const current = await this.workspaceSubscriptionRepository.findByWorkspaceId(
      assistant.workspaceId
    );

    if (current !== null && this.isSameSubscription(current, snapshot)) {
      return { ok: true, changed: false, workspaceId: assistant.workspaceId };
    }

    const adminBillingEventCode = this.resolveAdminBillingEventCode(current, snapshot);
    if (adminBillingEventCode !== null) {
      const result = await this.applyWorkspaceSubscriptionBillingEventService.apply({
        workspaceId: assistant.workspaceId,
        userId: targetUserId,
        source: "manual",
        eventCode: adminBillingEventCode,
        eventRef: null,
        paymentIntentRef: null,
        billingProvider: snapshot.billingProvider,
        providerCustomerRef: snapshot.providerCustomerRef,
        providerSubscriptionRef: snapshot.providerSubscriptionRef,
        paidPlanCode: snapshot.planCode,
        currentPeriodStartedAt: snapshot.currentPeriodStartedAt,
        currentPeriodEndsAt: snapshot.currentPeriodEndsAt,
        metadata: {
          adminAction: "set_workspace_subscription",
          ...(input.metadata ?? {})
        }
      });
      return {
        ok: true,
        changed: result.status === "applied",
        workspaceId: assistant.workspaceId
      };
    }

    await this.workspaceSubscriptionRepository.upsertFromBillingSnapshot(snapshot);
    await this.markWorkspaceAssistantsConfigDirty(assistant.workspaceId);
    await this.queueBillingLifecycleRollout(
      assistant.workspaceId,
      targetUserId,
      "admin_workspace_subscription_set",
      {
        reason: "admin.workspace_subscription.set",
        planCode: snapshot.planCode,
        status: snapshot.status
      }
    );
    return { ok: true, changed: true, workspaceId: assistant.workspaceId };
  }

  async resetWorkspaceSubscription(
    callerUserId: string,
    targetUserId: string,
    stepUpToken: string | null
  ): Promise<{ ok: true; changed: boolean; workspaceId: string }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      callerUserId,
      "admin.plan.update",
      stepUpToken
    );
    const assistant = await this.requireAssistantByUserId(targetUserId);
    const current = await this.workspaceSubscriptionRepository.findByWorkspaceId(
      assistant.workspaceId
    );

    if (current === null) {
      return { ok: true, changed: false, workspaceId: assistant.workspaceId };
    }

    await this.workspaceSubscriptionRepository.deleteByWorkspaceId(assistant.workspaceId);
    await this.markWorkspaceAssistantsConfigDirty(assistant.workspaceId);
    await this.queueBillingLifecycleRollout(
      assistant.workspaceId,
      targetUserId,
      "admin_workspace_subscription_reset",
      {
        reason: "admin.workspace_subscription.reset"
      }
    );
    return { ok: true, changed: true, workspaceId: assistant.workspaceId };
  }

  private async requireAssistantByUserId(targetUserId: string) {
    const trimmedUserId = targetUserId.trim();
    if (trimmedUserId.length === 0) {
      throw new BadRequestException("userId is required.");
    }
    const assistant = await this.assistantRepository.findByUserId(trimmedUserId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found for target user.");
    }
    return assistant;
  }

  private async toSnapshotWithTrialDefaults(
    workspaceId: string,
    input: AdminWorkspaceSubscriptionInput
  ): Promise<BillingProviderSubscriptionSnapshot> {
    const planCode = input.planCode.trim();
    if (planCode.length === 0) {
      throw new BadRequestException("planCode is required.");
    }

    // If the target plan is a trial plan and the admin/UI did not explicitly pass trial dates
    // or status, auto-fill status="trialing" and trialEndsAt = now + plan.trialDurationDays.
    // Without this the /admin/ops one-click "Apply workspace subscription" produced a plan with
    // status="active" and null trial windows on a plan marked isTrialPlan=true, so the user
    // technically moved to the new plan but was never actually in a trial window.
    const plan = await this.planCatalogRepository.findByCode(planCode);
    if (this.isZeroPricePlan(plan?.billingProviderHints ?? null)) {
      throw new BadRequestException(
        "Use Apply fallback now for FREE access instead of Apply workspace subscription."
      );
    }
    const trialDefaults = await this.resolveTrialDefaultsForPlan(plan, input);

    return {
      workspaceId,
      planCode,
      status: input.status ?? trialDefaults.status,
      billingProvider: input.billingProvider ?? null,
      trialStartedAt: input.trialStartedAt ?? trialDefaults.trialStartedAt,
      trialEndsAt: input.trialEndsAt ?? trialDefaults.trialEndsAt,
      graceStartedAt: input.graceStartedAt ?? null,
      graceEndsAt: input.graceEndsAt ?? null,
      currentPeriodStartedAt: input.currentPeriodStartedAt ?? trialDefaults.currentPeriodStartedAt,
      currentPeriodEndsAt: input.currentPeriodEndsAt ?? trialDefaults.currentPeriodEndsAt,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      providerCustomerRef: input.providerCustomerRef ?? null,
      providerSubscriptionRef: input.providerSubscriptionRef ?? null,
      metadata: input.metadata ?? trialDefaults.metadata
    };
  }

  private async resolveTrialDefaultsForPlan(
    plan: {
      code: string;
      isTrialPlan: boolean;
      trialDurationDays: number | null;
      billingProviderHints: unknown | null;
    } | null,
    input: AdminWorkspaceSubscriptionInput
  ): Promise<{
    status: WorkspaceSubscriptionStatus;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    currentPeriodStartedAt: string | null;
    currentPeriodEndsAt: string | null;
    metadata: Record<string, unknown> | null;
  }> {
    const adminPassedAnyTrialField =
      input.status !== undefined ||
      input.trialStartedAt !== undefined ||
      input.trialEndsAt !== undefined;
    if (
      !adminPassedAnyTrialField &&
      plan !== null &&
      plan.isTrialPlan === true &&
      typeof plan.trialDurationDays === "number" &&
      plan.trialDurationDays > 0
    ) {
      const fallbackPlanCode = resolveStoredPlanLifecyclePolicy(
        plan.billingProviderHints
      ).trialFallbackPlanCode;
      if (fallbackPlanCode === null) {
        throw new BadRequestException("Trial plan must have a fallback plan before assignment.");
      }
      const fallbackPlan = await this.planCatalogRepository.findByCode(fallbackPlanCode);
      if (fallbackPlan === null || fallbackPlan.status !== "active") {
        throw new BadRequestException("Trial fallback plan must reference an active plan.");
      }
      const now = new Date();
      const endsAt = new Date(now.getTime() + plan.trialDurationDays * 86400_000);
      return {
        status: "trialing",
        trialStartedAt: now.toISOString(),
        trialEndsAt: endsAt.toISOString(),
        currentPeriodStartedAt: now.toISOString(),
        currentPeriodEndsAt: endsAt.toISOString(),
        metadata: {
          schema: "persai.subscriptionLifecycle.v1",
          lifecycleState: "trialing",
          lifecycleReason: "admin_trial_assignment",
          trialFallbackPlanCode: fallbackPlanCode
        }
      };
    }
    return {
      status: "active",
      trialStartedAt: null,
      trialEndsAt: null,
      currentPeriodStartedAt: null,
      currentPeriodEndsAt: null,
      metadata: null
    };
  }

  private async markWorkspaceAssistantsConfigDirty(workspaceId: string): Promise<void> {
    await this.prisma.assistant.updateMany({
      where: { workspaceId },
      data: { configDirtyAt: new Date() }
    });
  }

  private async queueBillingLifecycleRollout(
    workspaceId: string,
    actorUserId: string | null,
    reason: string,
    scopeMetadata: Record<string, unknown>
  ): Promise<void> {
    const targetGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId,
      workspaceId,
      rolloutType: "billing_lifecycle_change",
      triggerSource: "billing_lifecycle",
      scopeType: "affected_policy",
      criticality: "hard",
      targetGeneration,
      scopeMetadata: {
        reason,
        ...scopeMetadata
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Billing lifecycle queued a materialization rollout."
    });
  }

  private isSameSubscription(
    current: WorkspaceSubscription,
    next: BillingProviderSubscriptionSnapshot
  ): boolean {
    return (
      current.workspaceId === next.workspaceId &&
      current.planCode === next.planCode &&
      current.status === next.status &&
      current.billingProvider === next.billingProvider &&
      this.sameDate(current.trialStartedAt, next.trialStartedAt) &&
      this.sameDate(current.trialEndsAt, next.trialEndsAt) &&
      this.sameDate(current.graceStartedAt, next.graceStartedAt ?? null) &&
      this.sameDate(current.graceEndsAt, next.graceEndsAt ?? null) &&
      this.sameDate(current.currentPeriodStartedAt, next.currentPeriodStartedAt) &&
      this.sameDate(current.currentPeriodEndsAt, next.currentPeriodEndsAt) &&
      current.cancelAtPeriodEnd === next.cancelAtPeriodEnd &&
      current.providerCustomerRef === next.providerCustomerRef &&
      current.providerSubscriptionRef === next.providerSubscriptionRef &&
      JSON.stringify(current.metadata ?? null) === JSON.stringify(next.metadata ?? null)
    );
  }

  private resolveAdminBillingEventCode(
    current: WorkspaceSubscription | null,
    next: BillingProviderSubscriptionSnapshot
  ): "payment_activated" | "renewal_succeeded" | "payment_recovered" | null {
    if (
      next.status !== "active" ||
      next.currentPeriodStartedAt === null ||
      next.currentPeriodEndsAt === null
    ) {
      return null;
    }

    if (current?.status === "grace_period" || current?.status === "past_due") {
      return "payment_recovered";
    }

    if (
      current?.status === "active" &&
      current.planCode === next.planCode &&
      current.currentPeriodEndsAt !== null &&
      current.currentPeriodEndsAt.toISOString() !== next.currentPeriodEndsAt
    ) {
      return "renewal_succeeded";
    }

    return "payment_activated";
  }

  private sameDate(current: Date | null, next: string | null): boolean {
    return (current?.toISOString() ?? null) === next;
  }

  private parseRequiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }

  private parseOptionalStatus(value: unknown): WorkspaceSubscriptionStatus | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "string" || !WORKSPACE_SUBSCRIPTION_STATUSES.includes(value as never)) {
      throw new BadRequestException(
        `status must be one of: ${WORKSPACE_SUBSCRIPTION_STATUSES.join(", ")}.`
      );
    }
    return value as WorkspaceSubscriptionStatus;
  }

  private parseOptionalIsoDate(value: unknown, field: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be an ISO datetime string or null.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO datetime string.`);
    }
    return parsed.toISOString();
  }

  private parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "boolean") {
      throw new BadRequestException(`${field} must be a boolean.`);
    }
    return value;
  }

  private parseOptionalNullableString(value: unknown, field: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be a string or null.`);
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private parseOptionalMetadata(value: unknown): Record<string, unknown> | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("metadata must be an object or null.");
    }
    return value as Record<string, unknown>;
  }

  private isZeroPricePlan(billingProviderHints: unknown): boolean {
    const hints = asObject(billingProviderHints);
    const presentation = asObject(hints?.presentation);
    const price = asObject(presentation?.price);
    return typeof price?.amount === "number" && price.amount <= 0;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
