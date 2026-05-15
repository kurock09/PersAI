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
  DOCUMENT_PROVIDER_CONFIG_KEYS,
  DEFAULT_TTS_PRIMARY_PROVIDER,
  TTS_PRIMARY_PROVIDER_STORAGE_KEY,
  buildAdminToolCredentialsState,
  parseUpdateToolCredentialsInput,
  providerStorageKey,
  TOOL_PROVIDER_OPTIONS,
  type AdminToolCredentialsState,
  type ToolCredentialKey,
  type UpdateToolCredentialsInput
} from "./tool-credential-settings";

@Injectable()
export class ManageAdminToolCredentialsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly materializationRolloutService: MaterializationRolloutService
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
    const documentProviderConfigMetadata = await this.loadDocumentProviderConfigMetadata();
    const ttsPrimaryProviderId = await this.loadTtsPrimaryProviderId();
    return buildAdminToolCredentialsState({
      keyMetadata,
      providerSelections,
      documentProviderConfigMetadata,
      ttsPrimaryProviderId
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
    const pdfmonkeyTemplateId = input.documentProviderTemplateIds.pdfmonkey;
    if (typeof pdfmonkeyTemplateId === "string" && pdfmonkeyTemplateId.trim().length > 0) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        DOCUMENT_PROVIDER_CONFIG_KEYS.pdfmonkeyTemplateId,
        pdfmonkeyTemplateId,
        userId
      );
    }
    if (input.ttsPrimaryProviderId !== undefined) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        TTS_PRIMARY_PROVIDER_STORAGE_KEY,
        input.ttsPrimaryProviderId,
        userId
      );
    }

    const keyMetadata = await this.loadToolKeyMetadata();
    const providerSelections = await this.loadProviderSelections();
    const documentProviderConfigMetadata = await this.loadDocumentProviderConfigMetadata();
    const ttsPrimaryProviderId = await this.loadTtsPrimaryProviderId();
    const state = buildAdminToolCredentialsState({
      keyMetadata,
      providerSelections,
      documentProviderConfigMetadata,
      ttsPrimaryProviderId
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
        updatedDocumentProviderTemplateIds: Object.entries(input.documentProviderTemplateIds)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([providerId]) => providerId),
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
        updatedDocumentProviderTemplateIds: Object.entries(input.documentProviderTemplateIds)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([providerId]) => providerId),
        ttsPrimaryProviderId: input.ttsPrimaryProviderId ?? null,
        configGeneration
      }
    });

    return state;
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

  private async loadDocumentProviderConfigMetadata(): Promise<
    Record<"pdfmonkey", PlatformRuntimeProviderKeyMetadata>
  > {
    const key = DOCUMENT_PROVIDER_CONFIG_KEYS.pdfmonkeyTemplateId;
    const metadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
      key
    ]);
    return {
      pdfmonkey: metadata[key] ?? { configured: false, lastFour: null, updatedAt: null }
    };
  }

  private async loadToolKeyMetadata(): Promise<
    Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata>
  > {
    const result: Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata> = {
      tool_web_search: { configured: false, lastFour: null, updatedAt: null },
      tool_web_fetch: { configured: false, lastFour: null, updatedAt: null },
      tool_image_generate: { configured: false, lastFour: null, updatedAt: null },
      tool_document_pdfmonkey: { configured: false, lastFour: null, updatedAt: null },
      tool_document_gamma: { configured: false, lastFour: null, updatedAt: null },
      tool_browser: { configured: false, lastFour: null, updatedAt: null },
      tool_tts_elevenlabs: { configured: false, lastFour: null, updatedAt: null },
      tool_tts_yandex: { configured: false, lastFour: null, updatedAt: null },
      tool_tts_openai: { configured: false, lastFour: null, updatedAt: null },
      tool_memory_search: { configured: false, lastFour: null, updatedAt: null },
      notification_email_postmark: { configured: false, lastFour: null, updatedAt: null },
      notification_email_postmark_webhook: { configured: false, lastFour: null, updatedAt: null }
    };
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
