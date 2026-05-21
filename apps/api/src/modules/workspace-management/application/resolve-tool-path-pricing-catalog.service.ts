import { Injectable } from "@nestjs/common";
import { PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID } from "./platform-runtime-provider-settings";
import {
  createDefaultToolPathPricingCatalog,
  normalizeToolPathPricingCatalogRecord,
  type ToolPathPricingCatalogRecord
} from "./tool-path-pricing-catalog";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ResolveToolPathPricingCatalogService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(): Promise<ToolPathPricingCatalogRecord> {
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { toolPathPricingCatalog: true }
    });
    if (row === null) {
      return createDefaultToolPathPricingCatalog();
    }
    try {
      return normalizeToolPathPricingCatalogRecord(row.toolPathPricingCatalog);
    } catch {
      return createDefaultToolPathPricingCatalog();
    }
  }
}
