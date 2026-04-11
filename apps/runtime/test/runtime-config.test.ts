import assert from "node:assert/strict";
import { loadRuntimeConfig } from "@persai/config";

export async function runRuntimeConfigTest(): Promise<void> {
  const config = loadRuntimeConfig({
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: "32",
    RUNTIME_STATE_REDIS_URL: "redis://localhost:6379",
    RUNTIME_STATE_REDIS_KEY_PREFIX: "persai:test-runtime",
    RUNTIME_SESSION_LEASE_TTL_SECONDS: "45",
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: "3600",
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: "7200",
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: "9000",
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: "15000"
  });

  assert.equal(config.DATABASE_URL, "postgresql://persai:persai@localhost:5432/persai");
  assert.equal(config.PORT, 3012);
  assert.equal(config.LOG_LEVEL, "info");
  assert.equal(config.RUNTIME_STATE_REDIS_URL, "redis://localhost:6379");
  assert.equal(config.RUNTIME_BUNDLE_CACHE_MAX_ENTRIES, 32);
  assert.equal(config.RUNTIME_STATE_REDIS_KEY_PREFIX, "persai:test-runtime");
  assert.equal(config.RUNTIME_SESSION_LEASE_TTL_SECONDS, 45);
  assert.equal(config.RUNTIME_TURN_RECEIPT_TTL_SECONDS, 3600);
  assert.equal(config.RUNTIME_BUNDLE_MARKER_TTL_SECONDS, 7200);
  assert.equal(config.RUNTIME_PROVIDER_GATEWAY_BASE_URL, undefined);
  assert.equal(config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS, 9000);
  assert.equal(config.RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS, 15000);
}
