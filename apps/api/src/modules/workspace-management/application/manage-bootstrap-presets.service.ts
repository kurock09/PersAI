import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY,
  type BootstrapDocumentPreset,
  type BootstrapDocumentPresetRepository
} from "../domain/bootstrap-document-preset.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";

const VALID_PRESET_IDS = new Set(["soul", "user", "identity", "agents"]);

const DEFAULT_TEMPLATES: Record<string, string> = {
  soul: `# SOUL.md

You are **{{assistant_name}}**.

{{traits_block}}
{{instructions_block}}`,

  user: `# USER.md — About Your Human

{{user_name_line}}
{{user_birthday_line}}
{{user_gender_line}}
- **Locale**: {{user_locale}}
- **Timezone**: {{user_timezone}}

Use this information to personalize your communication.
Greet on birthdays. Respect timezone for scheduling.`,

  identity: `# IDENTITY.md

- **Name**: {{assistant_name}}
{{assistant_avatar_emoji_line}}
{{assistant_avatar_url_line}}`,

  agents: `# AGENTS.md — Governance & Capabilities

{{memory_policy_block}}
{{tasks_policy_block}}`
};

@Injectable()
export class ManageBootstrapPresetsService {
  private readonly logger = new Logger(ManageBootstrapPresetsService.name);

  constructor(
    @Inject(BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY)
    private readonly presetRepository: BootstrapDocumentPresetRepository,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService
  ) {}

  async getAll(userId: string): Promise<BootstrapDocumentPreset[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const presets = await this.presetRepository.findAll();
    if (presets.length > 0) return presets;

    this.logger.log("No bootstrap presets found — seeding defaults");
    const seeded: BootstrapDocumentPreset[] = [];
    for (const [id, template] of Object.entries(DEFAULT_TEMPLATES)) {
      seeded.push(await this.presetRepository.upsert(id, template));
    }
    return seeded;
  }

  async update(userId: string, id: string, template: string): Promise<BootstrapDocumentPreset> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    if (!VALID_PRESET_IDS.has(id)) {
      throw new NotFoundException(`Bootstrap preset "${id}" does not exist.`);
    }

    const existing = await this.presetRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Bootstrap preset "${id}" not found in database.`);
    }

    const result = await this.presetRepository.update(id, template);
    await this.bumpConfigGenerationService.execute();
    return result;
  }
}
