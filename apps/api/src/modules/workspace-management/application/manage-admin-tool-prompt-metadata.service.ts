import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  TOOL_CATALOG_REPOSITORY,
  type ToolCatalogRepository
} from "../domain/tool-catalog.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";

export type AdminToolPromptMetadataState = {
  toolCode: string;
  displayName: string;
  description: string | null;
  modelDescription: string | null;
  modelUsageGuidance: string | null;
  toolClass: "cost_driving" | "utility";
  capabilityGroup: "knowledge" | "automation" | "communication" | "workspace_ops";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  catalogStatus: "active" | "inactive";
};

@Injectable()
export class ManageAdminToolPromptMetadataService {
  constructor(
    @Inject(TOOL_CATALOG_REPOSITORY)
    private readonly toolCatalogRepository: ToolCatalogRepository,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService
  ) {}

  async list(userId: string): Promise<AdminToolPromptMetadataState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.toolCatalogRepository.listToolsForPromptMetadata();
  }

  async update(
    userId: string,
    toolCode: string,
    patch: {
      modelDescription?: string | null;
      modelUsageGuidance?: string | null;
    }
  ): Promise<AdminToolPromptMetadataState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    try {
      const updated = await this.toolCatalogRepository.updateToolPromptMetadata(toolCode, patch);
      await this.bumpConfigGenerationService.execute();
      return updated;
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new NotFoundException(`Tool "${toolCode}" does not exist.`);
      }
      throw error;
    }
  }
}
