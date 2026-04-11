import { Injectable } from "@nestjs/common";
import { ProviderWarmupService } from "../../providers/provider-warmup.service";
import type { ProviderReadinessSnapshot } from "../../providers/provider-client.types";

@Injectable()
export class ProviderGatewayReadinessService {
  constructor(private readonly providerWarmupService: ProviderWarmupService) {}

  getSnapshot(): ProviderReadinessSnapshot {
    const warmup = this.providerWarmupService.getSnapshot();
    const providerCacheReady = warmup.providers.every((provider) => {
      return provider.state === "ready" || provider.state === "unconfigured";
    });

    return {
      checkedAt: new Date().toISOString(),
      ready: warmup.runs > 0 && providerCacheReady,
      providerCacheReady,
      providers: warmup.providers
    };
  }
}
