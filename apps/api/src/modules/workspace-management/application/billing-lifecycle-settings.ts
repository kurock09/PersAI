export const BILLING_LIFECYCLE_SETTINGS_ID = "global";
export const BILLING_LIFECYCLE_SETTINGS_SCHEMA = "persai.billingLifecycleSettings.v2";

export type BillingLifecycleNotificationCode =
  | "trial_ending"
  | "trial_expired"
  | "renewal_failed"
  | "grace_ending"
  | "grace_expired"
  | "payment_recovered";

export type BillingLifecycleNotificationRule = {
  notificationCode: BillingLifecycleNotificationCode;
  enabled: boolean;
  offsetDays: number | null;
};

export type BillingLifecycleNotificationPolicy = {
  emailEnabled: true;
  assistantPushEnabled: boolean;
  rules: BillingLifecycleNotificationRule[];
};

export type BillingLifecycleSettingsState = {
  schema: typeof BILLING_LIFECYCLE_SETTINGS_SCHEMA;
  gracePeriodDays: number;
  globalFallbackPlanCode: string | null;
  notificationPolicy: BillingLifecycleNotificationPolicy;
  updatedAt: string;
};

export type BillingLifecycleSettingsInput = {
  gracePeriodDays: number;
  globalFallbackPlanCode: string | null;
  notificationPolicy: BillingLifecycleNotificationPolicy;
};

export const DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_RULES: BillingLifecycleNotificationRule[] = [
  { notificationCode: "trial_ending", enabled: true, offsetDays: 3 },
  { notificationCode: "trial_expired", enabled: true, offsetDays: null },
  { notificationCode: "renewal_failed", enabled: true, offsetDays: null },
  { notificationCode: "grace_ending", enabled: true, offsetDays: 1 },
  { notificationCode: "grace_expired", enabled: true, offsetDays: null },
  { notificationCode: "payment_recovered", enabled: true, offsetDays: null }
];

export const DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_POLICY: BillingLifecycleNotificationPolicy = {
  emailEnabled: true,
  assistantPushEnabled: false,
  rules: DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_RULES
};

const NOTIFICATION_CODES = new Set<BillingLifecycleNotificationCode>(
  DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_RULES.map((rule) => rule.notificationCode)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRule(value: unknown): BillingLifecycleNotificationRule | null {
  if (!isRecord(value)) {
    return null;
  }
  const notificationCode = value.notificationCode;
  if (typeof notificationCode !== "string" || !NOTIFICATION_CODES.has(notificationCode as never)) {
    return null;
  }
  const offsetDays = value.offsetDays;
  return {
    notificationCode: notificationCode as BillingLifecycleNotificationCode,
    enabled: value.enabled === true,
    offsetDays:
      typeof offsetDays === "number" && Number.isInteger(offsetDays) && offsetDays >= 0
        ? offsetDays
        : null
  };
}

export function resolveBillingLifecycleNotificationPolicy(
  metadata: unknown
): BillingLifecycleNotificationPolicy {
  const metadataRecord = isRecord(metadata) ? metadata : {};
  const policy = isRecord(metadataRecord.notificationPolicy)
    ? metadataRecord.notificationPolicy
    : {};
  const incomingRules = Array.isArray(policy.rules) ? policy.rules : [];
  const normalizedRules = new Map<
    BillingLifecycleNotificationCode,
    BillingLifecycleNotificationRule
  >();
  for (const rule of DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_RULES) {
    normalizedRules.set(rule.notificationCode, { ...rule });
  }
  for (const rawRule of incomingRules) {
    const rule = normalizeRule(rawRule);
    if (rule !== null) {
      normalizedRules.set(rule.notificationCode, rule);
    }
  }
  return {
    emailEnabled: true,
    assistantPushEnabled: policy.assistantPushEnabled === true,
    rules: DEFAULT_BILLING_LIFECYCLE_NOTIFICATION_RULES.map((rule) => ({
      ...normalizedRules.get(rule.notificationCode)!
    }))
  };
}

export function buildBillingLifecycleSettingsMetadata(
  notificationPolicy: BillingLifecycleNotificationPolicy,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...extra,
    schema: BILLING_LIFECYCLE_SETTINGS_SCHEMA,
    notificationPolicy: {
      emailEnabled: true,
      assistantPushEnabled: notificationPolicy.assistantPushEnabled,
      rules: notificationPolicy.rules
    }
  };
}
