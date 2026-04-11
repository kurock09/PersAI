import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { PlatformHttpMetricsService } from "../../platform-core/application/platform-http-metrics.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { resolveAdminOverviewDataSource } from "./admin-overview-data-source";
import { AssistantRuntimePreflightService } from "./assistant-runtime-preflight.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { RUNTIME_TIER_VALUES, type RuntimeTier } from "./runtime-assignment";
import { OverviewLatencyTraceService } from "./overview-latency-trace.service";
import { WebRuntimeShadowComparisonService } from "./web-runtime-shadow-comparison.service";
import type {
  AdminOverviewDashboardState,
  LatencyPercentiles,
  OverviewChannelLatency,
  OverviewLatencySnapshot,
  OverviewQueuePressure,
  OverviewSystemWarning,
  RuntimeTierPreflight
} from "./overview-dashboard.types";

const ACTIVE_USERS_WINDOW_MINUTES = 15;
const HIGH_MEMORY_THRESHOLD_BYTES = 512 * 1024 * 1024;
const HIGH_LATENCY_THRESHOLD_MS = 3000;
const HIGH_ERROR_RATE_THRESHOLD = 0.05;

type Bucket = { le: number; value: number };

function estimatePercentileFromBuckets(
  buckets: Bucket[],
  total: number,
  maxMs: number
): LatencyPercentiles {
  if (total === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  const sorted = [...buckets].sort((a, b) => a.le - b.le);
  function pctl(target: number): number {
    const threshold = Math.ceil(target * total);
    for (const b of sorted) {
      if (b.value >= threshold) return b.le;
    }
    return Math.round(maxMs);
  }
  return { p50Ms: pctl(0.5), p95Ms: pctl(0.95), p99Ms: pctl(0.99) };
}

function mergeBuckets(target: Bucket[], source: Bucket[]): void {
  for (let i = 0; i < target.length && i < source.length; i++) {
    target[i]!.value += source[i]!.value;
  }
}

type TierFlapState = { wasHealthy: boolean; flapCount: number; lastFlapAt: string | null };

@Injectable()
export class ResolveAdminOverviewDashboardService {
  private readonly tierFlapState = new Map<string, TierFlapState>();

  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService,
    private readonly assistantRuntimePreflightService: AssistantRuntimePreflightService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly overviewLatencyTraceService: OverviewLatencyTraceService,
    private readonly webRuntimeShadowComparisonService: WebRuntimeShadowComparisonService
  ) {}

  async execute(callerUserId: string): Promise<AdminOverviewDashboardState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const config = loadApiConfig(process.env);
    const httpSnapshot = this.platformHttpMetricsService.getSnapshot();

    const [tiers, activeUsersResult, activeWebChats] = await Promise.all([
      this.resolveAllTierPreflights(),
      this.prisma.assistantChat.groupBy({
        by: ["userId"],
        where: { updatedAt: { gte: new Date(Date.now() - ACTIVE_USERS_WINDOW_MINUTES * 60_000) } }
      }),
      this.prisma.assistantChat.count({ where: { surface: "web", archivedAt: null } })
    ]);

    const latency = this.computeLatency(httpSnapshot);
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptimeSeconds = Math.round(process.uptime());
    const totalRequests = httpSnapshot.requestsTotal;
    const totalErrors = httpSnapshot.errorRequestsTotal;
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

    const health = {
      uptimeSeconds,
      processStartedAt: httpSnapshot.processStartedAt,
      rssBytes: memoryUsage.rss,
      heapUsedBytes: memoryUsage.heapUsed,
      heapTotalBytes: memoryUsage.heapTotal,
      externalBytes: memoryUsage.external,
      arrayBuffersBytes: memoryUsage.arrayBuffers,
      totalRequests,
      totalErrors,
      errorRate: Math.round(errorRate * 10000) / 10000,
      cpuUserMs: Math.round(cpuUsage.user / 1000),
      cpuSystemMs: Math.round(cpuUsage.system / 1000)
    };

    const queuePressure: OverviewQueuePressure = {
      inFlight: httpSnapshot.inFlightRequests,
      peakInFlight: httpSnapshot.peakInFlightRequests,
      requestsPerSecond:
        uptimeSeconds > 0 ? Math.round((totalRequests / uptimeSeconds) * 100) / 100 : 0
    };

    const anyUnhealthy = tiers.some((t) => !t.live || !t.ready);
    const warnings = this.deriveWarnings(latency, health, anyUnhealthy ? tiers : [], queuePressure);

    return {
      dataSource: resolveAdminOverviewDataSource(),
      latency,
      latencyTrace: this.overviewLatencyTraceService.getState(),
      webRuntimeShadowComparisons: this.webRuntimeShadowComparisonService.getState(),
      activeUsers: activeUsersResult.length,
      activeWebChats,
      runtime: { adapterEnabled: config.OPENCLAW_ADAPTER_ENABLED, tiers },
      health,
      queuePressure,
      warnings,
      updatedAt: new Date().toISOString()
    };
  }

  private async resolveAllTierPreflights(): Promise<RuntimeTierPreflight[]> {
    return Promise.all(
      RUNTIME_TIER_VALUES.map(async (tier: RuntimeTier) => {
        const result = await this.assistantRuntimePreflightService.execute(tier);
        const healthy = result.live && result.ready;
        const prev = this.tierFlapState.get(tier);

        let flapCount = prev?.flapCount ?? 0;
        let lastFlapAt = prev?.lastFlapAt ?? null;

        if (prev !== undefined && prev.wasHealthy !== healthy) {
          flapCount += 1;
          lastFlapAt = new Date().toISOString();
        }

        this.tierFlapState.set(tier, { wasHealthy: healthy, flapCount, lastFlapAt });

        return {
          tier,
          live: result.live,
          ready: result.ready,
          checkedAt: result.checkedAt,
          flapCount,
          lastFlapAt
        };
      })
    );
  }

  private computeLatency(
    snapshot: ReturnType<PlatformHttpMetricsService["getSnapshot"]>
  ): OverviewLatencySnapshot {
    const makeBuckets = (): Bucket[] =>
      [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000].map((le) => ({
        le,
        value: 0
      }));

    let allCount = 0,
      allDurationMs = 0,
      allMaxMs = 0;
    const allBuckets = makeBuckets();
    let webCount = 0,
      webDurationMs = 0,
      webMaxMs = 0;
    const webBuckets = makeBuckets();
    let tgCount = 0,
      tgDurationMs = 0,
      tgMaxMs = 0;
    const tgBuckets = makeBuckets();

    for (const series of snapshot.series) {
      allCount += series.count;
      allDurationMs += series.durationMsTotal;
      allMaxMs = Math.max(allMaxMs, series.maxDurationMs);
      mergeBuckets(allBuckets, series.buckets);

      const route = series.key.route.toLowerCase();
      if (
        route.includes("chat/web/stream") ||
        route.includes("chat/web") ||
        route.includes("turns/web-chat") ||
        route.includes("turns/send")
      ) {
        webCount += series.count;
        webDurationMs += series.durationMsTotal;
        webMaxMs = Math.max(webMaxMs, series.maxDurationMs);
        mergeBuckets(webBuckets, series.buckets);
      } else if (
        route.includes("telegram-webhook") ||
        route.includes("turns/telegram") ||
        route.includes("telegram/turn")
      ) {
        tgCount += series.count;
        tgDurationMs += series.durationMsTotal;
        tgMaxMs = Math.max(tgMaxMs, series.maxDurationMs);
        mergeBuckets(tgBuckets, series.buckets);
      }
    }

    const build = (
      count: number,
      dur: number,
      max: number,
      buckets: Bucket[]
    ): OverviewChannelLatency | null =>
      count > 0
        ? {
            avgMs: Math.round(dur / count),
            maxMs: Math.round(max),
            count,
            percentiles: estimatePercentileFromBuckets(buckets, count, max)
          }
        : null;

    return {
      webChatTurns: build(webCount, webDurationMs, webMaxMs, webBuckets),
      telegramTurns: build(tgCount, tgDurationMs, tgMaxMs, tgBuckets),
      allRoutes: build(allCount, allDurationMs, allMaxMs, allBuckets) ?? {
        avgMs: 0,
        maxMs: 0,
        count: 0,
        percentiles: { p50Ms: 0, p95Ms: 0, p99Ms: 0 }
      }
    };
  }

  private deriveWarnings(
    latency: OverviewLatencySnapshot,
    health: AdminOverviewDashboardState["health"],
    unhealthyTiers: RuntimeTierPreflight[],
    queuePressure: OverviewQueuePressure
  ): OverviewSystemWarning[] {
    const warnings: OverviewSystemWarning[] = [];

    for (const t of unhealthyTiers) {
      if (!t.live || !t.ready) {
        warnings.push({
          code: "runtime_unhealthy",
          severity: "critical",
          message: `${t.tier}: preflight failed (live=${t.live}, ready=${t.ready})`
        });
      }
    }

    const flappingTiers = [...this.tierFlapState.entries()].filter(([, s]) => s.flapCount >= 3);
    for (const [tier, s] of flappingTiers) {
      warnings.push({
        code: "runtime_flapping",
        severity: "warning",
        message: `${tier}: ${s.flapCount} readiness flaps since process start`
      });
    }

    if (health.rssBytes > HIGH_MEMORY_THRESHOLD_BYTES) {
      const rssMb = Math.round(health.rssBytes / 1048576);
      warnings.push({
        code: "high_memory",
        severity: "warning",
        message: `RSS ${rssMb} MB > ${Math.round(HIGH_MEMORY_THRESHOLD_BYTES / 1048576)} MB threshold`
      });
    }

    if (health.errorRate > HIGH_ERROR_RATE_THRESHOLD && health.totalRequests > 10) {
      warnings.push({
        code: "high_error_rate",
        severity: "warning",
        message: `Error rate ${(health.errorRate * 100).toFixed(1)}% > ${HIGH_ERROR_RATE_THRESHOLD * 100}% threshold`
      });
    }

    const webP95 = latency.webChatTurns?.percentiles.p95Ms ?? 0;
    const tgP95 = latency.telegramTurns?.percentiles.p95Ms ?? 0;
    if (webP95 > HIGH_LATENCY_THRESHOLD_MS || tgP95 > HIGH_LATENCY_THRESHOLD_MS) {
      warnings.push({
        code: "high_p95_latency",
        severity: "warning",
        message: `p95 latency: web=${webP95}ms, TG=${tgP95}ms (threshold: ${HIGH_LATENCY_THRESHOLD_MS}ms)`
      });
    }

    if (queuePressure.peakInFlight >= 20) {
      warnings.push({
        code: "high_queue_pressure",
        severity: queuePressure.peakInFlight >= 50 ? "critical" : "warning",
        message: `Peak in-flight requests: ${queuePressure.peakInFlight}`
      });
    }

    return warnings;
  }
}
