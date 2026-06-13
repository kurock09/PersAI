import { NotificationClass } from "@prisma/client";

export const ADMIN_SYSTEM_EVENT_DEFINITIONS = [
  {
    code: "new_user_registered",
    label: "New user registered",
    description: "A newly onboarded user created their first assistant.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "trial_ending",
    label: "Trial ending",
    description: "A workspace trial is approaching its end.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "trial_expired",
    label: "Trial expired",
    description: "A workspace trial expired.",
    notificationClass: NotificationClass.operational
  },
  {
    code: "payment_activated",
    label: "Payment activated",
    description: "A paid activation completed successfully.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "renewal_succeeded",
    label: "Renewal succeeded",
    description: "A recurring renewal completed successfully.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "renewal_failed",
    label: "Renewal failed",
    description: "A renewal failed and may require attention.",
    notificationClass: NotificationClass.operational
  },
  {
    code: "payment_recovered",
    label: "Payment recovered",
    description: "A previously failing billing state recovered.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "grace_ending",
    label: "Grace ending",
    description: "A workspace is approaching grace-period end.",
    notificationClass: NotificationClass.operational
  },
  {
    code: "grace_expired",
    label: "Grace expired",
    description: "A grace period expired without successful recovery.",
    notificationClass: NotificationClass.operational
  },
  {
    code: "runtime_apply_succeeded",
    label: "Runtime apply succeeded",
    description: "Assistant publish/apply completed successfully.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "runtime_apply_degraded",
    label: "Runtime apply degraded",
    description: "Assistant publish/apply succeeded with degradation.",
    notificationClass: NotificationClass.operational
  },
  {
    code: "runtime_apply_failed",
    label: "Runtime apply failed",
    description: "Assistant publish/apply failed.",
    notificationClass: NotificationClass.operational
  },
  {
    code: "reserve_openai_transport_used",
    label: "Reserve OpenAI transport used",
    description:
      "An OpenAI image request succeeded through the reserve OpenAI-compatible transport after a primary availability failure.",
    notificationClass: NotificationClass.operational
  },
  {
    code: "admin_plan_created",
    label: "Admin plan created",
    description: "A new plan was created in Admin.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "admin_plan_updated",
    label: "Admin plan updated",
    description: "An existing plan was updated in Admin.",
    notificationClass: NotificationClass.administrative
  },
  {
    code: "support_ticket_opened",
    label: "Support ticket opened",
    description: "A user submitted a new support request.",
    notificationClass: NotificationClass.operational
  }
] as const;

export type AdminSystemEventCode = (typeof ADMIN_SYSTEM_EVENT_DEFINITIONS)[number]["code"];

export const VALID_ADMIN_SYSTEM_EVENT_CODES = new Set<AdminSystemEventCode>(
  ADMIN_SYSTEM_EVENT_DEFINITIONS.map((entry) => entry.code)
);

export const DEFAULT_ADMIN_SYSTEM_EVENT_CODES: AdminSystemEventCode[] = [
  "new_user_registered",
  "payment_activated",
  "renewal_failed",
  "payment_recovered",
  "grace_expired",
  "runtime_apply_failed",
  "runtime_apply_degraded",
  "support_ticket_opened"
];

export type AdminSystemPolicyConfig = {
  recipientAssistantIds: string[];
  eventCodes: AdminSystemEventCode[];
  dailyReportEnabled: boolean;
  dailyReportTimeLocal: string;
};

export const DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG: AdminSystemPolicyConfig = {
  recipientAssistantIds: [],
  eventCodes: DEFAULT_ADMIN_SYSTEM_EVENT_CODES,
  dailyReportEnabled: false,
  dailyReportTimeLocal: "21:00"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAssistantIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG.recipientAssistantIds;
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeEventCodes(value: unknown): AdminSystemEventCode[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG.eventCodes];
  }
  const normalized = value.filter(
    (entry): entry is AdminSystemEventCode =>
      typeof entry === "string" && VALID_ADMIN_SYSTEM_EVENT_CODES.has(entry as AdminSystemEventCode)
  );
  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : [...DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG.eventCodes];
}

export function isValidAdminSystemDailyReportTimeLocal(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    return false;
  }
  const [hourRaw, minuteRaw] = trimmed.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return !(
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  );
}

function normalizeDailyReportTimeLocal(value: unknown): string {
  if (!isValidAdminSystemDailyReportTimeLocal(value)) {
    return DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG.dailyReportTimeLocal;
  }
  return value.trim();
}

export function parseAdminSystemPolicyConfig(value: unknown): AdminSystemPolicyConfig {
  if (!isRecord(value)) {
    return { ...DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG };
  }

  return {
    recipientAssistantIds: normalizeAssistantIds(value["recipientAssistantIds"]),
    eventCodes: normalizeEventCodes(value["eventCodes"]),
    dailyReportEnabled:
      typeof value["dailyReportEnabled"] === "boolean"
        ? value["dailyReportEnabled"]
        : DEFAULT_ADMIN_SYSTEM_POLICY_CONFIG.dailyReportEnabled,
    dailyReportTimeLocal: normalizeDailyReportTimeLocal(value["dailyReportTimeLocal"])
  };
}

export function isAdminSystemEventCode(value: string): value is AdminSystemEventCode {
  return VALID_ADMIN_SYSTEM_EVENT_CODES.has(value as AdminSystemEventCode);
}

export function getAdminSystemEventDefinition(code: AdminSystemEventCode) {
  return ADMIN_SYSTEM_EVENT_DEFINITIONS.find((entry) => entry.code === code) ?? null;
}

/** Admin realtime events that describe a specific end-user workspace action. */
export const USER_SCOPED_ADMIN_SYSTEM_EVENT_CODES = new Set<AdminSystemEventCode>([
  "new_user_registered",
  "trial_ending",
  "trial_expired",
  "payment_activated",
  "renewal_succeeded",
  "renewal_failed",
  "payment_recovered",
  "grace_ending",
  "grace_expired",
  "support_ticket_opened"
]);

export function resolveAdminSystemUserLabel(details: Record<string, unknown>): string | null {
  for (const key of ["recipientEmail", "userEmail", "email"] as const) {
    const value = details[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  for (const key of ["sourceUserId", "userId"] as const) {
    const value = details[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export function enrichAdminSystemSummaryWithUser(
  eventCode: AdminSystemEventCode,
  summary: string,
  details: Record<string, unknown>
): string {
  if (!USER_SCOPED_ADMIN_SYSTEM_EVENT_CODES.has(eventCode)) {
    return summary;
  }

  const userLabel = resolveAdminSystemUserLabel(details);
  if (userLabel === null) {
    return summary;
  }

  const trimmed = summary.trim();
  if (trimmed.includes(userLabel) || /\buser:\s*/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed} - user: ${userLabel}`;
}
