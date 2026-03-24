import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  resolveTelegramSecretLifecycleState,
  revokeTelegramBotSecretRef
} from "./assistant-secret-refs-lifecycle";
import { ResolveTelegramIntegrationStateService } from "./resolve-telegram-integration-state.service";
import type { TelegramIntegrationState, TelegramSecretRevokeInput } from "./telegram-integration.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";

@Injectable()
export class RevokeTelegramIntegrationSecretService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
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
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));

    const lifecycleBefore = resolveTelegramSecretLifecycleState(governance.secretRefs, {
      legacyFallbackWhenMissing: true
    });
    const hasManagedSecret = lifecycleBefore.status !== "legacy_unmanaged" && lifecycleBefore.refKey !== null;
    if (!hasManagedSecret) {
      throw new ConflictException(
        "Telegram secret reference is not managed yet. Rotate Telegram token first to enable managed lifecycle operations."
      );
    }

    const revoked = revokeTelegramBotSecretRef(governance.secretRefs, {
      emergency,
      reason: input.reason
    });
    await this.assistantGovernanceRepository.updateSecretRefs(
      assistant.id,
      revoked as unknown as Record<string, unknown>
    );

    const existingBinding =
      await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
        assistant.id,
        "telegram",
        "telegram_bot"
      );
    if (existingBinding !== null) {
      const now = new Date();
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
        metadata:
          existingBinding.metadata !== null && typeof existingBinding.metadata === "object"
            ? (existingBinding.metadata as Record<string, unknown>)
            : null,
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

    return this.resolveTelegramIntegrationStateService.execute(userId);
  }
}
