import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";
import { ProviderGatewayReadinessService } from "../src/modules/platform-core/application/provider-gateway-readiness.service";
import {
  hasRetryableWarmupFailures,
  isProviderGatewayWarmupReady,
  isRetryableWarmupError
} from "../src/modules/providers/provider-warmup-boot-recovery";
import { ProviderWarmupService } from "../src/modules/providers/provider-warmup.service";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";
import { createProviderGatewayTestConfig } from "./provider-gateway-test-config";

function createConfig(overrides: Record<string, string> = {}): ProviderGatewayConfig {
  return createProviderGatewayTestConfig({
    PROVIDER_GATEWAY_WARM_ON_BOOT: "true",
    PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS: "3",
    PROVIDER_GATEWAY_BOOT_WARMUP_RETRY_DELAY_MS: "1",
    PROVIDER_GATEWAY_BOOT_WARMUP_RECOVERY_INTERVAL_MS: "20",
    ...overrides
  });
}

export async function runProviderWarmupBootRecoveryTest(): Promise<void> {
  assert.equal(isRetryableWarmupError("Server has closed the connection."), true);
  assert.equal(isRetryableWarmupError("Invalid API key"), false);

  let anthropicResolveAttempts = 0;
  const config = createConfig();
  const warmupService = new ProviderWarmupService(
    config,
    {
      isConfigured() {
        return true;
      },
      async resolveSecretValue(secretId: string) {
        if (secretId === "openai/api-key") {
          return "openai-managed-test-key";
        }
        if (secretId === "anthropic/api-key") {
          anthropicResolveAttempts += 1;
          if (anthropicResolveAttempts < 2) {
            throw new Error("Server has closed the connection.");
          }
          return "anthropic-managed-test-key";
        }
        throw new Error(`Unexpected secret id ${secretId}`);
      }
    } as Pick<
      PersaiInternalApiClientService,
      "isConfigured" | "resolveSecretValue"
    > as PersaiInternalApiClientService,
    new OpenAIProviderClient(config),
    new AnthropicProviderClient(config)
  );
  const readinessService = new ProviderGatewayReadinessService(warmupService);

  await warmupService.onModuleInit();

  const snapshot = readinessService.getSnapshot();
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.providers[0]?.state, "ready");
  assert.equal(snapshot.providers[1]?.state, "ready");
  assert.equal(anthropicResolveAttempts, 2);
  assert.equal(isProviderGatewayWarmupReady(warmupService.getSnapshot()), true);
  assert.equal(hasRetryableWarmupFailures(warmupService.getSnapshot()), false);

  warmupService.onModuleDestroy();
}

export async function runProviderWarmupBootRecoveryLoopTest(): Promise<void> {
  let anthropicResolveAttempts = 0;
  const config = createConfig({
    PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS: "1"
  });
  const warmupService = new ProviderWarmupService(
    config,
    {
      isConfigured() {
        return true;
      },
      async resolveSecretValue(secretId: string) {
        if (secretId === "openai/api-key") {
          return "openai-managed-test-key";
        }
        if (secretId === "anthropic/api-key") {
          anthropicResolveAttempts += 1;
          if (anthropicResolveAttempts < 2) {
            throw new Error("Server has closed the connection.");
          }
          return "anthropic-managed-test-key";
        }
        throw new Error(`Unexpected secret id ${secretId}`);
      }
    } as Pick<
      PersaiInternalApiClientService,
      "isConfigured" | "resolveSecretValue"
    > as PersaiInternalApiClientService,
    new OpenAIProviderClient(config),
    new AnthropicProviderClient(config)
  );
  const readinessService = new ProviderGatewayReadinessService(warmupService);

  await warmupService.onModuleInit();
  assert.equal(readinessService.getSnapshot().ready, false);
  assert.equal(hasRetryableWarmupFailures(warmupService.getSnapshot()), true);

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 60);
  });

  assert.equal(readinessService.getSnapshot().ready, true);
  warmupService.onModuleDestroy();
}
