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
  | "activate_paid_manually";

export type AdminOpsManualPaidActivationInput = {
  planCode: string;
  billingPeriod: "month" | "year";
};

export type AdminOpsBillingSupportActionInput =
  | {
      action: Exclude<AdminOpsBillingSupportAction, "activate_paid_manually">;
    }
  | {
      action: "activate_paid_manually";
      manualPayment: AdminOpsManualPaidActivationInput;
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

function addBillingPeriod(startAt: Date, billingPeriod: "month" | "year"): Date {
  const next = new Date(startAt);
  if (billingPeriod === "year") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

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
    if (action === "activate_paid_manually") {
      return {
        action,
        manualPayment: this.parseManualPaidActivationInput(body)
      };
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
      input
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
    input: AdminOpsBillingSupportActionInput
  ): Promise<string> {
    const action = input.action;
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
      case "activate_paid_manually": {
        this.assertCurrentSubscription(current);
        const manualPayment = input.manualPayment;
        const validatedPlanCode = await this.requireManualPaidPlanCode(manualPayment.planCode);
        const periodStartedAt = new Date();
        const periodEndsAt = addBillingPeriod(periodStartedAt, manualPayment.billingPeriod);
        await this.manageWorkspaceSubscriptionLifecycleService.activatePaidSubscription({
          workspaceId,
          userId,
          paidPlanCode: validatedPlanCode,
          currentPeriodStartedAt: periodStartedAt.toISOString(),
          currentPeriodEndsAt: periodEndsAt.toISOString(),
          billingProvider: current.billingProvider ?? null,
          providerCustomerRef: current.providerCustomerRef ?? null,
          providerSubscriptionRef: current.providerSubscriptionRef ?? null,
          source: "admin",
          refs: {
            metadata: {
              adminAction: action,
              manualPayment: {
                planCode: validatedPlanCode,
                billingPeriod: manualPayment.billingPeriod
              },
              previousStatus: current.status,
              previousPlanCode: current.planCode
            }
          },
          eventCode: "payment_activated",
          lifecycleReason: "payment_activated"
        });
        return `Manual/admin paid activation applied on ${validatedPlanCode} until ${periodEndsAt.toISOString()}.`;
      }
    }
  }

  private parseManualPaidActivationInput(body: unknown): AdminOpsManualPaidActivationInput {
    const manualPayment =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).manualPayment
        : null;
    if (
      manualPayment === null ||
      typeof manualPayment !== "object" ||
      Array.isArray(manualPayment)
    ) {
      throw new BadRequestException(
        "manualPayment with planCode and billingPeriod is required for manual paid activation."
      );
    }
    const manualPaymentRecord = manualPayment as Record<string, unknown>;
    const planCode =
      typeof manualPaymentRecord.planCode === "string" ? manualPaymentRecord.planCode.trim() : "";
    if (planCode.length === 0) {
      throw new BadRequestException("manualPayment.planCode is required.");
    }
    const billingPeriod = manualPaymentRecord.billingPeriod;
    if (billingPeriod !== "month" && billingPeriod !== "year") {
      throw new BadRequestException("manualPayment.billingPeriod must be one of: month, year.");
    }
    return {
      planCode,
      billingPeriod
    };
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

  private async requireManualPaidPlanCode(planCode: string): Promise<string> {
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: {
        status: true,
        isTrialPlan: true,
        billingProviderHints: true
      }
    });
    if (plan === null || plan.status !== "active") {
      throw new BadRequestException("Manual paid activation requires an active paid plan.");
    }
    if (plan.isTrialPlan) {
      throw new BadRequestException("Manual paid activation cannot target a trial plan.");
    }
    if (isZeroPricePlan(plan.billingProviderHints)) {
      throw new BadRequestException(
        "Manual paid activation cannot target FREE. Use Apply fallback now instead."
      );
    }
    return planCode;
  }

  private isBillingSupportAction(value: unknown): value is AdminOpsBillingSupportAction {
    return (
      value === "initialize_lifecycle_now" ||
      value === "extend_trial" ||
      value === "grant_grace" ||
      value === "extend_grace" ||
      value === "send_billing_reminder" ||
      value === "apply_fallback_now" ||
      value === "activate_paid_manually"
    );
  }
}

function isZeroPricePlan(billingProviderHints: unknown): boolean {
  const hints = asObject(billingProviderHints);
  const presentation = asObject(hints?.presentation);
  const price = asObject(presentation?.price);
  return typeof price?.amount === "number" && price.amount <= 0;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
