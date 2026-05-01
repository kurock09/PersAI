import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
  createDefaultPlatformRuntimeRouterPolicy,
  createEmptyAvailableModelCatalogByProvider,
  createEmptyAvailableModelsByProvider
} from "./platform-runtime-provider-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import {
  DOCUMENT_PROCESSING_PROVIDER_SECRET_KEYS,
  assertDocumentProcessingProviderKeysAvailable,
  buildAdminDocumentProcessingSettingsState,
  normalizeDocumentProcessingPolicyRecord,
  parseAdminDocumentProcessingSettingsRequest,
  parseDocumentProcessingTestConnectionRequest,
  toDocumentProcessingSecretStorageKey,
  type AdminDocumentProcessingSettingsRequest,
  type AdminDocumentProcessingSettingsState,
  type DocumentProcessingPolicyState,
  type DocumentProcessingProviderKey,
  type DocumentProcessingRemoteProviderKey,
  type DocumentProcessingTestConnectionRequest,
  type DocumentProcessingTestConnectionState
} from "./document-processing-settings";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ManageAdminDocumentProcessingSettingsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseUpdateInput(body: unknown): AdminDocumentProcessingSettingsRequest {
    try {
      return parseAdminDocumentProcessingSettingsRequest(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid document-processing settings request.";
      throw new BadRequestException(message);
    }
  }

  parseTestConnectionInput(body: unknown): DocumentProcessingTestConnectionRequest {
    try {
      return parseDocumentProcessingTestConnectionRequest(body);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Invalid document-processing test connection request.";
      throw new BadRequestException(message);
    }
  }

  async getSettings(userId: string): Promise<AdminDocumentProcessingSettingsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.resolveSettingsState();
  }

  async updateSettings(
    userId: string,
    input: AdminDocumentProcessingSettingsRequest,
    stepUpToken: string | null
  ): Promise<{
    settings: AdminDocumentProcessingSettingsState;
    configGeneration: number;
  }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.document_processing_settings.update",
      stepUpToken
    );

    this.platformRuntimeProviderSecretStoreService.assertEncryptionConfigured();
    const existingKeyMetadata = await this.loadDocumentProcessingKeyMetadata();
    try {
      assertDocumentProcessingProviderKeysAvailable({
        policy: input.policy,
        keyMetadata: existingKeyMetadata,
        incomingProviderKeys: input.providerKeys
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Document-processing provider key is missing.";
      throw new BadRequestException(message);
    }

    for (const providerKey of ["mistral", "llamaparse"] as const) {
      const rawKey = input.providerKeys[providerKey];
      if (typeof rawKey === "string" && rawKey.trim().length > 0) {
        await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
          toDocumentProcessingSecretStorageKey(providerKey),
          rawKey,
          userId
        );
      }
    }

    await this.persistPolicy(input.policy, userId);
    const settings = await this.resolveSettingsState();
    const configGeneration = await this.bumpConfigGenerationService.execute();

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.document_processing_settings_updated",
      summary: "Document-processing provider settings updated.",
      details: {
        policy: settings.policy,
        updatedProviders: Object.entries(input.providerKeys)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([provider]) => provider),
        configGeneration
      }
    });

    return { settings, configGeneration };
  }

  async testConnection(
    userId: string,
    providerKey: DocumentProcessingProviderKey,
    providerKeyCandidate: string | null = null
  ): Promise<DocumentProcessingTestConnectionState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const checkedAt = new Date().toISOString();
    if (providerKey === "local") {
      return {
        providerKey,
        ok: true,
        message: "Local document parser is available.",
        checkedAt
      };
    }

    if (providerKeyCandidate !== null && providerKeyCandidate.trim().length > 0) {
      return {
        providerKey,
        ok: true,
        message: `${this.providerLabel(providerKey)} API key is present in the form and passes local validation. Save document processing settings to store it encrypted. Live OCR ping will be wired with the provider adapter.`,
        checkedAt
      };
    }

    const storageKey = toDocumentProcessingSecretStorageKey(providerKey);
    const metadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
      storageKey
    ]);
    if (metadata[storageKey]?.configured !== true) {
      return {
        providerKey,
        ok: false,
        message: `${this.providerLabel(providerKey)} API key is not configured.`,
        checkedAt
      };
    }

    try {
      const storedKey =
        await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
          storageKey
        );
      if (storedKey === null || storedKey.trim().length === 0) {
        return {
          providerKey,
          ok: false,
          message: `${this.providerLabel(providerKey)} API key is empty.`,
          checkedAt
        };
      }
      return {
        providerKey,
        ok: true,
        message: `${this.providerLabel(providerKey)} API key is present and decryptable. Live OCR ping will be wired with the provider adapter.`,
        checkedAt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credential check failed.";
      return {
        providerKey,
        ok: false,
        message: `Could not validate ${this.providerLabel(providerKey)} credentials: ${message}`,
        checkedAt
      };
    }
  }

  private async resolveSettingsState(): Promise<AdminDocumentProcessingSettingsState> {
    const [policy, keyMetadata] = await Promise.all([
      this.loadPolicy(),
      this.loadDocumentProcessingKeyMetadata()
    ]);
    return buildAdminDocumentProcessingSettingsState({ policy, keyMetadata });
  }

  private async loadPolicy(): Promise<DocumentProcessingPolicyState> {
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { documentProcessingPolicy: true }
    });
    return normalizeDocumentProcessingPolicyRecord(row?.documentProcessingPolicy ?? null);
  }

  private async persistPolicy(
    policy: DocumentProcessingPolicyState,
    userId: string
  ): Promise<void> {
    const documentProcessingPolicy = policy as Prisma.InputJsonValue;
    await this.prisma.platformRuntimeProviderSettings.upsert({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      create: {
        id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
        primaryProvider: "openai",
        primaryModel: "gpt-4o-mini",
        fallbackProvider: null,
        fallbackModel: null,
        routingFastModelKey: null,
        routerPolicy: createDefaultPlatformRuntimeRouterPolicy() as Prisma.InputJsonValue,
        availableModelsByProvider: createEmptyAvailableModelsByProvider() as Prisma.InputJsonValue,
        availableModelCatalogByProvider:
          createEmptyAvailableModelCatalogByProvider() as Prisma.InputJsonValue,
        documentProcessingPolicy,
        updatedByUserId: userId
      },
      update: {
        documentProcessingPolicy,
        updatedByUserId: userId
      }
    });
  }

  private async loadDocumentProcessingKeyMetadata(): Promise<
    Record<
      DocumentProcessingRemoteProviderKey,
      { configured: boolean; lastFour: string | null; updatedAt: string | null }
    >
  > {
    const metadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys(
      Object.values(DOCUMENT_PROCESSING_PROVIDER_SECRET_KEYS)
    );
    return {
      mistral: metadata.document_processing_mistral ?? {
        configured: false,
        lastFour: null,
        updatedAt: null
      },
      llamaparse: metadata.document_processing_llamaparse ?? {
        configured: false,
        lastFour: null,
        updatedAt: null
      }
    };
  }

  private providerLabel(providerKey: DocumentProcessingRemoteProviderKey): string {
    return providerKey === "mistral" ? "Mistral OCR" : "LlamaParse";
  }
}
