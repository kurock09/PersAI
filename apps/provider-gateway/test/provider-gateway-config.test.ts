import assert from "node:assert/strict";
import { loadProviderGatewayConfig } from "@persai/config";

export async function runProviderGatewayConfigTest(): Promise<void> {
  const config = loadProviderGatewayConfig({
    APP_ENV: "local",
    PROVIDER_GATEWAY_WARM_ON_BOOT: "false",
    PROVIDER_GATEWAY_OPENAI_MODELS: "gpt-5.4, gpt-4.1",
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: "claude-sonnet-4-5",
    PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key"
  });

  assert.equal(config.PORT, 3011);
  assert.equal(config.LOG_LEVEL, "info");
  assert.equal(config.PROVIDER_GATEWAY_WARM_ON_BOOT, false);
  assert.equal(config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS, 90000);
  assert.equal(config.PROVIDER_GATEWAY_STREAM_TIMEOUT_MS, 90000);
  assert.equal(
    config.PROVIDER_GATEWAY_BROWSERLESS_BASE_URL,
    "https://production-sfo.browserless.io"
  );
  assert.deepEqual(config.PROVIDER_GATEWAY_OPENAI_MODELS, ["gpt-5.4", "gpt-4.1"]);
  assert.deepEqual(config.PROVIDER_GATEWAY_ANTHROPIC_MODELS, ["claude-sonnet-4-5"]);
  assert.equal(config.PROVIDER_GATEWAY_OPENAI_API_KEY, "openai-test-key");
  assert.equal(config.PROVIDER_GATEWAY_ANTHROPIC_API_KEY, undefined);
}
