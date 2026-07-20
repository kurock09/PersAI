import { Inject, Injectable, Optional } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeReadinessStatus } from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../../bundles/runtime-bundle-registry.service";
import { RUNTIME_CONFIG } from "../../../runtime-config";
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
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    @Optional() @Inject(RUNTIME_CONFIG) private readonly config?: RuntimeConfig
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
      capabilities: {
        textUsageV2Consumer: true,
        textUsageV2Producer: this.config?.RUNTIME_TEXT_USAGE_V2_PRODUCER_ENABLED === true
      },
      darkService: true,
      executionEnabled: true,
      bundleCacheEntries: bundleRegistry.entries,
      bundleCacheMaxEntries: bundleRegistry.maxEntries
    };
  }
}
