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

export type OverviewStoragePressure = {
  tokenBudgetUsedPercent: number;
  mediaStorageUsedPercent: number;
  tokenBudgetUsed: number;
  tokenBudgetLimit: number | null;
  mediaStorageBytesUsed: number;
  mediaStorageBytesLimit: number | null;
};

export type OverviewQueuePressure = {
  inFlight: number;
  peakInFlight: number;
  requestsPerSecond: number;
};

export type AdminOverviewDashboardState = {
  latency: OverviewLatencySnapshot;
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
  storagePressure: OverviewStoragePressure | null;
  warnings: OverviewSystemWarning[];
  updatedAt: string;
};
