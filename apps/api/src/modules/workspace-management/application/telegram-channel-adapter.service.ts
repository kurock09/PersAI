import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RawInboundAttachment } from "./media/media.types";
import { HandleInternalTelegramTurnService } from "./handle-internal-telegram-turn.service";
import {
  ResolveTelegramChannelRuntimeConfigService,
  type ResolvedTelegramChannelRuntimeConfig
} from "./resolve-telegram-channel-runtime-config.service";
import {
  TelegramBotClientService,
  TelegramBotUnauthorizedError,
  type TelegramChatActionHeartbeat
} from "./telegram-bot.client.service";
import {
  resolveTelegramOutboundChatAction,
  resolveTelegramToolChatAction
} from "./telegram-chat-actions";
import { SyncTelegramChatTargetService } from "./sync-telegram-chat-target.service";
import { SyncTelegramGroupMembershipService } from "./sync-telegram-group-membership.service";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { RenderAssistantInboundSurfaceMessageService } from "./render-assistant-inbound-surface-message.service";
import { toAssistantInboundFailurePayload } from "./assistant-inbound-error";
import { MediaDeliveryService } from "./media/media-delivery.service";

const TELEGRAM_OWNER_CLAIM_CODE_LENGTH = 6;

type TelegramChatType = "private" | "group" | "supergroup";

type ParsedTelegramWebhookEvent =
  | {
      kind: "ignore";
    }
  | {
      kind: "group_membership";
      assistantId: string;
      telegramChatId: string;
      title: string;
      event: "joined" | "left";
      memberCount: number | null;
    }
  | {
      kind: "message";
      updateId: number | null;
      chatId: string;
      chatType: TelegramChatType;
      chatTitle: string | null;
      telegramUserId: number | null;
      telegramUsername: string | null;
      incomingText: string;
      replyToUserId: number | null;
      turnKind: "text" | "voice" | "photo" | "document";
      userMessage: string;
      attachment: {
        fileId: string;
        mimeType: string;
        originalFilename: string | null;
      } | null;
    };

type TelegramWebhookHandleResult = {
  statusCode: number;
  body: Record<string, unknown>;
};

class TelegramInboundAttachmentDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramInboundAttachmentDownloadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function claimCodeFromText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const withoutCommand = text.trim().replace(/^\/(?:start|claim)(?:@\w+)?\s+/i, "");
  const normalized = withoutCommand.replace(/[\s-]+/g, "");
  const match = normalized.match(
    new RegExp(`^(\\d{${String(TELEGRAM_OWNER_CLAIM_CODE_LENGTH)}})$`)
  );
  return match?.[1] ?? null;
}

function isExpiredIsoTimestamp(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function buildTelegramOwnerClaimedWelcome(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "Telegram подключен. Это приватный чат хозяина. Я уже здесь и готова продолжать разговор прямо в этом диалоге."
    : "Telegram is connected. This is the owner's private chat. I'm here now, and you can continue right in this conversation.";
}

function buildTelegramOwnerClaimRequiredReply(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "Чтобы подтвердить владельца ассистента, отправьте сюда 6-значный код из PersAI."
    : "To confirm that you are the assistant owner, send the 6-digit code from PersAI here.";
}

function buildTelegramInvalidOwnerClaimCodeReply(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "Неверный код подтверждения. Отправьте 6-значный код из PersAI."
    : "That verification code is invalid. Send the 6-digit code from PersAI.";
}

function buildTelegramExpiredOwnerClaimCodeReply(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "Код подтверждения истек. Переподключите бота в PersAI, чтобы получить новый код."
    : "That verification code has expired. Reconnect the bot in PersAI to get a new code.";
}

function buildTelegramUnauthorizedUserReply(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "Этот бот доступен только хозяину ассистента."
    : "This bot is available only to the assistant owner.";
}

function buildTelegramAutoCompactionNotice(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "После этого ответа старый контекст был автоматически сжат, чтобы уложиться в бюджет контекста тарифа."
    : "Older context was auto-compacted after this reply to stay within your plan's context budget.";
}

function evaluateTelegramOwnerGate(params: {
  currentConfig: ResolvedTelegramChannelRuntimeConfig;
  incomingText: string;
  telegramUserId: number | null;
}): {
  allowed: boolean;
  claimNow: boolean;
  replyText: string | null;
} {
  const { currentConfig, incomingText, telegramUserId } = params;
  if (currentConfig.accessMode !== "owner_only") {
    return { allowed: true, claimNow: false, replyText: null };
  }

  if (currentConfig.ownerClaimStatus !== "claimed") {
    if (isExpiredIsoTimestamp(currentConfig.ownerClaimCodeExpiresAt)) {
      return {
        allowed: false,
        claimNow: false,
        replyText: buildTelegramExpiredOwnerClaimCodeReply(currentConfig.locale)
      };
    }
    const incomingClaimCode = claimCodeFromText(incomingText);
    if (
      incomingClaimCode &&
      currentConfig.ownerClaimCode &&
      incomingClaimCode === currentConfig.ownerClaimCode
    ) {
      return { allowed: false, claimNow: true, replyText: null };
    }
    if (incomingClaimCode) {
      return {
        allowed: false,
        claimNow: false,
        replyText: buildTelegramInvalidOwnerClaimCodeReply(currentConfig.locale)
      };
    }
    return {
      allowed: false,
      claimNow: false,
      replyText: buildTelegramOwnerClaimRequiredReply(currentConfig.locale)
    };
  }

  if (
    currentConfig.ownerTelegramUserId !== null &&
    telegramUserId !== null &&
    currentConfig.ownerTelegramUserId !== telegramUserId
  ) {
    return {
      allowed: false,
      claimNow: false,
      replyText: buildTelegramUnauthorizedUserReply(currentConfig.locale)
    };
  }

  return { allowed: true, claimNow: false, replyText: null };
}

function extractChatId(chat: Record<string, unknown>): string | null {
  const raw = chat.id;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return null;
}

function extractTelegramWebhookEvent(
  assistantId: string,
  payload: unknown
): ParsedTelegramWebhookEvent {
  if (!isRecord(payload)) {
    return { kind: "ignore" };
  }

  const updateId = toNumberOrNull(payload.update_id);
  const chatMembership = isRecord(payload.my_chat_member) ? payload.my_chat_member : null;
  if (chatMembership) {
    const chat = isRecord(chatMembership.chat) ? chatMembership.chat : null;
    const chatType = toStringOrNull(chat?.type);
    const chatId = chat ? extractChatId(chat) : null;
    const nextMember = isRecord(chatMembership.new_chat_member)
      ? chatMembership.new_chat_member
      : null;
    if (chat && chatId && (chatType === "group" || chatType === "supergroup") && nextMember) {
      const status = toStringOrNull(nextMember.status);
      return {
        kind: "group_membership",
        assistantId,
        telegramChatId: chatId,
        title: toStringOrNull(chat.title) ?? "",
        event: status === "member" || status === "administrator" ? "joined" : "left",
        memberCount: toNumberOrNull(nextMember.member_count)
      };
    }
  }

  const message = isRecord(payload.message) ? payload.message : null;
  if (!message) {
    return { kind: "ignore" };
  }

  const chat = isRecord(message.chat) ? message.chat : null;
  const from = isRecord(message.from) ? message.from : null;
  const replyToMessage = isRecord(message.reply_to_message) ? message.reply_to_message : null;
  const replyToFrom = isRecord(replyToMessage?.from) ? replyToMessage.from : null;
  if (!chat) {
    return { kind: "ignore" };
  }

  const chatId = extractChatId(chat);
  const chatType = toStringOrNull(chat.type);
  if (!chatId || (chatType !== "private" && chatType !== "group" && chatType !== "supergroup")) {
    return { kind: "ignore" };
  }
  const normalizedChatType = chatType as TelegramChatType;

  const base = {
    kind: "message" as const,
    updateId,
    chatId,
    chatType: normalizedChatType,
    chatTitle: toStringOrNull(chat.title),
    telegramUserId: toNumberOrNull(from?.id),
    telegramUsername: toStringOrNull(from?.username),
    replyToUserId: toNumberOrNull(replyToFrom?.id)
  };

  const text = toStringOrNull(message.text);
  if (text !== null) {
    return {
      ...base,
      incomingText: text,
      turnKind: "text",
      userMessage: text,
      attachment: null
    };
  }

  const voice = isRecord(message.voice) ? message.voice : null;
  if (voice && toStringOrNull(voice.file_id)) {
    return {
      ...base,
      incomingText: "",
      turnKind: "voice",
      userMessage: "(voice message)",
      attachment: {
        fileId: toStringOrNull(voice.file_id) ?? "",
        mimeType: toStringOrNull(voice.mime_type) ?? "audio/ogg",
        originalFilename: "voice.ogg"
      }
    };
  }

  const photos = Array.isArray(message.photo)
    ? message.photo.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    : [];
  const largestPhoto = photos.length > 0 ? photos[photos.length - 1] : null;
  if (largestPhoto && toStringOrNull(largestPhoto.file_id)) {
    const caption = toStringOrNull(message.caption) ?? "";
    return {
      ...base,
      incomingText: caption,
      turnKind: "photo",
      userMessage: caption || "(sent a photo)",
      attachment: {
        fileId: toStringOrNull(largestPhoto.file_id) ?? "",
        mimeType: "image/jpeg",
        originalFilename: "photo.jpg"
      }
    };
  }

  const document = isRecord(message.document) ? message.document : null;
  if (document && toStringOrNull(document.file_id)) {
    const caption = toStringOrNull(message.caption) ?? "";
    const documentName = toStringOrNull(document.file_name) ?? "document";
    return {
      ...base,
      incomingText: caption,
      turnKind: "document",
      userMessage: caption || `(sent a file: ${documentName})`,
      attachment: {
        fileId: toStringOrNull(document.file_id) ?? "",
        mimeType: toStringOrNull(document.mime_type) ?? "application/octet-stream",
        originalFilename: toStringOrNull(document.file_name)
      }
    };
  }

  return { kind: "ignore" };
}

function shouldIgnoreGroupText(params: {
  event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>;
  config: ResolvedTelegramChannelRuntimeConfig;
}): boolean {
  if (params.event.chatType === "private") {
    return false;
  }
  if (params.config.groupReplyMode !== "mention_reply") {
    return false;
  }
  const isReply =
    params.config.botUserId !== null && params.event.replyToUserId === params.config.botUserId;
  const isMentioned =
    params.config.botUsername !== null &&
    params.event.incomingText.includes(`@${params.config.botUsername}`);
  return !isReply && !isMentioned;
}

function fallbackTurnFailureCopy(turnKind: "text" | "voice" | "photo" | "document"): string {
  switch (turnKind) {
    case "voice":
      return "Sorry, I couldn't process your voice message. Please try again.";
    case "photo":
      return "Sorry, I couldn't process your photo. Please try again.";
    case "document":
      return "Sorry, I couldn't process your file. Please try again.";
    case "text":
    default:
      return "Sorry, I encountered an error. Please try again.";
  }
}

function toTelegramConversationIdentity(
  event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>
): {
  mode: "direct" | "group";
  externalUserKey: string | null;
} {
  if (event.chatType === "private") {
    return {
      mode: "direct",
      externalUserKey: event.telegramUserId !== null ? String(event.telegramUserId) : event.chatId
    };
  }
  return {
    mode: "group",
    externalUserKey: null
  };
}

@Injectable()
export class TelegramChannelAdapterService {
  private readonly logger = new Logger(TelegramChannelAdapterService.name);

  constructor(
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly telegramBotClientService: TelegramBotClientService,
    private readonly handleInternalTelegramTurnService: HandleInternalTelegramTurnService,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly syncTelegramChatTargetService: SyncTelegramChatTargetService,
    private readonly syncTelegramGroupMembershipService: SyncTelegramGroupMembershipService,
    private readonly renderAssistantInboundSurfaceMessageService: RenderAssistantInboundSurfaceMessageService,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository
  ) {}

  async handleWebhook(params: {
    assistantId: string;
    secretToken: string | null;
    payload: unknown;
  }): Promise<TelegramWebhookHandleResult> {
    const config = await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(
      params.assistantId
    );
    if (config === null) {
      return {
        statusCode: 200,
        body: { ok: false, error: "unknown_assistant" }
      };
    }

    if (!config.webhookSecret) {
      return {
        statusCode: 503,
        body: { ok: false, error: "webhook_secret_unavailable" }
      };
    }

    if (params.secretToken !== config.webhookSecret) {
      return {
        statusCode: 401,
        body: { ok: false, error: "unauthorized" }
      };
    }

    const event = extractTelegramWebhookEvent(params.assistantId, params.payload);
    if (event.kind === "ignore") {
      return { statusCode: 200, body: { ok: true } };
    }

    if (event.kind === "group_membership") {
      await this.syncTelegramGroupMembershipService.execute({
        assistantId: event.assistantId,
        telegramChatId: event.telegramChatId,
        title: event.title,
        event: event.event,
        memberCount: event.memberCount
      });
      return { statusCode: 200, body: { ok: true } };
    }

    if (!config.inbound || !config.outbound) {
      return { statusCode: 200, body: { ok: true } };
    }

    if (event.turnKind === "text" && shouldIgnoreGroupText({ event, config })) {
      return { statusCode: 200, body: { ok: true } };
    }

    const ownerGate = evaluateTelegramOwnerGate({
      currentConfig: config,
      incomingText: event.incomingText,
      telegramUserId: event.telegramUserId
    });

    if (ownerGate.claimNow) {
      await this.syncTelegramChatTargetService.execute({
        assistantId: config.assistantId,
        telegramChatId: event.chatId,
        chatType: event.chatType,
        title: event.chatTitle,
        username: event.telegramUsername,
        telegramUserId: event.telegramUserId,
        claimOwner: true,
        systemWelcomeSentAt: null,
        runtimeHealth: null,
        runtimeHealthMessage: null
      });
      try {
        await this.telegramBotClientService.sendPlainText(
          config.botToken,
          event.chatId,
          buildTelegramOwnerClaimedWelcome(config.locale)
        );
      } catch (error) {
        if (await this.handleUnauthorizedTelegramError(config.assistantId, error)) {
          return { statusCode: 200, body: { ok: false, error: "invalid_bot_token" } };
        }
        throw error;
      }
      await this.syncTelegramChatTargetService.execute({
        assistantId: config.assistantId,
        telegramChatId: event.chatId,
        chatType: event.chatType,
        title: event.chatTitle,
        username: event.telegramUsername,
        telegramUserId: event.telegramUserId,
        claimOwner: false,
        systemWelcomeSentAt: new Date().toISOString(),
        runtimeHealth: "ok",
        runtimeHealthMessage: null
      });
      return { statusCode: 200, body: { ok: true } };
    }

    if (!ownerGate.allowed) {
      if (ownerGate.replyText) {
        const unauthorized = await this.safeSendPlainText(
          config,
          event.chatId,
          ownerGate.replyText
        );
        if (unauthorized) {
          return { statusCode: 200, body: { ok: false, error: "invalid_bot_token" } };
        }
      }
      return { statusCode: 200, body: { ok: true } };
    }

    if (event.chatType !== "private") {
      await this.syncTelegramGroupMembershipService.execute({
        assistantId: config.assistantId,
        telegramChatId: event.chatId,
        title: event.chatTitle ?? "",
        event: "joined"
      });
    }

    await this.syncTelegramChatTargetService.execute({
      assistantId: config.assistantId,
      telegramChatId: event.chatId,
      chatType: event.chatType,
      title: event.chatTitle,
      username: event.telegramUsername,
      telegramUserId: event.telegramUserId,
      claimOwner: false,
      systemWelcomeSentAt: null,
      runtimeHealth: null,
      runtimeHealthMessage: null
    });

    let turnResult;
    const chatActionState: { current: TelegramChatActionHeartbeat | null } = {
      current: null
    };
    try {
      const conversationIdentity = toTelegramConversationIdentity(event);
      turnResult = await this.handleInternalTelegramTurnService.execute({
        assistantId: config.assistantId,
        threadId: event.chatId,
        conversationMode: conversationIdentity.mode,
        externalUserKey: conversationIdentity.externalUserKey,
        message: event.userMessage,
        updateId: event.updateId,
        hasAttachments: event.attachment !== null,
        loadRawAttachments: async () => this.buildRawAttachments(config, event),
        onProcessingStarted: () => {
          if (chatActionState.current !== null) {
            return;
          }
          chatActionState.current = this.telegramBotClientService.startChatActionHeartbeat({
            botToken: config.botToken,
            chatId: event.chatId,
            initialAction: "typing"
          });
        },
        onRuntimeTool: ({ phase, toolName, isError }) => {
          chatActionState.current?.setAction(
            resolveTelegramToolChatAction({
              phase,
              toolName,
              isError
            })
          );
        }
      });
    } catch (error) {
      chatActionState.current?.stop();
      if (await this.handleUnauthorizedTelegramError(config.assistantId, error)) {
        await this.completeTelegramUpdateBestEffort(config.assistantId, event.updateId);
        return { statusCode: 200, body: { ok: false, error: "invalid_bot_token" } };
      }
      if (error instanceof TelegramInboundAttachmentDownloadError) {
        return this.replyWithTerminalTurnFailure({
          config,
          event,
          text: fallbackTurnFailureCopy(event.turnKind),
          errorCode: "attachment_download_failed"
        });
      }
      const failure = toAssistantInboundFailurePayload(error);
      const outboundMessage = this.renderAssistantInboundSurfaceMessageService.renderError(
        "telegram",
        failure.code,
        fallbackTurnFailureCopy(event.turnKind)
      );
      return this.replyWithTerminalTurnFailure({
        config,
        event,
        text: outboundMessage.text,
        errorCode: failure.code
      });
    }

    try {
      if (turnResult.media.length > 0 && turnResult.deduplicated !== true) {
        await this.mediaDeliveryService.deliver({
          artifacts: turnResult.media,
          channel: "telegram",
          assistantId: config.assistantId,
          chatId: turnResult.chatId,
          messageId: turnResult.assistantMessageId,
          workspaceId: turnResult.workspaceId,
          channelTarget: {
            channel: "telegram",
            chatId: event.chatId,
            metadata: {
              botToken: config.botToken
            }
          }
        });
      }

      await this.telegramBotClientService.sendAssistantTurnReply({
        botToken: config.botToken,
        chatId: event.chatId,
        assistantId: config.assistantId,
        parseMode: config.parseMode,
        turnResult,
        mediaAlreadyDelivered: turnResult.media.length > 0,
        postReplyNotices:
          turnResult.autoCompaction === undefined
            ? undefined
            : [buildTelegramAutoCompactionNotice(config.locale)],
        onBeforeMediaSend: (media) => {
          chatActionState.current?.setAction(resolveTelegramOutboundChatAction(media));
        }
      });
    } catch (error) {
      chatActionState.current?.stop();
      if (await this.handleUnauthorizedTelegramError(config.assistantId, error)) {
        return { statusCode: 200, body: { ok: false, error: "invalid_bot_token" } };
      }
      this.logger.warn(
        `Telegram outbound delivery failed for ${config.assistantId}: ${String(error)}`
      );
      return { statusCode: 200, body: { ok: false, error: "telegram_delivery_failed" } };
    }
    chatActionState.current?.stop();

    return { statusCode: 200, body: { ok: true } };
  }

  private async buildRawAttachments(
    config: ResolvedTelegramChannelRuntimeConfig,
    event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>
  ): Promise<RawInboundAttachment[]> {
    if (event.attachment === null) {
      return [];
    }
    try {
      const downloaded = await this.telegramBotClientService.downloadInboundFile(
        config.botToken,
        event.attachment.fileId
      );
      return [
        {
          buffer: downloaded.buffer,
          mime: event.attachment.mimeType,
          originalFilename:
            event.attachment.originalFilename ??
            downloaded.filePath.split("/").pop() ??
            `telegram-${event.turnKind}`,
          source: "telegram_download"
        }
      ];
    } catch (error) {
      if (error instanceof TelegramBotUnauthorizedError) {
        throw error;
      }
      throw new TelegramInboundAttachmentDownloadError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async safeSendPlainText(
    config: ResolvedTelegramChannelRuntimeConfig,
    chatId: string,
    text: string
  ): Promise<boolean> {
    try {
      await this.telegramBotClientService.sendPlainText(config.botToken, chatId, text);
      return false;
    } catch (error) {
      const unauthorized = await this.handleUnauthorizedTelegramError(config.assistantId, error);
      if (!unauthorized) {
        this.logger.warn(
          `Telegram plain-text delivery failed for ${config.assistantId}: ${String(error)}`
        );
      }
      return unauthorized;
    }
  }

  private async replyWithTerminalTurnFailure(params: {
    config: ResolvedTelegramChannelRuntimeConfig;
    event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>;
    text: string;
    errorCode: string;
  }): Promise<TelegramWebhookHandleResult> {
    const unauthorized = await this.safeSendPlainText(
      params.config,
      params.event.chatId,
      params.text
    );
    await this.completeTelegramUpdateBestEffort(params.config.assistantId, params.event.updateId);
    return {
      statusCode: 200,
      body: {
        ok: false,
        error: unauthorized ? "invalid_bot_token" : params.errorCode
      }
    };
  }

  private async completeTelegramUpdateBestEffort(
    assistantId: string,
    updateId: number | null
  ): Promise<void> {
    if (updateId === null) {
      return;
    }
    try {
      await this.bindingRepository.completeTelegramUpdateProcessing(
        assistantId,
        "telegram",
        "telegram_bot",
        updateId,
        new Date()
      );
    } catch (error) {
      this.logger.warn(
        `[telegram-webhook] Non-fatal: failed to finalize Telegram update ${updateId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async handleUnauthorizedTelegramError(
    assistantId: string,
    error: unknown
  ): Promise<boolean> {
    if (!(error instanceof TelegramBotUnauthorizedError)) {
      return false;
    }
    await this.bindingRepository.patchMetadata(assistantId, "telegram", "telegram_bot", {
      telegramRuntimeHealth: "invalid_token",
      telegramRuntimeHealthUpdatedAt: new Date().toISOString(),
      telegramRuntimeHealthMessage: error.description
    });
    this.logger.warn(`Telegram bot token became invalid for assistant ${assistantId}.`);
    return true;
  }
}
