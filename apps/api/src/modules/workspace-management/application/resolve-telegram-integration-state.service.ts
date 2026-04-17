import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { ResolveEffectiveCapabilityStateService } from "./resolve-effective-capability-state.service";
import type { TelegramIntegrationState } from "./telegram-integration.types";
import { resolveTelegramSecretLifecycleState } from "./assistant-secret-refs-lifecycle";
import {
  isTelegramOwnerClaimExpired,
  refreshTelegramOwnerClaimMetadata,
  resolveTelegramBindingMetadataState,
  resolveTelegramConnectionStatus
} from "./telegram-integration.metadata";

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

@Injectable()
export class ResolveTelegramIntegrationStateService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly resolveEffectiveCapabilityStateService: ResolveEffectiveCapabilityStateService
  ) {}

  async execute(userId: string): Promise<TelegramIntegrationState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));
    const effectiveCapabilities = await this.resolveEffectiveCapabilityStateService.execute({
      assistant,
      governance
    });
    const capabilityAllowed = effectiveCapabilities.channelsAndSurfaces.telegram;

    const binding =
      await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
        assistant.id,
        "telegram",
        "telegram_bot"
      );
    const metadata = asObject(binding?.metadata ?? null);
    const config = asObject(binding?.config ?? null);
    const policy = asObject(binding?.policy ?? null);
    let telegramMetadata = resolveTelegramBindingMetadataState(metadata);
    if (
      binding !== null &&
      binding.bindingState === "active" &&
      telegramMetadata.telegramOwnerClaimStatus !== "claimed" &&
      isTelegramOwnerClaimExpired(telegramMetadata.telegramOwnerClaimExpiresAt)
    ) {
      const refreshedMetadata = refreshTelegramOwnerClaimMetadata(metadata);
      await this.assistantChannelSurfaceBindingRepository.patchMetadata(
        assistant.id,
        "telegram",
        "telegram_bot",
        refreshedMetadata
      );
      telegramMetadata = resolveTelegramBindingMetadataState(refreshedMetadata);
    }
    const defaultParseMode = config?.defaultParseMode === "markdown" ? "markdown" : "plain_text";
    const defaultDeepModeEnabled = config?.defaultDeepModeEnabled === true;
    const autoCompactionEnabled = config?.autoCompactionEnabled !== false;
    const inboundUserMessagesEnabled = policy?.inboundUserMessages === true;
    const outboundAssistantMessagesEnabled = policy?.outboundAssistantMessages !== false;

    const secretLifecycle = resolveTelegramSecretLifecycleState(governance.secretRefs, {
      legacyFallbackWhenMissing: binding !== null && binding.bindingState === "active"
    });
    const hasConnectedBinding =
      binding !== null &&
      binding.bindingState === "active" &&
      binding.connectedAt !== null &&
      binding.disconnectedAt === null &&
      (secretLifecycle.status === "active" || secretLifecycle.status === "legacy_unmanaged");
    const connectionStatus = resolveTelegramConnectionStatus({
      hasConnectedBinding,
      runtimeHealth: telegramMetadata.telegramRuntimeHealth,
      claimStatus: telegramMetadata.telegramOwnerClaimStatus
    });

    return {
      schema: "persai.telegramIntegration.v1",
      provider: "telegram",
      surfaceType: "telegram_bot",
      capabilityAllowed,
      connectionStatus,
      bindingState: binding?.bindingState ?? "unconfigured",
      connectedAt: binding?.connectedAt?.toISOString() ?? null,
      bot: {
        telegramUserId: telegramMetadata.telegramUserId,
        username: telegramMetadata.username,
        displayName: telegramMetadata.displayName,
        avatarUrl: telegramMetadata.avatarUrl,
        ownerTelegramUserId: telegramMetadata.telegramOwnerTelegramUserId,
        ownerTelegramUsername: telegramMetadata.telegramOwnerTelegramUsername,
        ownerTelegramChatId: telegramMetadata.telegramOwnerTelegramChatId
      },
      tokenHint: {
        lastFour: binding?.tokenLastFour ?? null
      },
      ownerClaim: {
        required: hasConnectedBinding,
        status: telegramMetadata.telegramOwnerClaimStatus,
        code: telegramMetadata.telegramOwnerClaimCode,
        claimIssuedAt: telegramMetadata.telegramOwnerClaimIssuedAt,
        claimExpiresAt: telegramMetadata.telegramOwnerClaimExpiresAt,
        claimedAt: telegramMetadata.telegramOwnerClaimedAt,
        systemWelcomeSentAt: telegramMetadata.telegramOwnerSystemWelcomeSentAt
      },
      runtime: {
        health: telegramMetadata.telegramRuntimeHealth,
        lastError: telegramMetadata.telegramRuntimeHealthMessage,
        checkedAt: telegramMetadata.telegramRuntimeHealthUpdatedAt
      },
      secretLifecycle,
      configPanel: {
        available: connectionStatus === "connected" || connectionStatus === "claim_required",
        settings: {
          autoCompactionEnabled,
          defaultParseMode,
          defaultDeepModeEnabled,
          inboundUserMessagesEnabled,
          outboundAssistantMessagesEnabled,
          groupReplyMode:
            config?.groupReplyMode === "all_messages" ? "all_messages" : "mention_reply",
          notes: toStringOrNull(config?.notes)
        }
      },
      notes: [
        "Telegram is modeled as one provider + one interaction surface binding.",
        "Telegram direct messages are owner-only after claim.",
        "Web remains the primary control-plane surface for assistant configuration."
      ]
    };
  }
}
