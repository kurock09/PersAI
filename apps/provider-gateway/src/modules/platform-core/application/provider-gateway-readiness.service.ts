import { Inject, Injectable, Optional } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import { ProviderWarmupService } from "../../providers/provider-warmup.service";
import type { ProviderReadinessSnapshot } from "../../providers/provider-client.types";
import { isProviderGatewayWarmupReady } from "../../providers/provider-warmup-boot-recovery";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

@Injectable()
export class ProviderGatewayReadinessService {
  constructor(
    private readonly providerWarmupService: ProviderWarmupService,
    @Optional() @Inject(PROVIDER_GATEWAY_CONFIG) private readonly config?: ProviderGatewayConfig
  ) {}

  getSnapshot(): ProviderReadinessSnapshot {
    const warmup = this.providerWarmupService.getSnapshot();
    const providerCacheReady = warmup.providers.every((provider) => {
      return provider.state === "ready" || provider.state === "unconfigured";
    });

    return {
      checkedAt: new Date().toISOString(),
      ready: isProviderGatewayWarmupReady(warmup),
      providerCacheReady,
      capabilities: {
        textUsageV2Producer: this.config?.PROVIDER_GATEWAY_TEXT_USAGE_V2_PRODUCER_ENABLED === true
      },
      providers: warmup.providers
    };
  }
}
