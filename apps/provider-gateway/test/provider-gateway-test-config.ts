import { loadProviderGatewayConfig, type ProviderGatewayConfig } from "@persai/config";

export function createProviderGatewayTestConfig(
  overrides: Record<string, string | undefined> = {}
): ProviderGatewayConfig {
  return loadProviderGatewayConfig({
    APP_ENV: "local",
    PROVIDER_GATEWAY_WARM_ON_BOOT: "false",
    PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
    ...overrides
  });
}
