import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { PlatformRuntimeProviderSecretStoreService } from "../platform-runtime-provider-secret-store.service";
import { NOTIFICATION_CREDENTIAL_IDS } from "../tool-credential-settings";

/**
 * Handles incoming Postmark bounce/complaint webhooks.
 * Verifies HMAC-SHA256 signature using the webhook token from Admin > Tools
 * credential store. Updates global channel health in notification_channel_registry.
 * ADR-088 §10 + multi-user correction.
 */
@Injectable()
export class HandlePostmarkWebhookService {
  private readonly logger = new Logger(HandlePostmarkWebhookService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly secretStore: PlatformRuntimeProviderSecretStoreService
  ) {}

  async handle(input: { rawBody: string; signature: string | null }): Promise<void> {
    if (!(await this.verifySignature(input.rawBody, input.signature))) {
      this.logger.warn({ event: "postmark_webhook.invalid_signature" });
      throw new Error("invalid_postmark_signature");
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      throw new Error("invalid_json");
    }

    const recordType = typeof payload["RecordType"] === "string" ? payload["RecordType"] : null;

    if (recordType === "Bounce" || recordType === "SpamComplaint") {
      await this.handleDeliveryFailure(recordType);
    }
  }

  /**
   * Broadcast bounce/complaint update to the global email channel registry row.
   */
  async handleBroadcast(input: { rawBody: string; signature: string | null }): Promise<void> {
    await this.handle(input);
  }

  private async handleDeliveryFailure(recordType: string): Promise<void> {
    const channel = await this.prisma.notificationChannelRegistry.findUnique({
      where: { channelType: "email" }
    });

    if (!channel) {
      return;
    }

    const newFailures = channel.consecutiveFailures + 1;
    const newHealth = newFailures >= 5 ? "down" : newFailures >= 2 ? "degraded" : "healthy";

    await this.prisma.notificationChannelRegistry.update({
      where: { id: channel.id },
      data: {
        consecutiveFailures: newFailures,
        healthStatus: newHealth,
        lastFailureAt: new Date()
      }
    });

    this.logger.warn({
      event: "postmark_webhook.delivery_failure",
      recordType,
      consecutiveFailures: newFailures,
      newHealth
    });
  }

  private async verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
    const token = await this.secretStore
      .resolveSecretValueById(NOTIFICATION_CREDENTIAL_IDS.email_postmark_webhook)
      .catch(() => null);

    if (!token) {
      this.logger.warn({ event: "postmark_webhook.no_hmac_token_configured" });
      // Only allow unsigned requests in development; reject in all other environments.
      const isDev =
        process.env["APP_ENV"] === "development" || process.env["NODE_ENV"] === "development";
      return isDev;
    }
    if (!signature) {
      return false;
    }
    const expected = createHmac("sha256", token).update(rawBody).digest("hex");
    return signature === expected;
  }
}
