import { BadRequestException, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import {
  CLOUDPAYMENTS_API_SECRET_STORAGE_KEY,
  CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY,
  buildAdminBillingProviderCredentialsState,
  parseUpdateBillingProviderCredentialsInput,
  type AdminBillingProviderCredentialsState,
  type UpdateBillingProviderCredentialsInput
} from "./billing-provider-credential-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";

@Injectable()
export class ManageAdminBillingProviderCredentialsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseUpdateInput(body: unknown): UpdateBillingProviderCredentialsInput {
    try {
      return parseUpdateBillingProviderCredentialsInput(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid billing provider credentials request.";
      throw new BadRequestException(message);
    }
  }

  async getCredentials(userId: string): Promise<AdminBillingProviderCredentialsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.loadState();
  }

  async updateCredentials(
    userId: string,
    input: UpdateBillingProviderCredentialsInput,
    stepUpToken: string | null
  ): Promise<AdminBillingProviderCredentialsState> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.billing_provider_credentials.update",
      stepUpToken
    );
    this.platformRuntimeProviderSecretStoreService.assertEncryptionConfigured();

    const cloudpaymentsSecret = input.providers.cloudpayments?.apiSecret;
    const cloudpaymentsPublicTerminalId = input.providers.cloudpayments?.publicTerminalId;
    if (cloudpaymentsSecret === undefined && cloudpaymentsPublicTerminalId === undefined) {
      throw new BadRequestException("No billing provider credential changes were provided.");
    }

    if (cloudpaymentsSecret !== undefined) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        CLOUDPAYMENTS_API_SECRET_STORAGE_KEY,
        cloudpaymentsSecret,
        userId
      );
    }
    if (cloudpaymentsPublicTerminalId !== undefined) {
      await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
        CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY,
        cloudpaymentsPublicTerminalId,
        userId
      );
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.billing_provider_credentials_updated",
      summary: "Billing provider credentials updated.",
      details: {
        updatedProviders: ["cloudpayments"],
        updatedFields: [
          ...(cloudpaymentsSecret === undefined ? [] : ["apiSecret"]),
          ...(cloudpaymentsPublicTerminalId === undefined ? [] : ["publicTerminalId"])
        ]
      }
    });

    return this.loadState();
  }

  private async loadState(): Promise<AdminBillingProviderCredentialsState> {
    const metadata = await this.platformRuntimeProviderSecretStoreService.loadKeyMetadataByKeys([
      CLOUDPAYMENTS_API_SECRET_STORAGE_KEY,
      CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY
    ]);
    return buildAdminBillingProviderCredentialsState({
      cloudpaymentsApiSecretMetadata: metadata[CLOUDPAYMENTS_API_SECRET_STORAGE_KEY] ?? {
        configured: false,
        lastFour: null,
        updatedAt: null
      },
      cloudpaymentsPublicTerminalIdMetadata: metadata[
        CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY
      ] ?? {
        configured: false,
        lastFour: null,
        updatedAt: null
      }
    });
  }
}
