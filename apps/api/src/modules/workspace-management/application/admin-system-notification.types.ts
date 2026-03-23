export type AdminNotificationChannelState = {
  channelType: "webhook";
  status: "active" | "inactive";
  endpointUrl: string | null;
  hasSigningSecret: boolean;
  updatedAt: string;
  lastDelivery: {
    deliveryStatus: "succeeded" | "failed" | "skipped";
    attemptedAt: string;
    errorMessage: string | null;
  } | null;
};

export type AdminSystemNotificationSignalCode =
  | "assistant.runtime.apply_failed"
  | "assistant.runtime.apply_degraded"
  | "assistant.runtime.apply_succeeded"
  | "admin.plan_created"
  | "admin.plan_updated";

export type AdminSystemNotificationSeverity = "info" | "elevated" | "high";

export type AdminSystemNotificationEnvelope = {
  schema: "persai.adminSystemNotification.v1";
  workspaceId: string;
  signal: {
    code: AdminSystemNotificationSignalCode;
    severity: AdminSystemNotificationSeverity;
    summary: string;
    occurredAt: string;
  };
  actor: {
    userId: string | null;
  };
  assistant: {
    assistantId: string | null;
  };
  details: Record<string, unknown>;
};
