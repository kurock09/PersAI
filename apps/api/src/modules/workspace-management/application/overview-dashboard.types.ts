export type OverviewLatencySnapshot = {
  webChatTurns: { avgMs: number; maxMs: number; count: number } | null;
  telegramTurns: { avgMs: number; maxMs: number; count: number } | null;
  allRoutes: { avgMs: number; maxMs: number; count: number };
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
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    inFlightRequests: number;
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
  };
  warnings: OverviewSystemWarning[];
  updatedAt: string;
};
