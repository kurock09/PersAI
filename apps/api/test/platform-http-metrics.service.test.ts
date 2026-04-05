import assert from "node:assert/strict";
import { PlatformHttpMetricsService } from "../src/modules/platform-core/application/platform-http-metrics.service";
import { RequestLoggingMiddleware } from "../src/modules/platform-core/interface/http/request-logging.middleware";

async function run(): Promise<void> {
  const service = new PlatformHttpMetricsService();

  service.beginRequest();
  assert.equal(service.getSnapshot().inFlightRequests, 1);

  service.recordCompletedRequest({
    method: "GET",
    path: "/ready?verbose=1",
    routePath: "/ready",
    statusCode: 200,
    latencyMs: 42.5
  });
  service.endInFlightRequest();

  service.beginRequest();
  service.recordCompletedRequest({
    method: "POST",
    path: "/api/v1/assistant/123/messages/456?draft=1",
    statusCode: 503,
    latencyMs: 780
  });
  service.endInFlightRequest();

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.inFlightRequests, 0);
  assert.equal(snapshot.requestsTotal, 2);
  assert.equal(snapshot.errorRequestsTotal, 1);
  assert.equal(snapshot.series.length, 2);

  const readySeries = snapshot.series.find(
    (series) =>
      series.key.method === "GET" && series.key.route === "/ready" && series.key.statusCode === 200
  );
  assert.ok(readySeries);
  assert.equal(readySeries?.count, 1);
  assert.equal(readySeries?.errorCount, 0);
  assert.equal(readySeries?.durationMsTotal, 42.5);
  assert.equal(readySeries?.maxDurationMs, 42.5);
  assert.equal(readySeries?.buckets.find((bucket) => bucket.le === 50)?.value, 1);
  assert.equal(readySeries?.buckets.find((bucket) => bucket.le === 100)?.value, 1);

  const errorSeries = snapshot.series.find(
    (series) =>
      series.key.method === "POST" &&
      series.key.route === "/api/v1/*" &&
      series.key.statusCode === 503
  );
  assert.ok(errorSeries);
  assert.equal(errorSeries?.count, 1);
  assert.equal(errorSeries?.errorCount, 1);
  assert.equal(errorSeries?.durationMsTotal, 780);
  assert.equal(errorSeries?.maxDurationMs, 780);
  assert.equal(errorSeries?.buckets.find((bucket) => bucket.le === 500)?.value, 0);
  assert.equal(errorSeries?.buckets.find((bucket) => bucket.le === 1_000)?.value, 1);

  const middlewareMetrics = new PlatformHttpMetricsService();
  const middleware = new RequestLoggingMiddleware(
    {
      get: () => ({ requestId: "req-1", userId: null, workspaceId: null })
    } as never,
    {
      requestCompleted() {
        return undefined;
      }
    } as never,
    middlewareMetrics
  );

  const closeHandlers = new Map<string, () => void>();
  middleware.use(
    {
      method: "GET",
      originalUrl: "/api/v1/assistant/999/messages/888?cursor=1",
      url: "/api/v1/assistant/999/messages/888?cursor=1",
      baseUrl: "",
      route: undefined,
      requestId: "req-1",
      userId: null,
      workspaceId: null
    } as never,
    {
      statusCode: 499,
      on(event: string, handler: () => void) {
        closeHandlers.set(event, handler);
        return this;
      }
    } as never,
    () => undefined
  );

  assert.equal(middlewareMetrics.getSnapshot().inFlightRequests, 1);
  closeHandlers.get("close")?.();
  assert.equal(middlewareMetrics.getSnapshot().inFlightRequests, 0);
  assert.equal(middlewareMetrics.getSnapshot().requestsTotal, 0);
}

void run();
