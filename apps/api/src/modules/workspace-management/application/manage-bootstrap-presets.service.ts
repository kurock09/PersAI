import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { VISIBLE_PROMPT_TEMPLATE_DEFAULTS } from "../../../../prisma/bootstrap-preset-data";
import {
  PROMPT_TEMPLATE_REPOSITORY,
  type PromptTemplate,
  type PromptTemplateRepository
} from "../domain/bootstrap-document-preset.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";

const VALID_PRESET_IDS = new Set(Object.keys(VISIBLE_PROMPT_TEMPLATE_DEFAULTS));
const DEFAULT_TEMPLATES: Record<string, string> = { ...VISIBLE_PROMPT_TEMPLATE_DEFAULTS };

@Injectable()
export class ManagePromptTemplatesService {
  private readonly logger = new Logger(ManagePromptTemplatesService.name);

  constructor(
    @Inject(PROMPT_TEMPLATE_REPOSITORY)
    private readonly promptTemplateRepository: PromptTemplateRepository,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService
  ) {}

  async getAll(userId: string): Promise<PromptTemplate[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const presets = await this.promptTemplateRepository.findAll();
    const existingById = new Set(presets.map((preset) => preset.id));
    const missingDefaults = Object.entries(DEFAULT_TEMPLATES).filter(
      ([id]) => !existingById.has(id)
    );

    if (missingDefaults.length === 0) {
      return presets.filter((preset) => VALID_PRESET_IDS.has(preset.id));
    }

    this.logger.log(
      `Prompt templates missing defaults (${missingDefaults.map(([id]) => id).join(", ")}). Seeding missing rows.`
    );
    for (const [id, template] of missingDefaults) {
      await this.promptTemplateRepository.upsert(id, template);
    }
    return (await this.promptTemplateRepository.findAll()).filter((preset) =>
      VALID_PRESET_IDS.has(preset.id)
    );
  }

  async update(userId: string, id: string, template: string): Promise<PromptTemplate> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    if (!VALID_PRESET_IDS.has(id)) {
      throw new NotFoundException(`Prompt template "${id}" does not exist.`);
    }

    const result = await this.promptTemplateRepository.upsert(id, template);
    await this.bumpConfigGenerationService.execute();
    return result;
  }
}
