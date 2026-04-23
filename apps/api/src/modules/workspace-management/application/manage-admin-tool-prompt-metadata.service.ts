import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { HIDDEN_PROMPT_TEMPLATE_DEFAULTS } from "../../../../prisma/bootstrap-preset-data";
import {
  PROMPT_TEMPLATE_REPOSITORY,
  type PromptTemplateRepository
} from "../domain/bootstrap-document-preset.repository";
import {
  TOOL_CATALOG_REPOSITORY,
  type ToolCatalogRepository
} from "../domain/tool-catalog.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  isPromptConstructorModelToolCode,
  PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER,
  getSyntheticPromptConstructorToolStorageIds,
  isSyntheticPromptConstructorToolCode,
  listSyntheticPromptConstructorTools,
  resolveSyntheticPromptConstructorTool,
  sortPromptConstructorTools
} from "./prompt-constructor-tool-metadata";

export type AdminToolPromptMetadataState = {
  toolCode: string;
  displayName: string;
  description: string | null;
  modelDescription: string | null;
  modelUsageGuidance: string | null;
  codeDefaultModelDescription?: string | null;
  codeDefaultModelUsageGuidance?: string | null;
  modelDescriptionOverridden?: boolean;
  modelUsageGuidanceOverridden?: boolean;
  toolClass: "cost_driving" | "utility";
  capabilityGroup: "knowledge" | "automation" | "communication" | "workspace_ops";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  catalogStatus: "active" | "inactive";
};

@Injectable()
export class ManageAdminToolPromptMetadataService {
  constructor(
    @Inject(PROMPT_TEMPLATE_REPOSITORY)
    private readonly promptTemplateRepository: PromptTemplateRepository,
    @Inject(TOOL_CATALOG_REPOSITORY)
    private readonly toolCatalogRepository: ToolCatalogRepository,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService
  ) {}

  async list(userId: string): Promise<AdminToolPromptMetadataState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const [rows, catalogTools] = await Promise.all([
      this.ensureHiddenPromptTemplateDefaults(),
      this.toolCatalogRepository.listToolsForPromptMetadata()
    ]);
    const catalogByCode = new Map(catalogTools.map((tool) => [tool.toolCode, tool] as const));
    const orderedCatalogTools = PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.flatMap((toolCode) => {
      const tool = catalogByCode.get(toolCode);
      return tool ? [tool] : [];
    });
    return sortPromptConstructorTools([
      ...listSyntheticPromptConstructorTools(rows),
      ...orderedCatalogTools
    ]);
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
    await this.ensureHiddenPromptTemplateDefaults();
    if (isSyntheticPromptConstructorToolCode(toolCode)) {
      const ids = getSyntheticPromptConstructorToolStorageIds(toolCode);
      if (patch.modelDescription !== undefined) {
        await this.promptTemplateRepository.upsert(ids.descriptionId, patch.modelDescription ?? "");
      }
      if (patch.modelUsageGuidance !== undefined) {
        await this.promptTemplateRepository.upsert(
          ids.usageGuidanceId,
          patch.modelUsageGuidance ?? ""
        );
      }
      await this.bumpConfigGenerationService.execute();
      const rows = await this.promptTemplateRepository.findAll();
      return resolveSyntheticPromptConstructorTool(toolCode, rows);
    }
    if (!isPromptConstructorModelToolCode(toolCode)) {
      throw new NotFoundException(`Tool "${toolCode}" does not exist.`);
    }
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

  private async ensureHiddenPromptTemplateDefaults() {
    const rows = await this.promptTemplateRepository.findAll();
    const existingById = new Set(rows.map((row) => row.id));
    const missingDefaults = Object.entries(HIDDEN_PROMPT_TEMPLATE_DEFAULTS).filter(
      ([id]) => !existingById.has(id)
    );
    if (missingDefaults.length === 0) {
      return rows;
    }
    for (const [id, template] of missingDefaults) {
      await this.promptTemplateRepository.upsert(id, template);
    }
    return this.promptTemplateRepository.findAll();
  }
}
