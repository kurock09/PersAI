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

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
    const defaultParseMode = config?.defaultParseMode === "markdown" ? "markdown" : "plain_text";
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

    return {
      schema: "persai.telegramIntegration.v1",
      provider: "telegram",
      surfaceType: "telegram_bot",
      capabilityAllowed,
      connectionStatus: hasConnectedBinding ? "connected" : "not_connected",
      bindingState: binding?.bindingState ?? "unconfigured",
      connectedAt: binding?.connectedAt?.toISOString() ?? null,
      bot: {
        telegramUserId: toNumberOrNull(metadata?.telegramUserId),
        username: toStringOrNull(metadata?.username),
        displayName: toStringOrNull(metadata?.displayName),
        avatarUrl: toStringOrNull(metadata?.avatarUrl)
      },
      tokenHint: {
        lastFour: binding?.tokenLastFour ?? null
      },
      secretLifecycle,
      configPanel: {
        available: hasConnectedBinding,
        settings: {
          defaultParseMode,
          inboundUserMessagesEnabled,
          outboundAssistantMessagesEnabled,
          groupReplyMode:
            config?.groupReplyMode === "all_messages" ? "all_messages" : "mention_reply",
          notes: toStringOrNull(config?.notes)
        }
      },
      notes: [
        "Telegram is modeled as one provider + one interaction surface binding.",
        "Web remains the primary control-plane surface for assistant configuration."
      ]
    };
  }
}
