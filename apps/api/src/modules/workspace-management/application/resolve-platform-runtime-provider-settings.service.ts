import { Injectable } from "@nestjs/common";
import type { ManagedRuntimeProvider } from "./runtime-provider-profile";
import {
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
  buildPlatformRuntimeProviderSettingsState,
  type PlatformRuntimeProviderSettingsRecord,
  type PlatformRuntimeProviderSettingsState
} from "./platform-runtime-provider-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ResolvePlatformRuntimeProviderSettingsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async execute(): Promise<PlatformRuntimeProviderSettingsState> {
    const [settingsRow, providerKeys] = await Promise.all([
      this.loadPersistedSettingsRecord(),
      this.platformRuntimeProviderSecretStoreService.loadKeyMetadata()
    ]);
    return buildPlatformRuntimeProviderSettingsState({
      settings: settingsRow,
      providerKeys
    });
  }

  private async loadPersistedSettingsRecord(): Promise<PlatformRuntimeProviderSettingsRecord | null> {
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: {
        primaryProvider: true,
        primaryModel: true,
        fallbackProvider: true,
        fallbackModel: true,
        availableModelsByProvider: true
      }
    });
    if (row === null) {
      return null;
    }
    return {
      primaryProvider: this.normalizeProvider(row.primaryProvider, "openai") ?? "openai",
      primaryModel: row.primaryModel,
      fallbackProvider:
        row.fallbackProvider === null ? null : this.normalizeProvider(row.fallbackProvider, null),
      fallbackModel: row.fallbackModel,
      availableModelsByProvider: row.availableModelsByProvider
    };
  }

  private normalizeProvider(
    value: string,
    fallback: ManagedRuntimeProvider | null
  ): ManagedRuntimeProvider | null {
    if (value === "openai" || value === "anthropic") {
      return value;
    }
    return fallback;
  }
}
