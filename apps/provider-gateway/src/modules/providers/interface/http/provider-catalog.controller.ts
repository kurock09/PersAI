import { Controller, Get } from "@nestjs/common";
import { ProviderCatalogService } from "../../provider-catalog.service";
import type { ProviderCatalogSnapshot } from "../../provider-client.types";

@Controller("api/v1/providers")
export class ProviderCatalogController {
  constructor(private readonly providerCatalogService: ProviderCatalogService) {}

  @Get("catalog")
  getCatalog(): ProviderCatalogSnapshot {
    return this.providerCatalogService.getSnapshot();
  }
}
