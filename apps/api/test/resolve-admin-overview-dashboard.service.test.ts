import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { OverviewLatencyTraceService } from "../src/modules/workspace-management/application/overview-latency-trace.service";
import { ResolveAdminOverviewDashboardService } from "../src/modules/workspace-management/application/resolve-admin-overview-dashboard.service";
import { WebRuntimeShadowComparisonService } from "../src/modules/workspace-management/application/web-runtime-shadow-comparison.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { ResolveExecutionWorkloadOverviewService } from "../src/modules/workspace-management/application/resolve-execution-workload-overview.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const prevEnv = {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    PERSAI_INTERNAL_API_TOKEN: process.env.PERSAI_INTERNAL_API_TOKEN,
    PERSAI_RUNTIME_BASE_URL: process.env.PERSAI_RUNTIME_BASE_URL,
    PERSAI_PROVIDER_GATEWAY_BASE_URL: process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL,
    POD_NAME: process.env.POD_NAME
  };

  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/persai";
  process.env.CLERK_SECRET_KEY = "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal_token_123456";
  process.env.PERSAI_RUNTIME_BASE_URL = "http://runtime:3002";
  process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL = "http://provider-gateway:3003";
  process.env.POD_NAME = "api-test-1";

  try {
    const metrics = new PlatformHttpMetricsService();

    metrics.beginRequest();
    metrics.recordCompletedRequest({
      method: "POST",
      path: "/api/v1/chat/web",
      routePath: "/api/v1/chat/web",
      statusCode: 200,
      latencyMs: 100
    });
    metrics.endInFlightRequest();

    metrics.beginRequest();
    metrics.recordCompletedRequest({
      method: "POST",
      path: "/api/v1/chat/web",
      routePath: "/api/v1/chat/web",
      statusCode: 200,
      latencyMs: 90_000
    });
    metrics.endInFlightRequest();

    const service = new ResolveAdminOverviewDashboardService(
      {
        async assertCanReadAdminSurface(userId: string) {
          assert.equal(userId, "admin-1");
          return {
            userId,
            workspaceId: "ws-admin",
            roles: ["ops_admin"],
            hasGlobalPlatformAdminScope: true
          };
        }
      } as Pick<
        AdminAuthorizationService,
        "assertCanReadAdminSurface"
      > as AdminAuthorizationService,
      metrics,
      {
        async execute() {
          return {
            runtime: {
              key: "runtime",
              label: "Runtime",
              baseUrlConfigured: true,
              endpointHost: "runtime:3002",
              desiredReplicas: 2,
              autoscalingEnabled: false,
              autoscalingMinReplicas: null,
              autoscalingMaxReplicas: null,
              discoveryMode: "headless_dns",
              discoveryTarget: "runtime-headless",
              opaque: false,
              live: true,
              ready: true,
              observedPodCount: 2,
              discoveredReadyPodCount: 2,
              checkedAt: "2026-04-07T12:00:00.000Z",
              notes: ["Fixed scale target: 2 replicas."],
              pods: [
                {
                  podIp: "10.0.0.11",
                  address: "10.0.0.11",
                  live: true,
                  ready: true,
                  checkedAt: "2026-04-07T12:00:00.000Z"
                },
                {
                  podIp: "10.0.0.12",
                  address: "10.0.0.12",
                  live: true,
                  ready: true,
                  checkedAt: "2026-04-07T12:00:00.000Z"
                }
              ]
            },
            providerGateway: {
              key: "provider_gateway",
              label: "Provider gateway",
              baseUrlConfigured: true,
              endpointHost: "provider-gateway:3003",
              desiredReplicas: 2,
              autoscalingEnabled: false,
              autoscalingMinReplicas: null,
              autoscalingMaxReplicas: null,
              discoveryMode: "headless_dns",
              discoveryTarget: "provider-gateway-headless",
              opaque: false,
              live: true,
              ready: true,
              observedPodCount: 2,
              discoveredReadyPodCount: 2,
              checkedAt: "2026-04-07T12:00:00.000Z",
              notes: ["Fixed scale target: 2 replicas."],
              pods: [
                {
                  podIp: "10.0.0.21",
                  address: "10.0.0.21",
                  live: true,
                  ready: true,
                  checkedAt: "2026-04-07T12:00:00.000Z"
                },
                {
                  podIp: "10.0.0.22",
                  address: "10.0.0.22",
                  live: true,
                  ready: true,
                  checkedAt: "2026-04-07T12:00:00.000Z"
                }
              ]
            }
          };
        }
      } as Pick<
        ResolveExecutionWorkloadOverviewService,
        "execute"
      > as ResolveExecutionWorkloadOverviewService,
      {
        assistantChat: {
          async groupBy() {
            return [{ userId: "user-1" }, { userId: "user-2" }];
          },
          async count() {
            return 5;
          }
        }
      } as unknown as WorkspaceManagementPrismaService,
      new OverviewLatencyTraceService(),
      new WebRuntimeShadowComparisonService()
    );

    const dashboard = await service.execute("admin-1");

    assert.equal(dashboard.activeUsers, 2);
    assert.equal(dashboard.activeWebChats, 5);
    assert.equal(dashboard.dataSource.scope, "api_instance_local");
    assert.equal(dashboard.dataSource.instanceId, "api-test-1");
    assert.equal(dashboard.latency.webChatTurns?.percentiles.p50Ms, 100);
    assert.equal(dashboard.latency.webChatTurns?.percentiles.p95Ms, 90_000);
    assert.equal(dashboard.latency.webChatTurns?.percentiles.p99Ms, 90_000);
    assert.equal(dashboard.aggregation.latency.webChatTurns?.count, 2);
    assert.equal(dashboard.aggregation.latency.webChatTurns?.durationMsTotal, 90_100);
    assert.equal(dashboard.latencyTrace.enabled, false);
    assert.equal(dashboard.webRuntimeShadowComparisons.recent.length, 0);
    assert.equal(dashboard.runtime.live, true);
    assert.equal(dashboard.runtime.ready, true);
    assert.equal(dashboard.runtime.runtime.endpointHost, "runtime:3002");
    assert.equal(dashboard.runtime.runtime.desiredReplicas, 2);
    assert.equal(dashboard.runtime.runtime.pods.length, 2);
    assert.equal(dashboard.runtime.providerGateway.endpointHost, "provider-gateway:3003");
    assert.equal(dashboard.runtime.providerGateway.desiredReplicas, 2);
    assert.equal(dashboard.runtime.providerGateway.pods.length, 2);
    assert.equal("storagePressure" in dashboard, false);
  } finally {
    process.env.APP_ENV = prevEnv.APP_ENV;
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.CLERK_SECRET_KEY = prevEnv.CLERK_SECRET_KEY;
    process.env.PERSAI_INTERNAL_API_TOKEN = prevEnv.PERSAI_INTERNAL_API_TOKEN;
    process.env.PERSAI_RUNTIME_BASE_URL = prevEnv.PERSAI_RUNTIME_BASE_URL;
    process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL = prevEnv.PERSAI_PROVIDER_GATEWAY_BASE_URL;
    process.env.POD_NAME = prevEnv.POD_NAME;
  }
}

void run();
