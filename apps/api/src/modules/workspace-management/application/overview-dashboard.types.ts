export type LatencyPercentiles = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type OverviewChannelLatency = {
  avgMs: number;
  maxMs: number;
  count: number;
  percentiles: LatencyPercentiles;
};

export type OverviewLatencyBucket = {
  le: number;
  value: number;
};

export type OverviewLatencyRollup = {
  count: number;
  durationMsTotal: number;
  maxMs: number;
  buckets: OverviewLatencyBucket[];
};

export type OverviewLatencySnapshot = {
  webChatTurns: OverviewChannelLatency | null;
  telegramTurns: OverviewChannelLatency | null;
  allRoutes: OverviewChannelLatency;
};

export type OverviewSystemWarning = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type OverviewNativeRuntimeState = {
  live: boolean;
  ready: boolean;
  checkedAt: string;
  runtime: OverviewExecutionWorkloadState;
  providerGateway: OverviewExecutionWorkloadState;
};

export type OverviewExecutionWorkloadKey = "runtime" | "provider_gateway";

export type OverviewExecutionWorkloadDiscoveryMode =
  | "headless_dns"
  | "service_base_url"
  | "unconfigured";

export type OverviewExecutionWorkloadPodState = {
  podIp: string;
  address: string;
  live: boolean;
  ready: boolean;
  checkedAt: string;
};

export type OverviewExecutionWorkloadState = {
  key: OverviewExecutionWorkloadKey;
  label: string;
  baseUrlConfigured: boolean;
  endpointHost: string | null;
  desiredReplicas: number | null;
  autoscalingEnabled: boolean;
  autoscalingMinReplicas: number | null;
  autoscalingMaxReplicas: number | null;
  discoveryMode: OverviewExecutionWorkloadDiscoveryMode;
  discoveryTarget: string | null;
  opaque: boolean;
  live: boolean;
  ready: boolean;
  observedPodCount: number;
  discoveredReadyPodCount: number;
  checkedAt: string;
  notes: string[];
  pods: OverviewExecutionWorkloadPodState[];
};

export type OverviewQueuePressure = {
  inFlight: number;
  peakInFlight: number;
  requestsPerSecond: number;
};

export type OverviewLatencyTraceSurface = "telegram" | "web_chat_sync" | "web_chat_stream";

export type OverviewLatencyTraceStage = {
  key: string;
  durationMs: number;
};

export type OverviewLatencyTraceEntry = {
  traceId: string;
  surface: OverviewLatencyTraceSurface;
  status: "completed" | "failed" | "interrupted" | "replayed" | "deduplicated";
  assistantId: string | null;
  threadKey: string | null;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  outputPreview: string | null;
  stages: OverviewLatencyTraceStage[];
};

export type OverviewLatencyTraceState = {
  enabled: boolean;
  sampleLimit: number;
  updatedAt: string | null;
  recent: OverviewLatencyTraceEntry[];
};

export type WebRuntimeShadowComparisonRoute = "sync" | "stream";

export type WebRuntimeShadowExecutionSummary = {
  status: "completed" | "failed";
  runtimeMs: number;
  firstDeltaMs: number | null;
  deltaCount: number | null;
  code: string | null;
  preview: string | null;
};

export type WebRuntimeShadowComparisonEntry = {
  comparisonId: string;
  route: WebRuntimeShadowComparisonRoute;
  verdict: "match" | "mismatch";
  assistantId: string;
  threadKey: string;
  clientTurnId: string | null;
  comparedAt: string;
  contentMatch: boolean;
  errorClassMatch: boolean;
  terminalMatch: boolean;
  primary: WebRuntimeShadowExecutionSummary;
  shadow: WebRuntimeShadowExecutionSummary;
};

export type WebRuntimeShadowComparisonState = {
  sampleLimit: number;
  updatedAt: string | null;
  recent: WebRuntimeShadowComparisonEntry[];
};

export type AdminOverviewDataSource = {
  scope: "api_instance_local";
  instanceId: string;
  podIp: string | null;
};

export type AdminOverviewDashboardState = {
  dataSource: AdminOverviewDataSource;
  latency: OverviewLatencySnapshot;
  aggregation: {
    latency: {
      webChatTurns: OverviewLatencyRollup | null;
      telegramTurns: OverviewLatencyRollup | null;
      allRoutes: OverviewLatencyRollup;
    };
  };
  latencyTrace: OverviewLatencyTraceState;
  webRuntimeShadowComparisons: WebRuntimeShadowComparisonState;
  activeUsers: number;
  activeWebChats: number;
  runtime: OverviewNativeRuntimeState;
  health: {
    uptimeSeconds: number;
    processStartedAt: string;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
    cpuUserMs: number;
    cpuSystemMs: number;
  };
  queuePressure: OverviewQueuePressure;
  warnings: OverviewSystemWarning[];
  updatedAt: string;
};
