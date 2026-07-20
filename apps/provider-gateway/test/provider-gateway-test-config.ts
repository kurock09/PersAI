import { loadProviderGatewayConfig, type ProviderGatewayConfig } from "@persai/config";

export function createProviderGatewayTestConfig(
  overrides: Record<string, string | undefined> = {}
): ProviderGatewayConfig {
  return loadProviderGatewayConfig({
    APP_ENV: "local",
    PROVIDER_GATEWAY_WARM_ON_BOOT: "false",
    ...overrides
  });
}
