import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { PlatformHttpMetricsService } from "../../platform-core/application/platform-http-metrics.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AssistantRuntimePreflightService } from "./assistant-runtime-preflight.service";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type {
  AdminOverviewDashboardState,
  OverviewLatencySnapshot,
  OverviewSystemWarning
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
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(callerUserId: string): Promise<AdminOverviewDashboardState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const config = loadApiConfig(process.env);

    const httpSnapshot = this.platformHttpMetricsService.getSnapshot();

    const assistant = await this.prisma.assistant.findFirst({
      where: { userId: callerUserId },
      select: { id: true }
    });
    const runtimeTier = assistant
      ? await this.resolveAssistantRuntimeTierService.resolveByAssistantId(assistant.id)
      : null;
    const preflight = await this.assistantRuntimePreflightService.execute(runtimeTier ?? undefined);

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

    const warnings = this.deriveWarnings(latency, health, preflight);

    return {
      latency,
      activeUsers: activeUsersResult.length,
      activeWebChats,
      runtime: {
        adapterEnabled: config.OPENCLAW_ADAPTER_ENABLED,
        runtimeTier,
        preflight
      },
      health,
      warnings,
      updatedAt: new Date().toISOString()
    };
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
      if (route.includes("turns/web-chat") || route.includes("turns/send")) {
        webCount += series.count;
        webDurationMs += series.durationMsTotal;
        webMaxMs = Math.max(webMaxMs, series.maxDurationMs);
      } else if (route.includes("turns/telegram") || route.includes("telegram")) {
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
    preflight: { live: boolean; ready: boolean }
  ): OverviewSystemWarning[] {
    const warnings: OverviewSystemWarning[] = [];

    if (!preflight.live || !preflight.ready) {
      warnings.push({
        code: "runtime_unhealthy",
        severity: "critical",
        message: `Runtime preflight failed: live=${preflight.live}, ready=${preflight.ready}`
      });
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
