import { Injectable } from "@nestjs/common";
import type { RuntimeReadinessStatus } from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../../bundles/runtime-bundle-registry.service";
import { ProviderGatewayClientService } from "../../turns/provider-gateway.client.service";

export interface RuntimeReadySnapshot extends RuntimeReadinessStatus {
  darkService: true;
  executionEnabled: true;
  bundleCacheEntries: number;
  bundleCacheMaxEntries: number;
}

@Injectable()
export class RuntimeReadinessService {
  constructor(
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly providerGatewayClientService: ProviderGatewayClientService
  ) {}

  async getSnapshot(): Promise<RuntimeReadySnapshot> {
    const bundleRegistry = this.runtimeBundleRegistryService.getSnapshot();
    const providerGateway = await this.providerGatewayClientService.getReadiness();
    const providerCacheReady = providerGateway.ready && providerGateway.providerCacheReady;

    return {
      checkedAt: new Date().toISOString(),
      ready: bundleRegistry.initialized && providerCacheReady,
      bundleCacheReady: bundleRegistry.initialized,
      providerCacheReady,
      darkService: true,
      executionEnabled: true,
      bundleCacheEntries: bundleRegistry.entries,
      bundleCacheMaxEntries: bundleRegistry.maxEntries
    };
  }
}
