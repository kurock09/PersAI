import type { RuntimeSandboxJobStatus, RuntimeSandboxPolicy } from "@persai/runtime-contract";

export type OpsIncidentSeverity = "info" | "elevated" | "high";

export type AdminOpsCockpitQuotaUsage = {
  tokenBudgetUsed: number;
  tokenBudgetLimit: number | null;
  tokenBudgetPeriodStartedAt: string | null;
  tokenBudgetPeriodEndsAt: string | null;
  tokenBudgetPeriodSource: "subscription_period" | "calendar_month_fallback" | null;
  mediaStorageBytesUsed: number;
  mediaStorageBytesLimit: number | null;
  activeWebChats: number;
  activeWebChatsLimit: number | null;
};

export type AdminOpsCockpitBillingLifecycleEvent = {
  id: string;
  eventCode: string;
  source: string;
  previousStatus: string | null;
  nextStatus: string | null;
  previousPlanCode: string | null;
  nextPlanCode: string | null;
  nextPeriodStartedAt: string | null;
  nextPeriodEndsAt: string | null;
  createdAt: string;
};

export type AdminOpsCockpitBillingNotificationJob = {
  id: string;
  notificationCode: string;
  channel: "email" | "assistant_notification";
  status: "pending" | "enqueued" | "skipped" | "failed";
  scheduledFor: string;
  recipientEmail: string | null;
  lastErrorCode: string | null;
  createdAt: string;
};

export type AdminOpsCockpitPaidActivation = {
  eventCode: string;
  source: string;
  adminAction: string | null;
  planCode: string | null;
  periodStartedAt: string | null;
  periodEndsAt: string | null;
  createdAt: string;
} | null;

export type AdminOpsCockpitBillingSupport = {
  subscription: {
    id: string | null;
    planCode: string | null;
    status: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    graceStartedAt: string | null;
    graceEndsAt: string | null;
    currentPeriodStartedAt: string | null;
    currentPeriodEndsAt: string | null;
    cancelAtPeriodEnd: boolean | null;
    providerCustomerRef: string | null;
    providerSubscriptionRef: string | null;
  };
  quotaPeriod: {
    startedAt: string | null;
    endsAt: string | null;
    source: "subscription_period" | "calendar_month_fallback" | null;
  };
  latestPaidActivation: AdminOpsCockpitPaidActivation;
  latestLifecycleEvents: AdminOpsCockpitBillingLifecycleEvent[];
  latestNotificationJobs: AdminOpsCockpitBillingNotificationJob[];
};

export type AdminOpsCockpitChannelBinding = {
  provider: string;
  surface: string;
  state: string;
};

export type AdminOpsCockpitChatStats = {
  totalChats: number;
  activeWebChats: number;
  archivedWebChats: number;
};

export type AdminOpsCockpitSandboxUsage = {
  activeJobs: number;
  jobsStartedToday: number;
  completedToday: number;
  blockedToday: number;
  failedToday: number;
  dailyLimit: number | null;
  remainingJobsToday: number | null;
};

export type AdminOpsCockpitSandboxJobResourceUsage = {
  workspaceBytes: number | null;
  fileCount: number | null;
  directoryCount: number | null;
  stdoutBytes: number | null;
  stderrBytes: number | null;
  peakProcessCount: number | null;
  peakCpuMs: number | null;
  peakMemoryBytes: number | null;
  processDurationMs: number | null;
};

export type AdminOpsCockpitSandboxJob = {
  id: string;
  toolCode: string;
  status: RuntimeSandboxJobStatus;
  relativeWorkspace: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  violationCode: string | null;
  violationMessage: string | null;
  resultReason: string | null;
  resultWarning: string | null;
  persistedFileCount: number;
  resourceUsage: AdminOpsCockpitSandboxJobResourceUsage | null;
};

export type AdminOpsCockpitSandbox = {
  effectivePolicy: RuntimeSandboxPolicy;
  usage: AdminOpsCockpitSandboxUsage;
  recentJobs: AdminOpsCockpitSandboxJob[];
};

export type AdminOpsCockpitState = {
  quotaUsage: AdminOpsCockpitQuotaUsage | null;
  billingSupport: AdminOpsCockpitBillingSupport | null;
  chatStats: AdminOpsCockpitChatStats | null;
  channels: AdminOpsCockpitChannelBinding[];
  sandbox: AdminOpsCockpitSandbox | null;
  assistant: {
    exists: boolean;
    assistantId: string | null;
    workspaceId: string | null;
    effectivePlan: {
      code: string | null;
      source:
        | "workspace_subscription"
        | "subscription_trial_fallback"
        | "subscription_paid_fallback"
        | "assistant_plan_override"
        | "assistant_plan_fallback"
        | "catalog_default_fallback"
        | "none";
      assistantPlanOverrideCode: string | null;
      quotaPlanCode: string | null;
    };
    latestPublishedVersion: {
      id: string | null;
      version: number | null;
      publishedAt: string | null;
    };
    runtimeApply: {
      status: "not_requested" | "pending" | "in_progress" | "succeeded" | "failed" | "degraded";
      targetPublishedVersionId: string | null;
      appliedPublishedVersionId: string | null;
      requestedAt: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      error: {
        code: string | null;
        message: string | null;
      } | null;
    } | null;
  };
  runtime: {
    adapterEnabled: boolean;
    runtimeTier: string | null;
    runtimeEndpointHost: string | null;
    preflight: {
      live: boolean;
      ready: boolean;
      checkedAt: string;
    };
  };
  controls: {
    reapplySupported: boolean;
    restartSupported: boolean;
    assistantPlanOverrideSupported: boolean;
    assistantPlanResetSupported: boolean;
  };
  incidentSignals: Array<{
    code: string;
    severity: OpsIncidentSeverity;
    message: string;
  }>;
  updatedAt: string;
};
