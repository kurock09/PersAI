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

export type RuntimeTierPreflight = {
  tier: string;
  live: boolean;
  ready: boolean;
  checkedAt: string;
  flapCount: number;
  lastFlapAt: string | null;
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

export type AdminOverviewDataSource = {
  scope: "api_instance_local";
  instanceId: string;
  podIp: string | null;
};

export type AdminOverviewDashboardState = {
  dataSource: AdminOverviewDataSource;
  latency: OverviewLatencySnapshot;
  latencyTrace: OverviewLatencyTraceState;
  activeUsers: number;
  activeWebChats: number;
  runtime: {
    adapterEnabled: boolean;
    tiers: RuntimeTierPreflight[];
  };
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
