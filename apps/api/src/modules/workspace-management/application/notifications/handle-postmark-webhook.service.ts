import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

/**
 * Handles incoming Postmark bounce/complaint webhooks.
 * Verifies HMAC-SHA256 signature, updates channel health in
 * notification_channel_registry, and increments consecutiveFailures.
 * ADR-088 §10.
 */
@Injectable()
export class HandlePostmarkWebhookService {
  private readonly logger = new Logger(HandlePostmarkWebhookService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  private get webhookToken(): string | undefined {
    return process.env["POSTMARK_WEBHOOK_TOKEN"];
  }

  async handle(input: {
    rawBody: string;
    signature: string | null;
    workspaceId: string;
  }): Promise<void> {
    if (!this.verifySignature(input.rawBody, input.signature)) {
      this.logger.warn({
        event: "postmark_webhook.invalid_signature",
        workspaceId: input.workspaceId
      });
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
      await this.handleDeliveryFailure(input.workspaceId, recordType);
    }
  }

  /**
   * Broadcast bounce/complaint update to all email channel registry rows
   * (single-workspace assumption in Slice 1).
   */
  async handleBroadcast(input: { rawBody: string; signature: string | null }): Promise<void> {
    if (!this.verifySignature(input.rawBody, input.signature)) {
      throw new Error("invalid_postmark_signature");
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      throw new Error("invalid_json");
    }

    const recordType = typeof payload["RecordType"] === "string" ? payload["RecordType"] : null;
    if (recordType !== "Bounce" && recordType !== "SpamComplaint") {
      return;
    }

    // In Slice 1: find all email channel registry rows and update health
    const emailChannels = await this.prisma.notificationChannelRegistry.findMany({
      where: { channelType: "email" }
    });

    await Promise.all(
      emailChannels.map(async (channel) => {
        await this.handleDeliveryFailure(channel.workspaceId, recordType);
      })
    );
  }

  private async handleDeliveryFailure(workspaceId: string, recordType: string): Promise<void> {
    const channel = await this.prisma.notificationChannelRegistry.findFirst({
      where: { workspaceId, channelType: "email" }
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
      workspaceId,
      recordType,
      consecutiveFailures: newFailures,
      newHealth
    });
  }

  private verifySignature(rawBody: string, signature: string | null): boolean {
    const token = this.webhookToken;
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
