import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
  assertRequiredProviderKeysAvailable,
  parseUpdatePlatformRuntimeProviderSettingsInput,
  type PlatformRuntimeProviderSettingsState,
  type UpdatePlatformRuntimeProviderSettingsInput
} from "./platform-runtime-provider-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ManageAdminRuntimeProviderSettingsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseUpdateInput(body: unknown): UpdatePlatformRuntimeProviderSettingsInput {
    try {
      return parseUpdatePlatformRuntimeProviderSettingsInput(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid runtime provider settings request.";
      throw new BadRequestException(message);
    }
  }

  async getSettings(userId: string): Promise<PlatformRuntimeProviderSettingsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return await this.resolvePlatformRuntimeProviderSettingsService.execute();
  }

  async updateSettings(
    userId: string,
    input: UpdatePlatformRuntimeProviderSettingsInput,
    stepUpToken: string | null
  ): Promise<{
    settings: PlatformRuntimeProviderSettingsState;
    configGeneration: number;
  }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.runtime_provider_settings.update",
      stepUpToken
    );

    this.platformRuntimeProviderSecretStoreService.assertEncryptionConfigured();
    const existingProviderKeys =
      await this.platformRuntimeProviderSecretStoreService.loadKeyMetadata();
    assertRequiredProviderKeysAvailable({
      primary: input.primary,
      fallback: input.fallback,
      providerKeys: existingProviderKeys,
      incomingProviderKeys: input.providerKeys
    });

    await this.prisma.platformRuntimeProviderSettings.upsert({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      create: {
        id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
        primaryProvider: input.primary.provider,
        primaryModel: input.primary.model,
        fallbackProvider: input.fallback?.provider ?? null,
        fallbackModel: input.fallback?.model ?? null,
        availableModelsByProvider: input.availableModelsByProvider as Prisma.InputJsonValue,
        updatedByUserId: userId
      },
      update: {
        primaryProvider: input.primary.provider,
        primaryModel: input.primary.model,
        fallbackProvider: input.fallback?.provider ?? null,
        fallbackModel: input.fallback?.model ?? null,
        availableModelsByProvider: input.availableModelsByProvider as Prisma.InputJsonValue,
        updatedByUserId: userId
      }
    });

    for (const provider of ["openai", "anthropic"] as const) {
      const nextKey = input.providerKeys[provider];
      if (typeof nextKey === "string" && nextKey.trim().length > 0) {
        await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
          provider,
          nextKey,
          userId
        );
      }
    }

    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const configGeneration = await this.bumpConfigGenerationService.execute();

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.runtime_provider_settings_updated",
      summary: "Global runtime provider settings updated.",
      details: {
        mode: settings.mode,
        primary: settings.primary,
        fallback: settings.fallback,
        updatedProviders: Object.entries(input.providerKeys)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([provider]) => provider),
        configGeneration
      }
    });

    return {
      settings,
      configGeneration
    };
  }
}
