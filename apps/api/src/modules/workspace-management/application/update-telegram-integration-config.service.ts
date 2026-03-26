import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { ResolveTelegramIntegrationStateService } from "./resolve-telegram-integration-state.service";
import type {
  TelegramConfigUpdateInput,
  TelegramIntegrationState
} from "./telegram-integration.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

@Injectable()
export class UpdateTelegramIntegrationConfigService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseInput(body: unknown): TelegramConfigUpdateInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Telegram config payload must be an object.");
    }
    const source = body as Record<string, unknown>;
    const output: TelegramConfigUpdateInput = {};

    if ("defaultParseMode" in source) {
      if (source.defaultParseMode !== "plain_text" && source.defaultParseMode !== "markdown") {
        throw new BadRequestException("defaultParseMode must be plain_text or markdown.");
      }
      output.defaultParseMode = source.defaultParseMode;
    }
    if ("inboundUserMessagesEnabled" in source) {
      if (typeof source.inboundUserMessagesEnabled !== "boolean") {
        throw new BadRequestException("inboundUserMessagesEnabled must be boolean.");
      }
      output.inboundUserMessagesEnabled = source.inboundUserMessagesEnabled;
    }
    if ("outboundAssistantMessagesEnabled" in source) {
      if (typeof source.outboundAssistantMessagesEnabled !== "boolean") {
        throw new BadRequestException("outboundAssistantMessagesEnabled must be boolean.");
      }
      output.outboundAssistantMessagesEnabled = source.outboundAssistantMessagesEnabled;
    }
    if ("groupReplyMode" in source) {
      if (source.groupReplyMode !== "mention_reply" && source.groupReplyMode !== "all_messages") {
        throw new BadRequestException("groupReplyMode must be mention_reply or all_messages.");
      }
      output.groupReplyMode = source.groupReplyMode;
    }
    if ("notes" in source) {
      if (source.notes !== null && typeof source.notes !== "string") {
        throw new BadRequestException("notes must be string or null.");
      }
      output.notes =
        typeof source.notes === "string" && source.notes.trim().length === 0
          ? null
          : (source.notes as string | null);
    }

    if (Object.keys(output).length === 0) {
      throw new BadRequestException("At least one telegram config field is required.");
    }
    return output;
  }

  async execute(
    userId: string,
    input: TelegramConfigUpdateInput
  ): Promise<TelegramIntegrationState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const binding =
      await this.assistantChannelSurfaceBindingRepository.findByAssistantProviderSurface(
        assistant.id,
        "telegram",
        "telegram_bot"
      );
    if (
      binding === null ||
      binding.bindingState !== "active" ||
      binding.connectedAt === null ||
      binding.disconnectedAt !== null
    ) {
      throw new ConflictException("Telegram is not connected yet.");
    }

    const nextPolicy = asObject(binding.policy);
    const nextConfig = asObject(binding.config);
    if (input.inboundUserMessagesEnabled !== undefined) {
      nextPolicy.inboundUserMessages = input.inboundUserMessagesEnabled;
    }
    if (input.outboundAssistantMessagesEnabled !== undefined) {
      nextPolicy.outboundAssistantMessages = input.outboundAssistantMessagesEnabled;
    }
    if (input.defaultParseMode !== undefined) {
      nextConfig.defaultParseMode = input.defaultParseMode;
    }
    if (input.groupReplyMode !== undefined) {
      nextConfig.groupReplyMode = input.groupReplyMode;
    }
    if (input.notes !== undefined) {
      nextConfig.notes = input.notes;
    }

    await this.assistantChannelSurfaceBindingRepository.upsert({
      assistantId: assistant.id,
      providerKey: "telegram",
      surfaceType: "telegram_bot",
      bindingState: "active",
      tokenFingerprint: binding.tokenFingerprint,
      tokenLastFour: binding.tokenLastFour,
      policy: nextPolicy,
      config: nextConfig,
      metadata: asObject(binding.metadata),
      connectedAt: binding.connectedAt,
      disconnectedAt: null
    });
    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: userId,
      eventCategory: "channel_binding",
      eventCode: "assistant.telegram_config_updated",
      summary: "Telegram channel binding configuration updated.",
      details: {
        providerKey: "telegram",
        surfaceType: "telegram_bot",
        changedFields: {
          defaultParseMode: input.defaultParseMode !== undefined,
          inboundUserMessagesEnabled: input.inboundUserMessagesEnabled !== undefined,
          outboundAssistantMessagesEnabled: input.outboundAssistantMessagesEnabled !== undefined,
          groupReplyMode: input.groupReplyMode !== undefined,
          notes: input.notes !== undefined
        }
      }
    });

    return this.resolveTelegramIntegrationStateService.execute(userId);
  }
}
