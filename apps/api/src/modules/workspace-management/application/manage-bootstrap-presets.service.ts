import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { BOOTSTRAP_PRESET_DEFAULTS } from "../../../../prisma/bootstrap-preset-data";
import {
  BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY,
  type BootstrapDocumentPreset,
  type BootstrapDocumentPresetRepository
} from "../domain/bootstrap-document-preset.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";

const VALID_PRESET_IDS = new Set(Object.keys(BOOTSTRAP_PRESET_DEFAULTS));

const DEFAULT_TEMPLATES: Record<string, string> = { ...BOOTSTRAP_PRESET_DEFAULTS };

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
