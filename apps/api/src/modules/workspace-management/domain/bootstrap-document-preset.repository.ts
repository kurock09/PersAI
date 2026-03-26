export const BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY = Symbol("BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY");

export interface BootstrapDocumentPreset {
  id: string;
  template: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface BootstrapDocumentPresetRepository {
  findAll(): Promise<BootstrapDocumentPreset[]>;
  findById(id: string): Promise<BootstrapDocumentPreset | null>;
  update(id: string, template: string): Promise<BootstrapDocumentPreset>;
  upsert(id: string, template: string): Promise<BootstrapDocumentPreset>;
}
