import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { NotificationIntentService } from "./notifications/notification-intent.service";
import type { BillingLifecycleFactPayload } from "./notifications/templates/billing/billing-lifecycle-fact-payload";

/**
 * Billing lifecycle notification producer.
 *
 * For each billing lifecycle event id, resolves the global notification policy
 * for source=billing_lifecycle, determines which rules apply, and calls
 * NotificationIntentService.createIntent for each.
 *
 * Email intent: class=transactional, priority=scheduled, renderStrategy=template,
 *   allowedChannels=["email"], dedupeKey=rule:workspaceId:eventId, traceId=eventId.
 * Optional push intent (when policy.config.assistantPushEnabled=true):
 *   class=conversational, priority=immediate, allowedChannels=["web_notification_center"],
 *   same traceId.
 *
 * ADR-088 §Slice 3 — Transactional migration.
 */

const BILLING_RULE_CODES = [
  "trial_ending",
  "trial_expired",
  "renewal_failed",
  "grace_ending",
  "grace_expired",
  "payment_recovered"
] as const;

type BillingRuleCode = (typeof BILLING_RULE_CODES)[number];

type RuleConfig = {
  enabled: boolean;
  offsetDays: number | null;
};

type PolicyConfig = {
  assistantPushEnabled: boolean;
  rules: Record<BillingRuleCode, RuleConfig>;
};

const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  assistantPushEnabled: false,
  rules: {
    trial_ending: { enabled: true, offsetDays: 3 },
    trial_expired: { enabled: true, offsetDays: null },
    renewal_failed: { enabled: true, offsetDays: null },
    grace_ending: { enabled: true, offsetDays: 1 },
    grace_expired: { enabled: true, offsetDays: null },
    payment_recovered: { enabled: true, offsetDays: null }
  }
};

type LifecycleEventRow = {
  id: string;
  workspaceId: string;
  userId: string | null;
  subscriptionId: string | null;
  eventCode: string;
  nextStatus: string | null;
  nextPlanCode: string | null;
  nextPeriodEndsAt: Date | null;
  createdAt: Date;
  user: { email: string } | null;
  subscription: { graceEndsAt: Date | null; trialEndsAt: Date | null } | null;
};

type ApplicableRule = {
  rule: BillingRuleCode;
  scheduledAt: Date;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  periodEndsAt: Date | null;
};

@Injectable()
export class BillingLifecycleProducerService {
  private readonly logger = new Logger(BillingLifecycleProducerService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly notificationIntentService: NotificationIntentService
  ) {}

  async emitForLifecycleEventIds(eventIds: string[]): Promise<void> {
    for (const eventId of eventIds) {
      await this.emitForLifecycleEventId(eventId);
    }
  }

  async emitForLifecycleEventId(eventId: string): Promise<void> {
    const event = await this.prisma.workspaceSubscriptionLifecycleEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        subscriptionId: true,
        eventCode: true,
        nextStatus: true,
        nextPlanCode: true,
        nextPeriodEndsAt: true,
        createdAt: true,
        user: { select: { email: true } },
        subscription: { select: { graceEndsAt: true, trialEndsAt: true } }
      }
    });
    if (event === null) {
      return;
    }

    const policy = await this.resolvePolicy(event.workspaceId);
    if (!policy.policyEnabled) {
      this.logger.log({
        event: "billing_lifecycle_producer.policy_disabled",
        workspaceId: event.workspaceId,
        lifecycleEventId: eventId
      });
      return;
    }

    const applicableRules = this.resolveApplicableRules(event, policy.config);
    if (applicableRules.length === 0) {
      return;
    }

    const planDisplayName = await this.resolvePlanDisplayName(event.nextPlanCode);
    const assistant = await this.resolveAssistant(event.workspaceId, event.userId);

    for (const ruleInfo of applicableRules) {
      const facts: BillingLifecycleFactPayload = {
        rule: ruleInfo.rule,
        workspaceId: event.workspaceId,
        planCode: event.nextPlanCode,
        planDisplayName,
        periodEndsAt: ruleInfo.periodEndsAt?.toISOString() ?? null,
        graceEndsAt: ruleInfo.graceEndsAt?.toISOString() ?? null,
        trialEndsAt: ruleInfo.trialEndsAt?.toISOString() ?? null,
        amount: null,
        currency: null,
        locale: "ru",
        recipientEmail: event.user?.email ?? null
      };

      const dedupeKey = `${ruleInfo.rule}:${event.workspaceId}:${eventId}`;

      // Primary email intent
      try {
        await this.notificationIntentService.createIntent({
          workspaceId: event.workspaceId,
          assistantId: assistant?.id ?? null,
          userId: event.userId,
          source: "billing_lifecycle",
          class: "transactional",
          priority: "scheduled",
          renderStrategy: "template",
          templateId: `billing.${ruleInfo.rule}`,
          factPayload: facts as unknown as Record<string, unknown>,
          allowedChannels: ["email"],
          escalationAfterMinutes: null,
          escalationChannel: null,
          dedupeKey,
          scheduledAt: ruleInfo.scheduledAt,
          respectQuietHours: false,
          traceId: eventId
        });
        this.logger.log({
          event: "billing_lifecycle_producer.intent_created",
          rule: ruleInfo.rule,
          workspaceId: event.workspaceId,
          lifecycleEventId: eventId,
          dedupeKey
        });
      } catch (err) {
        this.logger.error({
          event: "billing_lifecycle_producer.intent_create_failed",
          rule: ruleInfo.rule,
          workspaceId: event.workspaceId,
          lifecycleEventId: eventId,
          error: err instanceof Error ? err.message : String(err)
        });
      }

      // Optional assistant push (conversational, web_notification_center)
      if (policy.config.assistantPushEnabled && assistant !== null) {
        try {
          await this.notificationIntentService.createIntent({
            workspaceId: event.workspaceId,
            assistantId: assistant.id,
            userId: event.userId,
            source: "billing_lifecycle",
            class: "conversational",
            priority: "immediate",
            renderStrategy: "template",
            templateId: `billing.${ruleInfo.rule}.short`,
            factPayload: facts as unknown as Record<string, unknown>,
            allowedChannels: ["web_notification_center"],
            dedupeKey: `${dedupeKey}:push`,
            scheduledAt: ruleInfo.scheduledAt,
            respectQuietHours: false,
            traceId: eventId
          });
        } catch (err) {
          this.logger.warn({
            event: "billing_lifecycle_producer.push_intent_failed",
            rule: ruleInfo.rule,
            workspaceId: event.workspaceId,
            lifecycleEventId: eventId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }
  }

  private async resolvePolicy(
    _workspaceId: string
  ): Promise<{ policyEnabled: boolean; config: PolicyConfig }> {
    const row = await this.prisma.notificationPolicy.findUnique({
      where: { source: "billing_lifecycle" },
      select: { enabled: true, config: true }
    });
    if (row === null) {
      return { policyEnabled: true, config: DEFAULT_POLICY_CONFIG };
    }
    return { policyEnabled: row.enabled, config: parsePolicyConfig(row.config) };
  }

  private resolveApplicableRules(event: LifecycleEventRow, config: PolicyConfig): ApplicableRule[] {
    const now = new Date();
    const trialEndsAt = event.subscription?.trialEndsAt ?? event.nextPeriodEndsAt ?? null;
    const graceEndsAt = event.subscription?.graceEndsAt ?? null;
    const periodEndsAt = event.nextPeriodEndsAt ?? null;

    const candidate = (rule: BillingRuleCode, relevantDate: Date | null): ApplicableRule | null => {
      const ruleConfig = config.rules[rule];
      if (!ruleConfig || !ruleConfig.enabled) return null;
      const offsetDays = ruleConfig.offsetDays;
      const scheduledAt =
        relevantDate !== null && offsetDays !== null
          ? new Date(relevantDate.getTime() - offsetDays * 86_400_000)
          : now;
      return { rule, scheduledAt, trialEndsAt, graceEndsAt, periodEndsAt };
    };

    const candidates: Array<ApplicableRule | null> = [];

    switch (event.eventCode) {
      case "trial_started":
      case "trial_extended":
        candidates.push(candidate("trial_ending", trialEndsAt));
        break;
      case "trial_expired":
        candidates.push(candidate("trial_expired", null));
        break;
      case "renewal_failed":
        candidates.push(candidate("renewal_failed", null));
        break;
      case "grace_started":
      case "grace_extended":
        candidates.push(candidate("grace_ending", graceEndsAt));
        break;
      case "grace_expired":
        candidates.push(candidate("grace_expired", null));
        break;
      case "payment_recovered":
        candidates.push(candidate("payment_recovered", null));
        break;
    }

    return candidates.filter((c): c is ApplicableRule => c !== null);
  }

  private async resolveAssistant(
    workspaceId: string,
    userId: string | null
  ): Promise<{ id: string } | null> {
    return this.prisma.assistant.findFirst({
      where: { workspaceId, ...(userId !== null ? { userId } : {}) },
      select: { id: true }
    });
  }

  private async resolvePlanDisplayName(planCode: string | null): Promise<string> {
    if (planCode === null) return "current plan";
    const plan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: planCode },
      select: { displayName: true }
    });
    return plan?.displayName ?? planCode;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseRuleConfig(v: unknown): RuleConfig {
  if (!isRecord(v)) return { enabled: true, offsetDays: null };
  return {
    enabled: v["enabled"] !== false,
    offsetDays:
      typeof v["offsetDays"] === "number" &&
      Number.isInteger(v["offsetDays"]) &&
      v["offsetDays"] >= 0
        ? v["offsetDays"]
        : null
  };
}

function parsePolicyConfig(raw: unknown): PolicyConfig {
  if (!isRecord(raw)) return DEFAULT_POLICY_CONFIG;
  const assistantPushEnabled = raw["assistantPushEnabled"] === true;
  const rawRules = isRecord(raw["rules"]) ? raw["rules"] : {};
  const rules = {} as Record<BillingRuleCode, RuleConfig>;
  for (const code of BILLING_RULE_CODES) {
    rules[code] = parseRuleConfig(rawRules[code] ?? DEFAULT_POLICY_CONFIG.rules[code]);
  }
  return { assistantPushEnabled, rules };
}
