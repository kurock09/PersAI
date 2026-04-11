import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { PersaiRuntimeTier, RuntimeBundleRef } from "@persai/runtime-contract";

export interface WarmRuntimeBundleRequest {
  bundle: RuntimeBundleRef;
  bundleDocument: string;
  materializedSpecId: string;
  runtimeTier: PersaiRuntimeTier;
}

export interface WarmRuntimeBundleResponse {
  bundle: RuntimeBundleRef;
  warmedAt: string;
  replaced: boolean;
  cacheEntries: number;
  evictedBundleIds: string[];
}

export interface InvalidateRuntimeBundleRequest {
  assistantId: string;
  publishedVersionId?: string;
}

export interface InvalidateRuntimeBundleResponse {
  invalidatedAt: string;
  invalidatedCount: number;
  remainingEntries: number;
}

export interface RuntimeBundleCacheEntry {
  bundle: RuntimeBundleRef;
  bundleDocument: string;
  parsedBundle: AssistantRuntimeBundle;
  warmedAt: string;
}

export interface RuntimeBundleRegistrySnapshot {
  initialized: boolean;
  initializedAt: string | null;
  maxEntries: number;
  entries: number;
}
