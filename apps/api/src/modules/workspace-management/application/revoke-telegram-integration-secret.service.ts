import { BadRequestException, ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";
import {
  resolveTelegramSecretLifecycleState,
  revokeTelegramBotSecretRef
} from "./assistant-secret-refs-lifecycle";
import { ResolveTelegramIntegrationStateService } from "./resolve-telegram-integration-state.service";
import type {
  TelegramIntegrationState,
  TelegramSecretRevokeInput
} from "./telegram-integration.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { resolveTelegramBindingMetadataState } from "./telegram-integration.metadata";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

function telegramBotSecretKey(assistantId: string): string {
  return `telegram_bot:${assistantId}`;
}

@Injectable()
export class RevokeTelegramIntegrationSecretService {
  private readonly logger = new Logger(RevokeTelegramIntegrationSecretService.name);

  constructor(
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly secretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  parseInput(body: unknown): TelegramSecretRevokeInput {
    if (body === undefined || body === null) {
      return { reason: null };
    }
    if (typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Revoke payload must be an object.");
    }
    const reasonRaw = (body as Record<string, unknown>).reason;
    if (reasonRaw === undefined || reasonRaw === null) {
      return { reason: null };
    }
    if (typeof reasonRaw !== "string") {
      throw new BadRequestException("reason must be a string or null.");
    }
    const reason = reasonRaw.trim();
    if (reason.length > 255) {
      throw new BadRequestException("reason must be at most 255 characters.");
    }
    return { reason: reason.length > 0 ? reason : null };
  }

  async execute(
    userId: string,
    input: TelegramSecretRevokeInput,
    emergency: boolean
  ): Promise<TelegramIntegrationState> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId })).assistant;
    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));

    const lifecycleBefore = resolveTelegramSecretLifecycleState(governance.secretRefs, {
      legacyFallbackWhenMissing: true
    });
    const hasManagedSecret =
      lifecycleBefore.status !== "legacy_unmanaged" && lifecycleBefore.refKey !== null;
    const existingBinding =
      await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
        assistant.id,
        "telegram",
        "telegram_bot"
      );
    if (!hasManagedSecret && existingBinding === null) {
      throw new ConflictException("Telegram is not connected yet.");
    }

    if (hasManagedSecret) {
      const revoked = revokeTelegramBotSecretRef(governance.secretRefs, {
        emergency,
        reason: input.reason
      });
      await this.assistantGovernanceRepository.updateSecretRefs(
        assistant.id,
        revoked as unknown as Record<string, unknown>
      );
    }

    await this.secretStoreService
      .deleteProviderKey(telegramBotSecretKey(assistant.id))
      .catch(() => undefined);

    if (existingBinding !== null) {
      const now = new Date();
      const metadata = resolveTelegramBindingMetadataState(existingBinding.metadata);
      await this.assistantChannelSurfaceBindingRepository.upsert({
        assistantId: assistant.id,
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        bindingState: "inactive",
        tokenFingerprint: existingBinding.tokenFingerprint,
        tokenLastFour: existingBinding.tokenLastFour,
        policy:
          existingBinding.policy !== null && typeof existingBinding.policy === "object"
            ? (existingBinding.policy as Record<string, unknown>)
            : null,
        config:
          existingBinding.config !== null && typeof existingBinding.config === "object"
            ? (existingBinding.config as Record<string, unknown>)
            : null,
        metadata: {
          ...metadata,
          telegramOwnerClaimStatus: "not_started",
          telegramOwnerClaimCode: null,
          telegramOwnerClaimIssuedAt: null,
          telegramOwnerClaimedAt: null,
          telegramOwnerClaimExpiresAt: null,
          telegramOwnerTelegramUserId: null,
          telegramOwnerTelegramUsername: null,
          telegramOwnerTelegramChatId: null,
          telegramOwnerSystemWelcomeSentAt: null,
          telegramRuntimeHealth: "ok",
          telegramRuntimeHealthUpdatedAt: now.toISOString(),
          telegramRuntimeHealthMessage: null
        },
        connectedAt: existingBinding.connectedAt,
        disconnectedAt: now
      });
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: userId,
      eventCategory: "secret_change",
      eventCode: emergency
        ? "assistant.secret_ref_emergency_revoked"
        : "assistant.secret_ref_revoked",
      summary: emergency
        ? "Assistant secret reference emergency revoked for Telegram bot token."
        : "Assistant secret reference revoked for Telegram bot token.",
      details: {
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        reason: input.reason,
        emergency
      }
    });

    await this.prisma.assistant.update({
      where: { id: assistant.id },
      data: { configDirtyAt: new Date() }
    });

    await this.autoApplySpec(userId, assistant.id);

    return this.resolveTelegramIntegrationStateService.execute(userId);
  }

  private async autoApplySpec(userId: string, assistantId: string): Promise<void> {
    try {
      const latestPublished =
        await this.publishedVersionRepository.findLatestByAssistantId(assistantId);
      if (latestPublished === null) {
        return;
      }
      await this.applyAssistantPublishedVersionService.execute(userId, latestPublished, true);
      this.logger.log(`Auto-applied spec after Telegram revoke for assistant ${assistantId}`);
    } catch (error) {
      this.logger.warn(
        `Auto-apply after Telegram revoke failed for ${assistantId}: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }
}
