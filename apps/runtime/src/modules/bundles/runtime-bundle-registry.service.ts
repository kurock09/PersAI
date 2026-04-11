import { BadRequestException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  hashAssistantRuntimeBundleDocument,
  type AssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type { RuntimeConfig } from "@persai/config";
import { RUNTIME_CONFIG } from "../../runtime-config";
import { RuntimeObservabilityService } from "../observability/runtime-observability.service";
import type {
  InvalidateRuntimeBundleRequest,
  InvalidateRuntimeBundleResponse,
  RuntimeBundleCacheEntry,
  RuntimeBundleRegistrySnapshot,
  WarmRuntimeBundleRequest,
  WarmRuntimeBundleResponse
} from "./bundle.types";

@Injectable()
export class RuntimeBundleRegistryService implements OnModuleInit {
  private readonly bundles = new Map<string, RuntimeBundleCacheEntry>();
  private initialized = false;
  private initializedAt: string | null = null;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly runtimeObservabilityService: RuntimeObservabilityService
  ) {}

  onModuleInit(): void {
    this.initialized = true;
    this.initializedAt = new Date().toISOString();
  }

  validateWarmBundleInput(input: WarmRuntimeBundleRequest): void {
    this.parseAndValidateWarmBundleInput(input);
  }

  warmBundle(
    input: WarmRuntimeBundleRequest,
    warmedAtOverride?: string
  ): WarmRuntimeBundleResponse {
    const parsedBundle = this.parseAndValidateWarmBundleInput(input);
    const warmedAt = warmedAtOverride ?? new Date().toISOString();

    const replaced = this.bundles.has(input.bundle.bundleId);
    if (replaced) {
      this.bundles.delete(input.bundle.bundleId);
    }

    this.bundles.set(input.bundle.bundleId, {
      bundle: input.bundle,
      bundleDocument: input.bundleDocument,
      parsedBundle,
      warmedAt
    });

    const evictedBundleIds = this.evictOldestBundles();
    this.runtimeObservabilityService.recordWarm({
      replaced,
      evictedCount: evictedBundleIds.length,
      warmedAt
    });

    return {
      bundle: input.bundle,
      warmedAt,
      replaced,
      cacheEntries: this.bundles.size,
      evictedBundleIds
    };
  }

  invalidateBundles(
    input: InvalidateRuntimeBundleRequest,
    invalidatedAtOverride?: string
  ): InvalidateRuntimeBundleResponse {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("request body must be an object");
    }

    this.assertNonEmpty(input.assistantId, "assistantId");

    const invalidatedAt = invalidatedAtOverride ?? new Date().toISOString();
    const keysToDelete: string[] = [];

    for (const [bundleId, entry] of this.bundles.entries()) {
      if (entry.bundle.assistantId !== input.assistantId) {
        continue;
      }
      if (
        input.publishedVersionId &&
        entry.bundle.publishedVersionId !== input.publishedVersionId
      ) {
        continue;
      }
      keysToDelete.push(bundleId);
    }

    for (const bundleId of keysToDelete) {
      this.bundles.delete(bundleId);
    }

    this.runtimeObservabilityService.recordInvalidation({
      invalidatedCount: keysToDelete.length,
      invalidatedAt
    });

    return {
      invalidatedAt,
      invalidatedCount: keysToDelete.length,
      remainingEntries: this.bundles.size
    };
  }

  getBundle(bundleId: string): RuntimeBundleCacheEntry | null {
    return this.bundles.get(bundleId) ?? null;
  }

  getSnapshot(): RuntimeBundleRegistrySnapshot {
    return {
      initialized: this.initialized,
      initializedAt: this.initializedAt,
      maxEntries: this.config.RUNTIME_BUNDLE_CACHE_MAX_ENTRIES,
      entries: this.bundles.size
    };
  }

  private parseAndValidateWarmBundleInput(input: WarmRuntimeBundleRequest): AssistantRuntimeBundle {
    if (!input.bundle || typeof input.bundle !== "object") {
      throw new BadRequestException("bundle must be an object");
    }

    this.assertNonEmpty(input.bundle.bundleId, "bundle.bundleId");
    this.assertNonEmpty(input.bundle.bundleHash, "bundle.bundleHash");
    this.assertNonEmpty(input.bundle.assistantId, "bundle.assistantId");
    this.assertNonEmpty(input.bundle.workspaceId, "bundle.workspaceId");
    this.assertNonEmpty(input.bundle.publishedVersionId, "bundle.publishedVersionId");
    this.assertNonEmpty(input.bundleDocument, "bundleDocument");

    const parsedBundle = this.parseBundleDocument(input.bundleDocument);
    const actualHash = hashAssistantRuntimeBundleDocument(input.bundleDocument);
    if (actualHash !== input.bundle.bundleHash) {
      throw new BadRequestException("bundleDocument hash does not match bundle.bundleHash");
    }
    if (parsedBundle.metadata.assistantId !== input.bundle.assistantId) {
      throw new BadRequestException("bundleDocument metadata.assistantId does not match bundle.assistantId");
    }
    if (parsedBundle.metadata.workspaceId !== input.bundle.workspaceId) {
      throw new BadRequestException("bundleDocument metadata.workspaceId does not match bundle.workspaceId");
    }
    if (parsedBundle.metadata.publishedVersionId !== input.bundle.publishedVersionId) {
      throw new BadRequestException(
        "bundleDocument metadata.publishedVersionId does not match bundle.publishedVersionId"
      );
    }
    return parsedBundle;
  }

  private evictOldestBundles(): string[] {
    const evictedBundleIds: string[] = [];

    while (this.bundles.size > this.config.RUNTIME_BUNDLE_CACHE_MAX_ENTRIES) {
      const oldestBundleId = this.bundles.keys().next().value;
      if (!oldestBundleId) {
        break;
      }
      this.bundles.delete(oldestBundleId);
      evictedBundleIds.push(oldestBundleId);
    }

    return evictedBundleIds;
  }

  private parseBundleDocument(document: string): AssistantRuntimeBundle {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      throw new BadRequestException("bundleDocument must be valid JSON");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new BadRequestException("bundleDocument must decode to an object");
    }

    const metadata = (parsed as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") {
      throw new BadRequestException("bundleDocument.metadata must be an object");
    }

    return parsed as AssistantRuntimeBundle;
  }

  private assertNonEmpty(value: unknown, field: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
  }
}
