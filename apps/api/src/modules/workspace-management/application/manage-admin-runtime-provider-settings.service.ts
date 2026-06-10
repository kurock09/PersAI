import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { MaterializationRolloutService } from "./materialization-rollout.service";
import {
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
  assertRequiredProviderKeysAvailable,
  parseUpdateLiveVoiceReadinessInput,
  parseUpdatePlatformRuntimeProviderSettingsInput,
  type PlatformLiveVoiceReadinessSettings,
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
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly materializationRolloutService: MaterializationRolloutService
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

  parseLiveVoiceInput(body: unknown): PlatformLiveVoiceReadinessSettings {
    try {
      return parseUpdateLiveVoiceReadinessInput(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid live voice readiness request.";
      throw new BadRequestException(message);
    }
  }

  async getLiveVoiceReadiness(userId: string): Promise<PlatformLiveVoiceReadinessSettings> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    return settings.liveVoice;
  }

  /**
   * ADR-114 — focused update of only the `live_voice_settings` column. Unlike
   * {@link updateSettings} this does not replace the whole provider profile and
   * does not trigger a materialization rollout: the live voice readiness flags
   * are read fresh by the session service on every start, so no config
   * generation bump is required.
   */
  async updateLiveVoiceReadiness(
    userId: string,
    liveVoice: PlatformLiveVoiceReadinessSettings,
    stepUpToken: string | null
  ): Promise<PlatformLiveVoiceReadinessSettings> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.runtime_provider_settings.update",
      stepUpToken
    );

    const existing = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { id: true }
    });
    if (existing === null) {
      throw new BadRequestException(
        "Runtime provider settings must be configured before live voice can be enabled."
      );
    }

    await this.prisma.platformRuntimeProviderSettings.update({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      data: {
        liveVoice: liveVoice as Prisma.InputJsonValue,
        updatedByUserId: userId
      }
    });

    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.runtime_provider_settings_updated",
      summary: "Live voice readiness settings updated.",
      details: {
        liveVoice: settings.liveVoice
      }
    });

    return settings.liveVoice;
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
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
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
        routingFastModelKey: input.routingFastModelKey,
        routerPolicy: {
          ...input.routerPolicy,
          skillRoutingPolicy: input.skillRoutingPolicy
        } as Prisma.InputJsonValue,
        availableModelsByProvider: input.availableModelsByProvider as Prisma.InputJsonValue,
        availableModelCatalogByProvider:
          input.availableModelCatalogByProvider as Prisma.InputJsonValue,
        vcoinExchangeRate: input.vcoinExchangeRate,
        heygenPersonaWorkspaceLimit: input.heygenPersonaWorkspaceLimit,
        heygenPersonaCreationVcoin: input.heygenPersonaCreationVcoin,
        heygenVoiceCloneWorkspaceLimit: input.heygenVoiceCloneWorkspaceLimit,
        heygenVoiceCloneCreationVcoin: input.heygenVoiceCloneCreationVcoin,
        liveVoice: input.liveVoice as Prisma.InputJsonValue,
        updatedByUserId: userId
      },
      update: {
        primaryProvider: input.primary.provider,
        primaryModel: input.primary.model,
        fallbackProvider: input.fallback?.provider ?? null,
        fallbackModel: input.fallback?.model ?? null,
        routingFastModelKey: input.routingFastModelKey,
        routerPolicy: {
          ...input.routerPolicy,
          skillRoutingPolicy: input.skillRoutingPolicy
        } as Prisma.InputJsonValue,
        availableModelsByProvider: input.availableModelsByProvider as Prisma.InputJsonValue,
        availableModelCatalogByProvider:
          input.availableModelCatalogByProvider as Prisma.InputJsonValue,
        vcoinExchangeRate: input.vcoinExchangeRate,
        heygenPersonaWorkspaceLimit: input.heygenPersonaWorkspaceLimit,
        heygenPersonaCreationVcoin: input.heygenPersonaCreationVcoin,
        heygenVoiceCloneWorkspaceLimit: input.heygenVoiceCloneWorkspaceLimit,
        heygenVoiceCloneCreationVcoin: input.heygenVoiceCloneCreationVcoin,
        liveVoice: input.liveVoice as Prisma.InputJsonValue,
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
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "runtime_provider_settings_change",
      triggerSource: "provider_settings",
      scopeType: "provider_profile",
      criticality: "hard",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.runtime_provider_settings.update",
        primaryProvider: settings.primary?.provider ?? null,
        primaryModel: settings.primary?.model ?? null,
        fallbackProvider: settings.fallback?.provider ?? null,
        fallbackModel: settings.fallback?.model ?? null
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a runtime provider settings materialization rollout."
    });

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
        routingFastModelKey: settings.routingFastModelKey,
        routerPolicy: settings.routerPolicy,
        skillRoutingPolicy: settings.skillRoutingPolicy,
        liveVoice: settings.liveVoice,
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
