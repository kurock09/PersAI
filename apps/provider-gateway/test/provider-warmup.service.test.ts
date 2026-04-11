import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import { ProviderCatalogService } from "../src/modules/providers/provider-catalog.service";
import { ProviderWarmupService } from "../src/modules/providers/provider-warmup.service";
import { ProviderGatewayReadinessService } from "../src/modules/platform-core/application/provider-gateway-readiness.service";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

export async function runProviderWarmupServiceTest(): Promise<void> {
  const config = createConfig();
  const openaiClient = new OpenAIProviderClient(config);
  const anthropicClient = new AnthropicProviderClient(config);
  const warmupService = new ProviderWarmupService(config, openaiClient, anthropicClient);
  const catalogService = new ProviderCatalogService(warmupService);
  const readinessService = new ProviderGatewayReadinessService(warmupService);

  const beforeWarmup = readinessService.getSnapshot();
  assert.equal(beforeWarmup.ready, false);
  assert.equal(beforeWarmup.providerCacheReady, false);
  assert.equal(beforeWarmup.providers[0]?.state, "pending");
  assert.equal(beforeWarmup.providers[1]?.state, "unconfigured");
  assert.equal(beforeWarmup.providers[0]?.catalogSource, "bootstrap_config");
  assert.deepEqual(catalogService.getSnapshot().providers, [
    {
      provider: "openai",
      models: ["gpt-5.4"],
      source: "bootstrap_config"
    },
    {
      provider: "anthropic",
      models: ["claude-sonnet-4-5"],
      source: "bootstrap_config"
    }
  ]);

  const warmup = await warmupService.warmProviders({
    schema: "persai.providerGatewayWarmupRequest.v1",
    source: "control_plane_apply",
    availableModelsByProvider: {
      openai: ["gpt-5.4-mini", "gpt-5.4-mini", "gpt-5.4"],
      anthropic: ["claude-3-7-sonnet", "claude-3-7-sonnet"]
    }
  });
  assert.equal(warmup.runs, 1);
  assert.equal(warmup.failures, 0);
  assert.equal(warmup.providers[0]?.provider, "openai");
  assert.equal(warmup.providers[0]?.configured, true);
  assert.equal(warmup.providers[0]?.state, "ready");
  assert.equal(warmup.providers[0]?.catalogSource, "control_plane_apply");
  assert.deepEqual(warmup.providers[0]?.catalogModels, ["gpt-5.4-mini", "gpt-5.4"]);
  assert.equal(warmup.providers[1]?.provider, "anthropic");
  assert.equal(warmup.providers[1]?.configured, false);
  assert.equal(warmup.providers[1]?.state, "unconfigured");
  assert.equal(warmup.providers[1]?.catalogSource, "control_plane_apply");
  assert.deepEqual(warmup.providers[1]?.catalogModels, ["claude-3-7-sonnet"]);

  const afterWarmup = readinessService.getSnapshot();
  assert.equal(afterWarmup.ready, true);
  assert.equal(afterWarmup.providerCacheReady, true);
  assert.deepEqual(catalogService.getSnapshot().providers, [
    {
      provider: "openai",
      models: ["gpt-5.4-mini", "gpt-5.4"],
      source: "control_plane_apply"
    },
    {
      provider: "anthropic",
      models: ["claude-3-7-sonnet"],
      source: "control_plane_apply"
    }
  ]);

  await assert.rejects(
    () =>
      warmupService.warmProviders({
        schema: "persai.providerGatewayWarmupRequest.v1",
        source: "invalid",
        availableModelsByProvider: {
          openai: [],
          anthropic: []
        }
      }),
    /source must equal "control_plane_apply"/
  );
}
