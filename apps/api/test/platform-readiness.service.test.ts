import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { MetricsController } from "../src/modules/platform-core/interface/http/metrics.controller";
import { ReadyController } from "../src/modules/platform-core/interface/http/ready.controller";
import { PlatformReadinessService } from "../src/modules/platform-core/application/platform-readiness.service";

async function run(): Promise<void> {
  let identityChecks = 0;
  let workspaceChecks = 0;

  const readinessService = new PlatformReadinessService({
    get(token: unknown) {
      if ((token as { name?: string }).name === "PrismaService") {
        return {
          async $queryRaw(strings: TemplateStringsArray) {
            identityChecks += 1;
            assert.equal(strings[0], "SELECT 1");
            return [{ "?column?": 1 }];
          }
        };
      }

      if ((token as { name?: string }).name === "WorkspaceManagementPrismaService") {
        return {
          async $queryRaw(strings: TemplateStringsArray) {
            workspaceChecks += 1;
            assert.equal(strings[0], "SELECT 1");
            return [{ "?column?": 1 }];
          }
        };
      }

      return undefined;
    }
  } as never);

  const firstSnapshot = await readinessService.getSnapshot();
  const secondSnapshot = await readinessService.getSnapshot();
  assert.equal(firstSnapshot.ready, true);
  assert.equal(secondSnapshot.ready, true);
  assert.equal(identityChecks, 1);
  assert.equal(workspaceChecks, 1);
  assert.equal(firstSnapshot.dependencies.length, 2);
  assert.equal(
    firstSnapshot.dependencies.every((dependency) => dependency.ready),
    true
  );

  let degradedChecks = 0;
  const degradedReadinessService = new PlatformReadinessService({
    get(token: unknown) {
      if ((token as { name?: string }).name === "PrismaService") {
        return {
          async $queryRaw() {
            degradedChecks += 1;
            throw new Error("password authentication failed for user postgres");
          }
        };
      }

      if ((token as { name?: string }).name === "WorkspaceManagementPrismaService") {
        return {
          async $queryRaw() {
            degradedChecks += 1;
            return [{ "?column?": 1 }];
          }
        };
      }

      return undefined;
    }
  } as never);

  const degradedFirstSnapshot = await degradedReadinessService.getSnapshot();
  const degradedSecondSnapshot = await degradedReadinessService.getSnapshot();
  assert.equal(degradedFirstSnapshot.ready, false);
  assert.equal(degradedSecondSnapshot.ready, false);
  assert.equal(degradedChecks, 2);
  assert.equal(degradedFirstSnapshot.dependencies[0]?.error, "dependency_unavailable");
  assert.equal(
    degradedSecondSnapshot.dependencies.find(
      (dependency) => dependency.name === "identity_access_db"
    )?.error,
    "dependency_unavailable"
  );

  const degradedReadyController = new ReadyController(
    {
      get: () => ({ requestId: "req-not-ready" })
    } as never,
    {
      async getSnapshot() {
        return {
          ready: false,
          checkedAt: "2026-04-05T12:00:00.000Z",
          dependencies: [
            {
              name: "identity_access_db",
              ready: false,
              durationMs: 12,
              error: "dependency_unavailable"
            },
            {
              name: "workspace_management_db",
              ready: true,
              durationMs: 4,
              error: null
            }
          ]
        };
      }
    } as never
  );

  let readyStatusCode: number | null = null;
  const readyPayload = await degradedReadyController.getReady({
    status(code: number) {
      readyStatusCode = code;
      return this;
    }
  });

  assert.equal(readyStatusCode, 503);
  assert.equal(readyPayload.status, "not_ready");
  assert.equal(readyPayload.requestId, "req-not-ready");
  assert.equal(readyPayload.dependencies[0]?.status, "down");
  assert.equal(readyPayload.dependencies[0]?.error, "dependency_unavailable");

  const httpMetricsService = new PlatformHttpMetricsService();
  httpMetricsService.beginRequest();
  httpMetricsService.recordCompletedRequest({
    method: "GET",
    path: "/ready",
    routePath: "/ready",
    statusCode: 503,
    latencyMs: 12
  });
  httpMetricsService.endInFlightRequest();
  httpMetricsService.beginRequest();
  httpMetricsService.recordCompletedRequest({
    method: "GET",
    path: "/metrics",
    routePath: "/metrics",
    statusCode: 200,
    latencyMs: 8
  });
  httpMetricsService.endInFlightRequest();

  const metricsController = new MetricsController(
    {
      async getSnapshot() {
        return {
          ready: false,
          checkedAt: "2026-04-05T12:00:00.000Z",
          dependencies: [
            {
              name: "identity_access_db",
              ready: false,
              durationMs: 12,
              error: "dependency_unavailable"
            },
            {
              name: "workspace_management_db",
              ready: true,
              durationMs: 4,
              error: null
            }
          ]
        };
      }
    } as never,
    httpMetricsService
  );

  let metricsContentType: string | null = null;
  const metricsText = await metricsController.getMetrics({
    setHeader(name: string, value: string) {
      if (name === "Content-Type") {
        metricsContentType = value;
      }
    }
  });

  assert.equal(metricsContentType, "text/plain; version=0.0.4; charset=utf-8");
  assert.match(metricsText, /^app_ready 0$/m);
  assert.match(metricsText, /^app_dependency_ready\{dependency="identity_access_db"\} 0$/m);
  assert.match(metricsText, /^app_dependency_ready\{dependency="workspace_management_db"\} 1$/m);
  assert.match(
    metricsText,
    /^app_dependency_check_duration_ms\{dependency="identity_access_db"\} 12$/m
  );
  assert.match(metricsText, /^http_requests_total 2$/m);
  assert.match(metricsText, /^http_error_requests_total 1$/m);
  assert.match(metricsText, /^http_requests_in_flight 0$/m);
  assert.match(
    metricsText,
    /^http_requests_by_status_total\{method="GET",route="\/ready",status_code="503",status_class="5xx"\} 1$/m
  );
  assert.match(
    metricsText,
    /^http_request_duration_ms_sum\{method="GET",route="\/ready",status_code="503",status_class="5xx"\} 12\.00$/m
  );
  assert.match(
    metricsText,
    /^http_request_duration_ms_bucket\{method="GET",route="\/ready",status_code="503",status_class="5xx",le="50"\} 1$/m
  );
  assert.match(
    metricsText,
    /^http_request_duration_ms_bucket\{method="GET",route="\/ready",status_code="503",status_class="5xx",le="\+Inf"\} 1$/m
  );
  assert.match(
    metricsText,
    /^http_request_duration_ms_count\{method="GET",route="\/ready",status_code="503",status_class="5xx"\} 1$/m
  );
  assert.match(metricsText, /^process_resident_memory_bytes \d+$/m);
  assert.match(metricsText, /^nodejs_heap_total_bytes \d+$/m);
  assert.match(metricsText, /^nodejs_external_memory_bytes \d+$/m);
}

void run();
