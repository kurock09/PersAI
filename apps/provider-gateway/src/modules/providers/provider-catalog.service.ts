import { Injectable } from "@nestjs/common";
import type { ProviderCatalogSnapshot } from "./provider-client.types";
import { ProviderWarmupService } from "./provider-warmup.service";

@Injectable()
export class ProviderCatalogService {
  constructor(private readonly providerWarmupService: ProviderWarmupService) {}

  getSnapshot(): ProviderCatalogSnapshot {
    const warmup = this.providerWarmupService.getSnapshot();
    return {
      schema: "persai.providerGatewayCatalog.v1",
      generatedAt: new Date().toISOString(),
      providers: warmup.providers.map((provider) => ({
        provider: provider.provider,
        models: [...provider.catalogModels],
        source: provider.catalogSource
      }))
    };
  }
}
