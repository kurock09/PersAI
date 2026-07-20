import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";
import { DeepSeekProviderClient } from "../src/modules/providers/deepseek/deepseek-provider.client";
import { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import { ProviderCatalogService } from "../src/modules/providers/provider-catalog.service";
import { ProviderWarmupService } from "../src/modules/providers/provider-warmup.service";
import { ProviderGatewayReadinessService } from "../src/modules/platform-core/application/provider-gateway-readiness.service";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";
import type {
  ProviderGatewayProvider,
  ProviderWarmableClient
} from "../src/modules/providers/provider-client.types";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS: 5,
    PROVIDER_GATEWAY_BOOT_WARMUP_RETRY_DELAY_MS: 2_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_RECOVERY_INTERVAL_MS: 10_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://production-sfo.browserless.io",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

class CapturingProviderClient implements ProviderWarmableClient {
  readonly catalogSource = "bootstrap_config" as const;
  readonly warmedKeys: Array<string | undefined> = [];

  constructor(
    readonly provider: ProviderGatewayProvider,
    private readonly configured: boolean,
    private readonly models: string[]
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  getCatalogModels(): string[] {
    return [...this.models];
  }

  async warm(apiKeyOverride?: string): Promise<void> {
    this.warmedKeys.push(apiKeyOverride);
  }
}

export async function runProviderWarmupServiceTest(): Promise<void> {
  const config = createConfig();
  const openaiClient = new OpenAIProviderClient(config);
  const anthropicClient = new AnthropicProviderClient(config);
  const deepseekClient = new DeepSeekProviderClient(config);
  const warmupService = new ProviderWarmupService(
    config,
    {
      isConfigured() {
        return false;
      }
    } as Pick<PersaiInternalApiClientService, "isConfigured"> as PersaiInternalApiClientService,
    openaiClient,
    anthropicClient,
    deepseekClient
  );
  const catalogService = new ProviderCatalogService(warmupService);
  const readinessService = new ProviderGatewayReadinessService(warmupService);

  const beforeWarmup = readinessService.getSnapshot();
  assert.equal(beforeWarmup.ready, false);
  assert.equal(beforeWarmup.providerCacheReady, true);
  assert.equal(beforeWarmup.providers[0]?.state, "unconfigured");
  assert.equal(beforeWarmup.providers[1]?.state, "unconfigured");
  assert.equal(beforeWarmup.providers[2]?.state, "unconfigured");
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
    },
    {
      provider: "deepseek",
      models: [],
      source: "bootstrap_config"
    }
  ]);

  const warmup = await warmupService.warmProviders({
    schema: "persai.providerGatewayWarmupRequest.v1",
    source: "control_plane_apply",
    availableModelsByProvider: {
      openai: ["gpt-5.4-mini", "gpt-5.4-mini", "gpt-5.4"],
      anthropic: ["claude-3-7-sonnet", "claude-3-7-sonnet"],
      deepseek: ["deepseek-v4-flash", "deepseek-v4-flash"]
    }
  });
  assert.equal(warmup.runs, 1);
  assert.equal(warmup.failures, 0);
  assert.equal(warmup.providers[0]?.provider, "openai");
  assert.equal(warmup.providers[0]?.configured, false);
  assert.equal(warmup.providers[0]?.state, "unconfigured");
  assert.equal(warmup.providers[0]?.catalogSource, "control_plane_apply");
  assert.deepEqual(warmup.providers[0]?.catalogModels, ["gpt-5.4-mini", "gpt-5.4"]);
  assert.equal(warmup.providers[1]?.provider, "anthropic");
  assert.equal(warmup.providers[1]?.configured, false);
  assert.equal(warmup.providers[1]?.state, "unconfigured");
  assert.equal(warmup.providers[1]?.catalogSource, "control_plane_apply");
  assert.deepEqual(warmup.providers[1]?.catalogModels, ["claude-3-7-sonnet"]);
  assert.equal(warmup.providers[2]?.provider, "deepseek");
  assert.equal(warmup.providers[2]?.configured, false);
  assert.equal(warmup.providers[2]?.state, "unconfigured");
  assert.equal(warmup.providers[2]?.catalogSource, "control_plane_apply");
  assert.deepEqual(warmup.providers[2]?.catalogModels, ["deepseek-v4-flash"]);

  const afterWarmup = readinessService.getSnapshot();
  assert.equal(afterWarmup.ready, true);
  assert.equal(afterWarmup.providerCacheReady, true);
  await assert.rejects(
    () =>
      warmupService.ensureReadyForRequest({
        provider: "openai",
        model: "gpt-5.4"
      }),
    /Provider "openai" is not ready/
  );
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
    },
    {
      provider: "deepseek",
      models: ["deepseek-v4-flash"],
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
          anthropic: [],
          deepseek: []
        }
      }),
    /source must equal "control_plane_apply"/
  );

  let internalRefreshCalls = 0;
  const autoRefreshService = new ProviderWarmupService(
    config,
    {
      isConfigured() {
        return true;
      },
      async resolveSecretValue(secretId: string) {
        if (secretId === "openai/api-key") {
          return "openai-managed-test-key";
        }
        throw new Error(`PersAI-managed runtime secret "${secretId}" is not configured.`);
      },
      async getDefaultProviderSettings() {
        internalRefreshCalls += 1;
        return {
          generation: 7,
          mode: "global_settings",
          primary: { provider: "openai", model: "gpt-5.4-mini" },
          availableModelsByProvider: {
            openai: ["gpt-5.4-mini", "gpt-5.4"],
            anthropic: [],
            deepseek: []
          }
        };
      }
    } as Pick<
      PersaiInternalApiClientService,
      "isConfigured" | "getDefaultProviderSettings"
    > as PersaiInternalApiClientService,
    new OpenAIProviderClient(config),
    new AnthropicProviderClient(config),
    new DeepSeekProviderClient(config)
  );

  const refreshed = await autoRefreshService.ensureReadyForRequest({
    provider: "openai",
    model: "gpt-5.4-mini"
  });
  assert.equal(internalRefreshCalls, 1);
  assert.equal(refreshed.provider, "openai");
  assert.equal(refreshed.state, "ready");
  assert.equal(refreshed.catalogSource, "control_plane_apply");
  assert.deepEqual(refreshed.catalogModels, ["gpt-5.4-mini", "gpt-5.4"]);

  const capturingOpenaiClient = new CapturingProviderClient("openai", true, ["gpt-5.4"]);
  const capturingAnthropicClient = new CapturingProviderClient("anthropic", false, [
    "claude-sonnet-4-5"
  ]);
  const capturingDeepseekClient = new CapturingProviderClient("deepseek", false, [
    "deepseek-v4-flash"
  ]);
  const managedOpenaiService = new ProviderWarmupService(
    config,
    {
      isConfigured() {
        return true;
      },
      async resolveSecretValue(secretId: string) {
        if (secretId === "openai/api-key") {
          return "openai-managed-test-key";
        }
        throw new Error(`PersAI-managed runtime secret "${secretId}" is not configured.`);
      },
      async getDefaultProviderSettings() {
        return {
          generation: 8,
          mode: "global_settings",
          primary: { provider: "openai", model: "gpt-5.4" },
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: [],
            deepseek: []
          }
        };
      }
    } as Pick<
      PersaiInternalApiClientService,
      "isConfigured" | "resolveSecretValue" | "getDefaultProviderSettings"
    > as PersaiInternalApiClientService,
    capturingOpenaiClient as unknown as OpenAIProviderClient,
    capturingAnthropicClient as unknown as AnthropicProviderClient,
    capturingDeepseekClient as unknown as DeepSeekProviderClient
  );
  await managedOpenaiService.warmProviders({
    schema: "persai.providerGatewayWarmupRequest.v1",
    source: "control_plane_apply",
    availableModelsByProvider: {
      openai: ["gpt-5.4"],
      anthropic: [],
      deepseek: []
    }
  });
  assert.deepEqual(capturingOpenaiClient.warmedKeys, ["openai-managed-test-key"]);
  assert.deepEqual(capturingAnthropicClient.warmedKeys, []);
  assert.deepEqual(capturingDeepseekClient.warmedKeys, []);

  const resolvedSecretIds: string[] = [];
  const managedAnthropicService = new ProviderWarmupService(
    config,
    {
      isConfigured() {
        return true;
      },
      async resolveSecretValue(secretId: string) {
        resolvedSecretIds.push(secretId);
        return "anthropic-managed-test-key";
      },
      async getDefaultProviderSettings() {
        return {
          generation: 8,
          mode: "global_settings",
          primary: { provider: "anthropic", model: "claude-opus-4-7" },
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: ["claude-opus-4-7"],
            deepseek: []
          }
        };
      }
    } as Pick<
      PersaiInternalApiClientService,
      "isConfigured" | "resolveSecretValue" | "getDefaultProviderSettings"
    > as PersaiInternalApiClientService,
    new OpenAIProviderClient(config),
    new AnthropicProviderClient(config),
    new DeepSeekProviderClient(config)
  );

  const managedAnthropic = await managedAnthropicService.ensureReadyForRequest({
    provider: "anthropic",
    model: "claude-opus-4-7"
  });
  assert.equal(resolvedSecretIds.includes("anthropic/api-key"), true);
  assert.equal(managedAnthropic.provider, "anthropic");
  assert.equal(managedAnthropic.configured, true);
  assert.equal(managedAnthropic.state, "ready");
  assert.equal(managedAnthropic.catalogSource, "control_plane_apply");
  assert.deepEqual(managedAnthropic.catalogModels, ["claude-opus-4-7"]);

  let resolvedDeepSeekSecretId: string | null = null;
  const managedDeepSeekService = new ProviderWarmupService(
    config,
    {
      isConfigured() {
        return true;
      },
      async resolveSecretValue(secretId: string) {
        resolvedDeepSeekSecretId = secretId;
        return "deepseek-managed-test-key";
      },
      async getDefaultProviderSettings() {
        return {
          generation: 9,
          mode: "global_settings",
          primary: { provider: "deepseek", model: "deepseek-v4-flash" },
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: [],
            deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"]
          }
        };
      }
    } as Pick<
      PersaiInternalApiClientService,
      "isConfigured" | "resolveSecretValue" | "getDefaultProviderSettings"
    > as PersaiInternalApiClientService,
    new OpenAIProviderClient(config),
    new AnthropicProviderClient(config),
    new DeepSeekProviderClient(config)
  );

  const managedDeepSeek = await managedDeepSeekService.ensureReadyForRequest({
    provider: "deepseek",
    model: "deepseek-v4-flash"
  });
  assert.equal(resolvedDeepSeekSecretId, "deepseek/api-key");
  assert.equal(managedDeepSeek.provider, "deepseek");
  assert.equal(managedDeepSeek.configured, true);
  assert.equal(managedDeepSeek.state, "ready");
  assert.equal(managedDeepSeek.catalogSource, "control_plane_apply");
  assert.deepEqual(managedDeepSeek.catalogModels, ["deepseek-v4-flash", "deepseek-v4-pro"]);
}
