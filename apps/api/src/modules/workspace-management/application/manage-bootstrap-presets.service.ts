import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY,
  type BootstrapDocumentPreset,
  type BootstrapDocumentPresetRepository
} from "../domain/bootstrap-document-preset.repository";

const VALID_PRESET_IDS = new Set(["soul", "user", "identity", "agents"]);

@Injectable()
export class ManageBootstrapPresetsService {
  constructor(
    @Inject(BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY)
    private readonly presetRepository: BootstrapDocumentPresetRepository
  ) {}

  async getAll(): Promise<BootstrapDocumentPreset[]> {
    return this.presetRepository.findAll();
  }

  async update(id: string, template: string): Promise<BootstrapDocumentPreset> {
    if (!VALID_PRESET_IDS.has(id)) {
      throw new NotFoundException(`Bootstrap preset "${id}" does not exist.`);
    }

    const existing = await this.presetRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Bootstrap preset "${id}" not found in database.`);
    }

    return this.presetRepository.update(id, template);
  }
}
