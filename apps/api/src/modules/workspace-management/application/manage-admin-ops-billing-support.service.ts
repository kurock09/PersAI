import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { ManageWorkspaceSubscriptionLifecycleService } from "./manage-workspace-subscription-lifecycle.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveEffectiveSubscriptionStateService } from "./resolve-effective-subscription-state.service";

export type AdminOpsBillingSupportAction =
  | "initialize_lifecycle_now"
  | "extend_trial"
  | "grant_grace"
  | "extend_grace"
  | "send_billing_reminder"
  | "apply_fallback_now"
  | "restore_paid_manually";

export type AdminOpsBillingSupportActionInput = {
  action: AdminOpsBillingSupportAction;
};

type SubscriptionState = {
  id: string;
  workspaceId: string;
  planCode: string;
  status: string;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  graceStartedAt: Date | null;
  graceEndsAt: Date | null;
  currentPeriodStartedAt: Date | null;
  currentPeriodEndsAt: Date | null;
  billingProvider: string | null;
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
  metadata: unknown;
};

@Injectable()
export class ManageAdminOpsBillingSupportService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly manageWorkspaceSubscriptionLifecycleService: ManageWorkspaceSubscriptionLifecycleService,
    private readonly resolveEffectiveSubscriptionStateService: ResolveEffectiveSubscriptionStateService
  ) {}

  parseActionInput(body: unknown): AdminOpsBillingSupportActionInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const action = (body as Record<string, unknown>).action;
    if (!this.isBillingSupportAction(action)) {
      throw new BadRequestException("Unsupported billing support action.");
    }
    return { action };
  }

  async execute(
    callerUserId: string,
    targetUserId: string,
    input: AdminOpsBillingSupportActionInput,
    stepUpToken: string | null
  ): Promise<{
    ok: true;
    changed: true;
    workspaceId: string;
    action: AdminOpsBillingSupportAction;
    summary: string;
  }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      callerUserId,
      "admin.plan.update",
      stepUpToken
    );
    const assistant = await this.requireAssistantByUserId(targetUserId);
    const current = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId: assistant.workspaceId }
    });
    const governance = await this.prisma.assistantGovernance.findUnique({
      where: { assistantId: assistant.id },
      select: {
        assistantPlanOverrideCode: true,
        quotaPlanCode: true
      }
    });

    const summary = await this.executeAction(
      assistant.id,
      assistant.workspaceId,
      targetUserId,
      current,
      governance,
      input.action
    );
    return {
      ok: true,
      changed: true,
      workspaceId: assistant.workspaceId,
      action: input.action,
      summary
    };
  }

  private async executeAction(
    assistantId: string,
    workspaceId: string,
    userId: string,
    current: SubscriptionState | null,
    governance: {
      assistantPlanOverrideCode: string | null;
      quotaPlanCode: string | null;
    } | null,
    action: AdminOpsBillingSupportAction
  ): Promise<string> {
    switch (action) {
      case "initialize_lifecycle_now": {
        if (current !== null) {
          throw new BadRequestException("Workspace subscription already exists.");
        }
        if (governance?.assistantPlanOverrideCode !== null) {
          throw new BadRequestException(
            "Reset the assistant plan override before initializing lifecycle truth."
          );
        }
        if (governance?.quotaPlanCode === null) {
          throw new BadRequestException(
            "Legacy lifecycle initialization is only available for assistant fallback users."
          );
        }

        const initialized =
          await this.resolveEffectiveSubscriptionStateService.initializeLifecycleNow({
            workspaceId,
            userId,
            source: "admin"
          });
        await this.prisma.assistantGovernance.updateMany({
          where: { assistantId },
          data: { quotaPlanCode: null }
        });
        if (initialized.status === "trialing" && initialized.trialEndsAt !== null) {
          return `Lifecycle initialized from current registration policy on ${initialized.planCode} with trial until ${initialized.trialEndsAt}.`;
        }
        return `Lifecycle initialized from current registration policy on ${initialized.planCode}.`;
      }
      case "extend_trial": {
        this.assertCurrentSubscription(current);
        const nextTrialEndsAt = await this.resolveExtendedTrialEndsAt(current);
        await this.manageWorkspaceSubscriptionLifecycleService.extendTrial({
          workspaceId,
          userId,
          newTrialEndsAt: nextTrialEndsAt.toISOString(),
          source: "admin",
          refs: {
            metadata: {
              adminAction: action
            }
          }
        });
        return `Trial extended until ${nextTrialEndsAt.toISOString()}.`;
      }
      case "grant_grace": {
        this.assertCurrentSubscription(current);
        await this.manageWorkspaceSubscriptionLifecycleService.grantGrace({
          workspaceId,
          userId,
          source: "admin",
          refs: {
            metadata: {
              adminAction: action,
              previousStatus: current.status
            }
          }
        });
        return "Grace granted using the persisted billing lifecycle settings.";
      }
      case "extend_grace": {
        this.assertCurrentSubscription(current);
        const nextGraceEndsAt = this.resolveExtendedGraceEndsAt(current);
        await this.manageWorkspaceSubscriptionLifecycleService.extendGrace({
          workspaceId,
          userId,
          source: "admin",
          refs: {
            metadata: {
              adminAction: action
            }
          }
        });
        return `Grace extended until ${nextGraceEndsAt.toISOString()}.`;
      }
      case "send_billing_reminder": {
        this.assertCurrentSubscription(current);
        await this.manageWorkspaceSubscriptionLifecycleService.recordBillingReminder({
          workspaceId,
          userId,
          source: "admin",
          refs: {
            metadata: {
              adminAction: action,
              status: current.status,
              planCode: current.planCode
            }
          }
        });
        return "Billing reminder notification work created.";
      }
      case "apply_fallback_now": {
        this.assertCurrentSubscription(current);
        await this.manageWorkspaceSubscriptionLifecycleService.applyFallbackNow({
          workspaceId,
          userId,
          source: "admin",
          refs: {
            metadata: {
              adminAction: action,
              previousStatus: current.status,
              previousPlanCode: current.planCode
            }
          }
        });
        return "Workspace moved to the configured fallback plan.";
      }
      case "restore_paid_manually": {
        this.assertCurrentSubscription(current);
        const recovered = await this.resolveManualRestoreContext(workspaceId, current);
        await this.manageWorkspaceSubscriptionLifecycleService.activatePaidSubscription({
          workspaceId,
          userId,
          paidPlanCode: recovered.planCode,
          currentPeriodStartedAt: recovered.periodStartedAt.toISOString(),
          currentPeriodEndsAt: recovered.periodEndsAt.toISOString(),
          billingProvider: current.billingProvider,
          providerCustomerRef: current.providerCustomerRef,
          providerSubscriptionRef: current.providerSubscriptionRef,
          source: "admin",
          refs: {
            metadata: {
              adminAction: action,
              restoredFromStatus: current.status,
              restoredFromPlanCode: current.planCode
            }
          },
          eventCode: "payment_activated",
          lifecycleReason: "payment_activated"
        });
        return `Paid access restored on ${recovered.planCode} until ${recovered.periodEndsAt.toISOString()}.`;
      }
    }
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

  private async requireWorkspaceSubscription(workspaceId: string): Promise<SubscriptionState> {
    const subscription = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId }
    });
    if (subscription === null) {
      throw new NotFoundException("Workspace subscription not found.");
    }
    return subscription;
  }

  private assertCurrentSubscription(
    current: SubscriptionState | null
  ): asserts current is SubscriptionState {
    if (current === null) {
      throw new NotFoundException("Workspace subscription not found.");
    }
  }

  private async resolveExtendedTrialEndsAt(current: SubscriptionState): Promise<Date> {
    if (current.status !== "trialing") {
      throw new BadRequestException("Trial can only be extended while the workspace is trialing.");
    }
    if (current.trialEndsAt === null) {
      throw new BadRequestException("Trial extension requires an existing trial end date.");
    }

    const anchor = current.trialStartedAt ?? current.currentPeriodStartedAt;
    let extensionMs =
      anchor !== null ? current.trialEndsAt.getTime() - anchor.getTime() : Number.NaN;
    if (!Number.isFinite(extensionMs) || extensionMs <= 0) {
      const plan = await this.prisma.planCatalogPlan.findUnique({
        where: { code: current.planCode },
        select: { trialDurationDays: true, isTrialPlan: true }
      });
      if (
        plan?.isTrialPlan !== true ||
        plan.trialDurationDays === null ||
        plan.trialDurationDays <= 0
      ) {
        throw new BadRequestException("Trial extension requires a valid trial duration policy.");
      }
      extensionMs = plan.trialDurationDays * 86_400_000;
    }

    const base = current.trialEndsAt.getTime() > Date.now() ? current.trialEndsAt : new Date();
    return new Date(base.getTime() + extensionMs);
  }

  private resolveExtendedGraceEndsAt(current: SubscriptionState): Date {
    if (current.status !== "grace_period") {
      throw new BadRequestException("Grace can only be extended while the workspace is in grace.");
    }
    if (current.graceStartedAt === null || current.graceEndsAt === null) {
      throw new BadRequestException("Grace extension requires an existing grace window.");
    }
    const currentDurationMs = current.graceEndsAt.getTime() - current.graceStartedAt.getTime();
    if (!Number.isFinite(currentDurationMs) || currentDurationMs <= 0) {
      throw new BadRequestException("Grace extension requires a valid current grace window.");
    }
    const base = current.graceEndsAt.getTime() > Date.now() ? current.graceEndsAt : new Date();
    return new Date(base.getTime() + currentDurationMs);
  }

  private async resolveManualRestoreContext(
    workspaceId: string,
    current: SubscriptionState
  ): Promise<{ planCode: string; periodStartedAt: Date; periodEndsAt: Date }> {
    if (current.status !== "expired_fallback") {
      throw new BadRequestException(
        "Manual paid restore is only available after the workspace moved to fallback."
      );
    }

    const latestPaidPeriod = await this.prisma.workspaceSubscriptionLifecycleEvent.findFirst({
      where: {
        workspaceId,
        nextStatus: "active",
        nextPlanCode: { not: null },
        nextPeriodStartedAt: { not: null },
        nextPeriodEndsAt: { not: null }
      },
      orderBy: { createdAt: "desc" },
      select: {
        nextPlanCode: true,
        nextPeriodStartedAt: true,
        nextPeriodEndsAt: true
      }
    });
    if (
      latestPaidPeriod === null ||
      latestPaidPeriod.nextPlanCode === null ||
      latestPaidPeriod.nextPeriodStartedAt === null ||
      latestPaidPeriod.nextPeriodEndsAt === null
    ) {
      throw new BadRequestException(
        "Manual paid restore needs a previous paid lifecycle period to copy."
      );
    }

    const durationMs =
      latestPaidPeriod.nextPeriodEndsAt.getTime() - latestPaidPeriod.nextPeriodStartedAt.getTime();
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new BadRequestException("Previous paid lifecycle period is invalid.");
    }

    const periodStartedAt = new Date();
    const periodEndsAt = new Date(periodStartedAt.getTime() + durationMs);
    return {
      planCode: latestPaidPeriod.nextPlanCode,
      periodStartedAt,
      periodEndsAt
    };
  }

  private isBillingSupportAction(value: unknown): value is AdminOpsBillingSupportAction {
    return (
      value === "initialize_lifecycle_now" ||
      value === "extend_trial" ||
      value === "grant_grace" ||
      value === "extend_grace" ||
      value === "send_billing_reminder" ||
      value === "apply_fallback_now" ||
      value === "restore_paid_manually"
    );
  }
}
