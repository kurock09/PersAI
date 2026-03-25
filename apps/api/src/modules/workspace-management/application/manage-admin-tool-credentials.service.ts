import { BadRequestException, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import type { PlatformRuntimeProviderKeyMetadata } from "./platform-runtime-provider-settings";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  buildAdminToolCredentialsState,
  parseUpdateToolCredentialsInput,
  type AdminToolCredentialsState,
  type ToolCredentialKey,
  type UpdateToolCredentialsInput
} from "./tool-credential-settings";

@Injectable()
export class ManageAdminToolCredentialsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
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
    return buildAdminToolCredentialsState({ keyMetadata });
  }

  async updateCredentials(
    userId: string,
    input: UpdateToolCredentialsInput,
    stepUpToken: string | null
  ): Promise<AdminToolCredentialsState> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
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
    }

    const keyMetadata = await this.loadToolKeyMetadata();
    const state = buildAdminToolCredentialsState({ keyMetadata });

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
          .map(([key]) => key)
      }
    });

    return state;
  }

  private async loadToolKeyMetadata(): Promise<
    Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata>
  > {
    const result: Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata> = {
      tool_web_search: { configured: false, lastFour: null, updatedAt: null },
      tool_web_fetch: { configured: false, lastFour: null, updatedAt: null },
      tool_image_generate: { configured: false, lastFour: null, updatedAt: null },
      tool_tts: { configured: false, lastFour: null, updatedAt: null },
      tool_memory_search: { configured: false, lastFour: null, updatedAt: null }
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
