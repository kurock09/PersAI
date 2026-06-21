import { BadRequestException, Injectable } from "@nestjs/common";
import type { PersaiRuntimeTtsProviderId } from "@persai/runtime-contract";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { MaterializationRolloutService } from "./materialization-rollout.service";
import type { PlatformRuntimeProviderKeyMetadata } from "./platform-runtime-provider-settings";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  DEFAULT_TTS_PRIMARY_PROVIDER,
  DEFAULT_MEDIA_RESERVE_BASE_URL,
  MEDIA_RESERVE_CONFIG_KEYS,
  TTS_PRIMARY_PROVIDER_STORAGE_KEY,
  buildAdminToolCredentialsState,
  parseUpdateToolCredentialsInput,
  providerStorageKey,
  TOOL_PROVIDER_OPTIONS,
  type AdminToolCredentialsState,
  type ToolCredentialKey,
  type UpdateToolCredentialsInput
} from "./tool-credential-settings";
import {
  HEYGEN_VOICE_CACHE_KEY,
  type AdminHeygenVoiceCurationCatalog,
  type AdminHeygenVoiceCurationPatch,
  HeyGenVoiceCatalogService
} from "./heygen/heygen-voice-catalog.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ManageAdminToolCredentialsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly materializationRolloutService: MaterializationRolloutService,
    private readonly heyGenVoiceCatalogService: HeyGenVoiceCatalogService,
    private readonly workspaceManagementPrismaService: WorkspaceManagementPrismaService
  ) {}

  parseUpdateInput(body: unknown): UpdateToolCredentialsInput {
    try {
      return parseUpdateToolCredentialsInput(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid tool credentials request.";
      throw new BadRequestException(message);
    }
  }

  async getCredentials(userId: string): Promise<AdminToolCredentialsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const keyMetadata = await this.loadToolKeyMetadata();
    const providerSelections = await this.loadProviderSelections();
    const mediaReserve = await this.loadMediaReserveState();
    const ttsPrimaryProviderId = await this.loadTtsPrimaryProviderId();
    const heygenVoiceCatalogMeta = await this.loadHeygenVoiceCatalogMeta();
    return buildAdminToolCredentialsState({
      keyMetadata,
      providerSelections,
      mediaReserve,
      ttsPrimaryProviderId,
      heygenVoiceCatalogRefreshedAt: heygenVoiceCatalogMeta.refreshedAt,
      heygenVoiceCatalogVoicesCount: heygenVoiceCatalogMeta.voicesCount
    });
  }

  async updateCredentials(
    userId: string,
    input: UpdateToolCredentialsInput,
    stepUpToken: string | null
  ): Promise<AdminToolCredentialsState> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.tool_credentials.update",
      stepUpToken
    );

    this.platformRuntimeProviderSecretStoreService.assertEncryptionConfigured();

    for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
      const rawKey = input.keys[credentialKey];
      if (typeof rawKey === "string" && rawKey.trim().length > 0) {
        await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
          credentialKey,
          rawKey,
          userId
        );
      }
      const providerId = input.providers[credentialKey];
      if (typeof providerId === "string" && providerId.trim().length > 0) {
        await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
          providerStorageKey(credentialKey),
          providerId,
          userId
        );
      }
    }
    if (input.ttsPrimaryProviderId !== undefined) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        TTS_PRIMARY_PROVIDER_STORAGE_KEY,
        input.ttsPrimaryProviderId,
        userId
      );
    }
    if (input.mediaReserve?.enabled !== undefined) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        MEDIA_RESERVE_CONFIG_KEYS.enabled,
        input.mediaReserve.enabled ? "true" : "false",
        userId
      );
    }
    if (
      typeof input.mediaReserve?.apiKey === "string" &&
      input.mediaReserve.apiKey.trim().length > 0
    ) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        MEDIA_RESERVE_CONFIG_KEYS.apiKey,
        input.mediaReserve.apiKey,
        userId
      );
    }
    if (
      typeof input.mediaReserve?.baseUrl === "string" &&
      input.mediaReserve.baseUrl.trim().length > 0
    ) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        MEDIA_RESERVE_CONFIG_KEYS.baseUrl,
        input.mediaReserve.baseUrl,
        userId
      );
    }

    const keyMetadata = await this.loadToolKeyMetadata();
    const providerSelections = await this.loadProviderSelections();
    const mediaReserve = await this.loadMediaReserveState();
    const ttsPrimaryProviderId = await this.loadTtsPrimaryProviderId();
    const heygenVoiceCatalogMeta = await this.loadHeygenVoiceCatalogMeta();
    const state = buildAdminToolCredentialsState({
      keyMetadata,
      providerSelections,
      mediaReserve,
      ttsPrimaryProviderId,
      heygenVoiceCatalogRefreshedAt: heygenVoiceCatalogMeta.refreshedAt,
      heygenVoiceCatalogVoicesCount: heygenVoiceCatalogMeta.voicesCount
    });

    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "tool_policy_change",
      triggerSource: "tool_policy",
      scopeType: "affected_policy",
      criticality: "hard",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.tool_credentials.update",
        updatedCredentials: Object.entries(input.keys)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([key]) => key),
        updatedProviders: Object.entries(input.providers)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([key, value]) => ({ credentialKey: key, providerId: value })),
        updatedMediaReserve: {
          enabled:
            typeof input.mediaReserve?.enabled === "boolean" ? input.mediaReserve.enabled : null,
          apiKeyUpdated:
            typeof input.mediaReserve?.apiKey === "string" && input.mediaReserve.apiKey.length > 0,
          baseUrlUpdated:
            typeof input.mediaReserve?.baseUrl === "string" && input.mediaReserve.baseUrl.length > 0
        },
        ttsPrimaryProviderId: input.ttsPrimaryProviderId ?? null
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a tool credential materialization rollout."
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.tool_credentials_updated",
      summary: "Tool credentials updated.",
      details: {
        updatedCredentials: Object.entries(input.keys)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([key]) => key),
        updatedMediaReserve: {
          enabled:
            typeof input.mediaReserve?.enabled === "boolean" ? input.mediaReserve.enabled : null,
          apiKeyUpdated:
            typeof input.mediaReserve?.apiKey === "string" && input.mediaReserve.apiKey.length > 0,
          baseUrlUpdated:
            typeof input.mediaReserve?.baseUrl === "string" && input.mediaReserve.baseUrl.length > 0
        },
        ttsPrimaryProviderId: input.ttsPrimaryProviderId ?? null,
        configGeneration
      }
    });

    return state;
  }

  async refreshHeygenVoiceCatalog(
    userId: string,
    stepUpToken: string | null
  ): Promise<AdminToolCredentialsState> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.tool_credentials.update",
      stepUpToken
    );
    await this.heyGenVoiceCatalogService.forceRefreshVoiceCatalog();
    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.heygen_voice_catalog_refreshed",
      summary: "HeyGen voice catalog refreshed."
    });
    return this.getCredentials(userId);
  }

  async listHeygenVoiceCuration(userId: string): Promise<AdminHeygenVoiceCurationCatalog> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.heyGenVoiceCatalogService.listAdminVoiceCurationCatalog();
  }

  async updateHeygenVoiceCuration(
    userId: string,
    body: unknown,
    stepUpToken: string | null
  ): Promise<AdminHeygenVoiceCurationCatalog> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.tool_credentials.update",
      stepUpToken
    );
    const patches = this.parseHeygenVoiceCurationPatches(body);
    const result = await this.heyGenVoiceCatalogService.updateAdminVoiceCuration({
      actorUserId: userId,
      patches
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.heygen_voice_curation_updated",
      summary: "HeyGen voice curation updated.",
      details: { updatedCount: patches.length }
    });
    return result;
  }

  async resolveAdminHeygenVoicePreviewUrl(
    userId: string,
    providerVoiceId: string
  ): Promise<string | null> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const voices = await this.heyGenVoiceCatalogService.getFullVoiceCatalogEntries();
    const voice = voices.find((entry) => entry.providerVoiceId === providerVoiceId);
    const previewUrl = voice?.previewAudioUrl;
    return typeof previewUrl === "string" && previewUrl.trim().length > 0
      ? previewUrl.trim()
      : null;
  }

  private parseHeygenVoiceCurationPatches(body: unknown): AdminHeygenVoiceCurationPatch[] {
    const record =
      body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const rawPatches = record.patches;
    if (!Array.isArray(rawPatches)) {
      throw new BadRequestException("Invalid HeyGen voice curation request.");
    }
    return rawPatches.map((rawPatch) => {
      const patch =
        rawPatch !== null && typeof rawPatch === "object"
          ? (rawPatch as Record<string, unknown>)
          : {};
      const providerVoiceId =
        typeof patch.providerVoiceId === "string" ? patch.providerVoiceId.trim() : "";
      const languageBucket =
        patch.languageBucket === "ru" ||
        patch.languageBucket === "en" ||
        patch.languageBucket === "other" ||
        patch.languageBucket === "multi"
          ? patch.languageBucket
          : null;
      const gender =
        patch.gender === "female" ||
        patch.gender === "male" ||
        patch.gender === "neutral" ||
        patch.gender === "unknown"
          ? patch.gender
          : null;
      if (providerVoiceId.length === 0 || languageBucket === null || gender === null) {
        throw new BadRequestException("Invalid HeyGen voice curation patch.");
      }
      const modelShortlist = patch.modelShortlist === true;
      return {
        providerVoiceId,
        approved: modelShortlist || patch.approved === true,
        enabled: modelShortlist || patch.enabled !== false,
        modelShortlist,
        languageBucket,
        gender
      };
    });
  }

  private async loadProviderSelections(): Promise<Partial<Record<ToolCredentialKey, string>>> {
    const result: Partial<Record<ToolCredentialKey, string>> = {};
    const keysWithProviders = ALL_TOOL_CREDENTIAL_KEYS.filter(
      (k) => TOOL_PROVIDER_OPTIONS[k] !== undefined
    );
    for (const credentialKey of keysWithProviders) {
      const stored =
        await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
          providerStorageKey(credentialKey)
        );
      if (stored) {
        result[credentialKey] = stored;
      }
    }
    return result;
  }

  private async loadTtsPrimaryProviderId(): Promise<PersaiRuntimeTtsProviderId> {
    const stored =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        TTS_PRIMARY_PROVIDER_STORAGE_KEY
      );
    if (stored === null || stored.trim().length === 0) {
      return DEFAULT_TTS_PRIMARY_PROVIDER;
    }
    return stored as PersaiRuntimeTtsProviderId;
  }

  private async loadHeygenVoiceCatalogMeta(): Promise<{
    refreshedAt: string | null;
    voicesCount: number;
  }> {
    const row =
      await this.workspaceManagementPrismaService.platformHeygenVoiceCatalogCache.findUnique({
        where: { cacheKey: HEYGEN_VOICE_CACHE_KEY },
        select: { fetchedAt: true, voicesJson: true }
      });
    return {
      refreshedAt: row?.fetchedAt.toISOString() ?? null,
      voicesCount: Array.isArray(row?.voicesJson) ? row.voicesJson.length : 0
    };
  }

  private async loadMediaReserveState(): Promise<{
    enabled: boolean;
    apiKeyMetadata: PlatformRuntimeProviderKeyMetadata;
    baseUrlMetadata: PlatformRuntimeProviderKeyMetadata;
    baseUrlValue: string;
  }> {
    const metadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
      MEDIA_RESERVE_CONFIG_KEYS.apiKey,
      MEDIA_RESERVE_CONFIG_KEYS.baseUrl
    ]);
    const [enabledRaw, baseUrlRaw] = await Promise.all([
      this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        MEDIA_RESERVE_CONFIG_KEYS.enabled
      ),
      this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        MEDIA_RESERVE_CONFIG_KEYS.baseUrl
      )
    ]);
    return {
      enabled: enabledRaw === "true",
      apiKeyMetadata: metadata[MEDIA_RESERVE_CONFIG_KEYS.apiKey] ?? {
        configured: false,
        lastFour: null,
        updatedAt: null
      },
      baseUrlMetadata: metadata[MEDIA_RESERVE_CONFIG_KEYS.baseUrl] ?? {
        configured: false,
        lastFour: null,
        updatedAt: null
      },
      baseUrlValue:
        typeof baseUrlRaw === "string" && baseUrlRaw.trim().length > 0
          ? baseUrlRaw.trim()
          : DEFAULT_MEDIA_RESERVE_BASE_URL
    };
  }

  private async loadToolKeyMetadata(): Promise<
    Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata>
  > {
    const result: Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata> =
      Object.fromEntries(
        ALL_TOOL_CREDENTIAL_KEYS.map((key) => [
          key,
          { configured: false, lastFour: null, updatedAt: null }
        ])
      ) as Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata>;
    const allMetadata =
      await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys(
        ALL_TOOL_CREDENTIAL_KEYS
      );
    for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
      const metadata = allMetadata[credentialKey];
      if (metadata !== undefined) {
        result[credentialKey] = metadata;
      }
    }
    return result;
  }
}
