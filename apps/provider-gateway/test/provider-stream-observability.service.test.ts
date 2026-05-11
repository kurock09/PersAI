import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ProviderGatewayMetricsService } from "../src/modules/platform-core/application/provider-gateway-metrics.service";
import { ProviderStreamObservabilityService } from "../src/modules/providers/provider-stream-observability.service";

describe("ProviderStreamObservabilityService", () => {
  test("renders stream request pressure and stage metrics", () => {
    const service = new ProviderStreamObservabilityService();
    service.beginStreamRequest();
    service.recordStreamRequest({
      provider: "openai",
      classification: "main_turn",
      status: "completed",
      totalMs: 980,
      stageDurations: [
        { stage: "first_event", durationMs: 220 },
        { stage: "first_text_delta", durationMs: 320 },
        { stage: "total", durationMs: 980 }
      ]
    });

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.inFlightStreamRequests, 1);
    assert.equal(snapshot.requestSeries[0]?.count, 1);
    assert.equal(snapshot.stageSeries.length, 3);

    const metrics = new ProviderGatewayMetricsService(
      {
        getSnapshot() {
          return {
            ready: true,
            providerCacheReady: true
          };
        }
      } as never,
      {
        getSnapshot() {
          return {
            runs: 1,
            failures: 0,
            lastDurationMs: 50,
            providers: [
              {
                provider: "openai",
                configured: true,
                state: "ready",
                catalogModels: ["gpt-5.4"]
              }
            ]
          };
        }
      } as never,
      service
    ).renderMetrics();

    assert.match(metrics, /^provider_gateway_stream_requests_in_flight 1$/m);
    assert.match(
      metrics,
      /^provider_gateway_stream_requests_total\{provider="openai",classification="main_turn",status="completed"\} 1$/m
    );
    assert.match(
      metrics,
      /^provider_gateway_stream_duration_ms_sum\{provider="openai",classification="main_turn",status="completed"\} 980\.00$/m
    );
    assert.match(
      metrics,
      /^provider_gateway_stream_stage_duration_ms_sum\{provider="openai",classification="main_turn",stage="first_event",status="completed"\} 220\.00$/m
    );
  });
});
