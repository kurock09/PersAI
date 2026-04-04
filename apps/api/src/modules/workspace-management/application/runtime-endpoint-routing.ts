import type { RuntimeTier } from "./runtime-assignment";

export type RuntimeEndpointRoutingConfig = {
  tierBaseUrls: Record<RuntimeTier, string>;
};

export function normalizeRuntimeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveRuntimeBaseUrl(params: {
  config: RuntimeEndpointRoutingConfig;
  runtimeTier: RuntimeTier | null | undefined;
}): {
  baseUrl: string;
  resolvedTier: RuntimeTier;
  source: "tier_specific" | "platform_default";
} {
  const requestedTier = params.runtimeTier ?? "free_shared_restricted";
  const tierUrl = normalizeRuntimeBaseUrl(params.config.tierBaseUrls[requestedTier]);
  if (tierUrl === null) {
    throw new Error(`Missing runtime base URL for tier "${requestedTier}".`);
  }

  return {
    baseUrl: tierUrl,
    resolvedTier: requestedTier,
    source: params.runtimeTier ? "tier_specific" : "platform_default"
  };
}
