export const PROVIDER_GATEWAY_PROVIDERS = ["openai", "anthropic"] as const;

export type ProviderGatewayProvider = (typeof PROVIDER_GATEWAY_PROVIDERS)[number];

export type ProviderWarmState = "pending" | "unconfigured" | "warming" | "ready" | "failed";

export type ProviderCatalogSource = "bootstrap_config" | "control_plane_apply";

export type ProviderCatalogByProvider = Record<ProviderGatewayProvider, string[]>;

export type ProviderGatewayWarmupRequest = {
  schema: "persai.providerGatewayWarmupRequest.v1";
  source: "control_plane_apply";
  availableModelsByProvider: ProviderCatalogByProvider;
};

export type ProviderCatalogEntry = {
  provider: ProviderGatewayProvider;
  models: string[];
  source: ProviderCatalogSource;
};

export type ProviderCatalogSnapshot = {
  schema: "persai.providerGatewayCatalog.v1";
  generatedAt: string;
  providers: ProviderCatalogEntry[];
};

export type ProviderWarmStatus = {
  provider: ProviderGatewayProvider;
  configured: boolean;
  state: ProviderWarmState;
  catalogModels: string[];
  catalogSource: ProviderCatalogSource;
  warmedAt: string | null;
  error: string | null;
};

export type ProviderWarmupSnapshot = {
  schema: "persai.providerGatewayWarmup.v1";
  warmOnBoot: boolean;
  runs: number;
  failures: number;
  lastAttemptedAt: string | null;
  lastCompletedAt: string | null;
  lastDurationMs: number | null;
  providers: ProviderWarmStatus[];
};

export type ProviderReadinessSnapshot = {
  checkedAt: string;
  ready: boolean;
  providerCacheReady: boolean;
  providers: ProviderWarmStatus[];
};

export interface ProviderWarmableClient {
  readonly provider: ProviderGatewayProvider;
  readonly catalogSource: ProviderCatalogSource;
  isConfigured(): boolean;
  getCatalogModels(): string[];
  warm(apiKeyOverride?: string): Promise<void>;
}
