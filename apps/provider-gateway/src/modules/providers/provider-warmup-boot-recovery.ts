import type { ProviderWarmupSnapshot } from "./provider-client.types";

const RETRYABLE_WARMUP_ERROR_PATTERNS: RegExp[] = [
  /server has closed the connection/i,
  /connection refused/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /fetch failed/i,
  /socket hang up/i,
  /network error/i,
  /persai internal api.*failed/i,
  /service unavailable/i,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /timed?\s*out/i
];

export function isProviderGatewayWarmupReady(snapshot: ProviderWarmupSnapshot): boolean {
  const providerCacheReady = snapshot.providers.every((provider) => {
    return provider.state === "ready" || provider.state === "unconfigured";
  });
  return snapshot.runs > 0 && providerCacheReady;
}

export function isRetryableWarmupError(error: string | null | undefined): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  const normalized = error.trim();
  if (normalized.length === 0) {
    return false;
  }
  return RETRYABLE_WARMUP_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasRetryableWarmupFailures(snapshot: ProviderWarmupSnapshot): boolean {
  return snapshot.providers.some(
    (provider) => provider.state === "failed" && isRetryableWarmupError(provider.error)
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
