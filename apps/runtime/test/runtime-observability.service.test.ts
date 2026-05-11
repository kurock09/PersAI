import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuntimeMetricsService } from "../src/modules/platform-core/application/runtime-metrics.service";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";

describe("RuntimeObservabilityService", () => {
  test("tracks in-flight stream turns and stage timings", async () => {
    const service = new RuntimeObservabilityService();
    service.beginStreamTurn();
    service.beginStreamTurn();
    service.endStreamTurn();
    service.recordStreamTurn({
      scope: "stream_turn",
      status: "ok",
      totalMs: 1_250,
      stages: [
        { key: "accepted -> prepare.bundle_ready", durationMs: 120 },
        {
          key: "prepare.provider_request_built -> iter0.provider_headers_received",
          durationMs: 480
        }
      ]
    });

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.streamTurnsInFlight, 1);
    assert.equal(snapshot.peakStreamTurnsInFlight, 2);
    assert.equal(snapshot.streamTurnSeries[0]?.key.status, "ok");
    assert.equal(snapshot.streamTurnSeries[0]?.count, 1);
    assert.equal(snapshot.streamStageSeries.length, 2);

    const metrics = await new RuntimeMetricsService(
      {
        async getSnapshot() {
          return {
            ready: true,
            executionEnabled: true,
            bundleCacheReady: true,
            providerCacheReady: true
          };
        }
      } as never,
      {
        getSnapshot() {
          return {
            entries: 2,
            maxEntries: 32
          };
        }
      } as never,
      service
    ).renderMetrics();

    assert.match(metrics, /^runtime_stream_turns_in_flight 1$/m);
    assert.match(metrics, /^runtime_stream_turns_total\{status="ok"\} 1$/m);
    assert.match(metrics, /^runtime_stream_duration_ms_sum\{status="ok"\} 1250\.00$/m);
    assert.match(
      metrics,
      /^runtime_stream_stage_duration_ms_sum\{stage="accepted -> prepare\.bundle_ready",status="ok"\} 120\.00$/m
    );
  });
});
