import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { PlatformHttpMetricsService } from "../../platform-core/application/platform-http-metrics.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AssistantRuntimePreflightService } from "./assistant-runtime-preflight.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { RUNTIME_TIER_VALUES, type RuntimeTier } from "./runtime-assignment";
import type {
  AdminOverviewDashboardState,
  OverviewLatencySnapshot,
  OverviewSystemWarning,
  RuntimeTierPreflight
} from "./overview-dashboard.types";

const ACTIVE_USERS_WINDOW_MINUTES = 15;
const HIGH_MEMORY_THRESHOLD_BYTES = 512 * 1024 * 1024;
const HIGH_LATENCY_THRESHOLD_MS = 3000;
const HIGH_ERROR_RATE_THRESHOLD = 0.05;

@Injectable()
export class ResolveAdminOverviewDashboardService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly platformHttpMetricsService: PlatformHttpMetricsService,
    private readonly assistantRuntimePreflightService: AssistantRuntimePreflightService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(callerUserId: string): Promise<AdminOverviewDashboardState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const config = loadApiConfig(process.env);

    const httpSnapshot = this.platformHttpMetricsService.getSnapshot();

    const tiers = await this.resolveAllTierPreflights();

    const activeUsersWindow = new Date(Date.now() - ACTIVE_USERS_WINDOW_MINUTES * 60 * 1000);
    const activeUsersResult = await this.prisma.assistantChat.groupBy({
      by: ["userId"],
      where: { updatedAt: { gte: activeUsersWindow } }
    });

    const activeWebChats = await this.prisma.assistantChat.count({
      where: { surface: "web", archivedAt: null }
    });

    const latency = this.computeLatency(httpSnapshot);
    const memoryUsage = process.memoryUsage();
    const totalRequests = httpSnapshot.requestsTotal;
    const totalErrors = httpSnapshot.errorRequestsTotal;
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

    const health = {
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memoryUsage.rss,
      heapUsedBytes: memoryUsage.heapUsed,
      heapTotalBytes: memoryUsage.heapTotal,
      inFlightRequests: httpSnapshot.inFlightRequests,
      totalRequests,
      totalErrors,
      errorRate: Math.round(errorRate * 10000) / 10000
    };

    const anyUnhealthy = tiers.some((t) => !t.live || !t.ready);
    const warnings = this.deriveWarnings(latency, health, anyUnhealthy ? tiers : []);

    return {
      latency,
      activeUsers: activeUsersResult.length,
      activeWebChats,
      runtime: {
        adapterEnabled: config.OPENCLAW_ADAPTER_ENABLED,
        tiers
      },
      health,
      warnings,
      updatedAt: new Date().toISOString()
    };
  }

  private async resolveAllTierPreflights(): Promise<RuntimeTierPreflight[]> {
    const results = await Promise.all(
      RUNTIME_TIER_VALUES.map(async (tier: RuntimeTier) => {
        const result = await this.assistantRuntimePreflightService.execute(tier);
        return { tier, ...result };
      })
    );
    return results;
  }

  private computeLatency(
    snapshot: ReturnType<PlatformHttpMetricsService["getSnapshot"]>
  ): OverviewLatencySnapshot {
    let allCount = 0;
    let allDurationMs = 0;
    let allMaxMs = 0;
    let webCount = 0;
    let webDurationMs = 0;
    let webMaxMs = 0;
    let tgCount = 0;
    let tgDurationMs = 0;
    let tgMaxMs = 0;

    for (const series of snapshot.series) {
      allCount += series.count;
      allDurationMs += series.durationMsTotal;
      allMaxMs = Math.max(allMaxMs, series.maxDurationMs);

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
      } else if (
        route.includes("telegram-webhook") ||
        route.includes("turns/telegram") ||
        route.includes("telegram/turn")
      ) {
        tgCount += series.count;
        tgDurationMs += series.durationMsTotal;
        tgMaxMs = Math.max(tgMaxMs, series.maxDurationMs);
      }
    }

    return {
      webChatTurns:
        webCount > 0
          ? {
              avgMs: Math.round(webDurationMs / webCount),
              maxMs: Math.round(webMaxMs),
              count: webCount
            }
          : null,
      telegramTurns:
        tgCount > 0
          ? {
              avgMs: Math.round(tgDurationMs / tgCount),
              maxMs: Math.round(tgMaxMs),
              count: tgCount
            }
          : null,
      allRoutes: {
        avgMs: allCount > 0 ? Math.round(allDurationMs / allCount) : 0,
        maxMs: Math.round(allMaxMs),
        count: allCount
      }
    };
  }

  private deriveWarnings(
    latency: OverviewLatencySnapshot,
    health: AdminOverviewDashboardState["health"],
    unhealthyTiers: RuntimeTierPreflight[]
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

    if (health.rssBytes > HIGH_MEMORY_THRESHOLD_BYTES) {
      const rssMb = Math.round(health.rssBytes / 1048576);
      warnings.push({
        code: "high_memory",
        severity: "warning",
        message: `RSS memory is ${rssMb} MB (threshold: ${Math.round(HIGH_MEMORY_THRESHOLD_BYTES / 1048576)} MB)`
      });
    }

    if (health.errorRate > HIGH_ERROR_RATE_THRESHOLD && health.totalRequests > 10) {
      warnings.push({
        code: "high_error_rate",
        severity: "warning",
        message: `Error rate is ${(health.errorRate * 100).toFixed(1)}% (threshold: ${HIGH_ERROR_RATE_THRESHOLD * 100}%)`
      });
    }

    const webAvg = latency.webChatTurns?.avgMs ?? 0;
    const tgAvg = latency.telegramTurns?.avgMs ?? 0;
    if (webAvg > HIGH_LATENCY_THRESHOLD_MS || tgAvg > HIGH_LATENCY_THRESHOLD_MS) {
      warnings.push({
        code: "high_latency",
        severity: "warning",
        message: `High average latency detected: web=${webAvg}ms, TG=${tgAvg}ms (threshold: ${HIGH_LATENCY_THRESHOLD_MS}ms)`
      });
    }

    return warnings;
  }
}
