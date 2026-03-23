export type OpsIncidentSeverity = "info" | "elevated" | "high";

export type AdminOpsCockpitState = {
  assistant: {
    exists: boolean;
    assistantId: string | null;
    workspaceId: string | null;
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
    openclawBaseUrlHost: string | null;
    preflight: {
      live: boolean;
      ready: boolean;
      checkedAt: string;
    };
  };
  controls: {
    reapplySupported: boolean;
    restartSupported: boolean;
  };
  incidentSignals: Array<{
    code: string;
    severity: OpsIncidentSeverity;
    message: string;
  }>;
  updatedAt: string;
};
