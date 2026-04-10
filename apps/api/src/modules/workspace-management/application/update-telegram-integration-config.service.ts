import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { ResolveTelegramIntegrationStateService } from "./resolve-telegram-integration-state.service";
import type {
  TelegramConfigUpdateInput,
  TelegramIntegrationState
} from "./telegram-integration.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

@Injectable()
export class UpdateTelegramIntegrationConfigService {
  private readonly logger = new Logger(UpdateTelegramIntegrationConfigService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly assistantChannelSurfaceBindingRepository: AssistantChannelSurfaceBindingRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseInput(body: unknown): TelegramConfigUpdateInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Telegram config payload must be an object.");
    }
    const source = body as Record<string, unknown>;
    const output: TelegramConfigUpdateInput = {};

    if ("autoCompactionEnabled" in source) {
      if (typeof source.autoCompactionEnabled !== "boolean") {
        throw new BadRequestException("autoCompactionEnabled must be boolean.");
      }
      output.autoCompactionEnabled = source.autoCompactionEnabled;
    }
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
    if (input.autoCompactionEnabled !== undefined) {
      nextConfig.autoCompactionEnabled = input.autoCompactionEnabled;
    }
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
          autoCompactionEnabled: input.autoCompactionEnabled !== undefined,
          defaultParseMode: input.defaultParseMode !== undefined,
          inboundUserMessagesEnabled: input.inboundUserMessagesEnabled !== undefined,
          outboundAssistantMessagesEnabled: input.outboundAssistantMessagesEnabled !== undefined,
          groupReplyMode: input.groupReplyMode !== undefined,
          notes: input.notes !== undefined
        }
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
      this.logger.log(
        `Auto-applied spec after Telegram config update for assistant ${assistantId}`
      );
    } catch (error) {
      this.logger.warn(
        `Auto-apply after Telegram config update failed for ${assistantId}: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }
}
