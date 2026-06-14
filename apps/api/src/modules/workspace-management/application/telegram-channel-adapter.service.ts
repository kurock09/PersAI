import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeChannelContext } from "@persai/runtime-contract";
import type { RawInboundAttachment } from "./media/media.types";
import { HandleInternalTelegramTurnService } from "./handle-internal-telegram-turn.service";
import {
  ResolveTelegramChannelRuntimeConfigService,
  type ResolvedTelegramChannelRuntimeConfig
} from "./resolve-telegram-channel-runtime-config.service";
import { rotateTelegramSessionMetadata } from "./telegram-integration.metadata";
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
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
  type AssistantChannelSurfaceBindingRepository
} from "../domain/assistant-channel-surface-binding.repository";
import { RenderAssistantInboundSurfaceMessageService } from "./render-assistant-inbound-surface-message.service";
import { toAssistantInboundFailurePayload } from "./assistant-inbound-error";
import { MediaDeliveryService } from "./media/media-delivery.service";
import {
  applyFinalDeliveryHonestyCorrection,
  resolveUndeliveredArtifactKind
} from "./final-delivery-honesty";
import { NotificationDeliveryWorkerService } from "./notifications/notification-delivery-worker.service";
import { TelegramAlbumCollectorService } from "./telegram-album-collector.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import {
  buildTelegramAlbumFallbackMessage,
  type ClaimedTelegramAlbumCollector,
  type TelegramAlbumFinalizeOutcome,
  type TelegramAlbumPart
} from "./telegram-album.types";

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
      telegramMessageId: number | null;
      chatId: string;
      chatType: TelegramChatType;
      chatTitle: string | null;
      telegramUserId: number | null;
      telegramUsername: string | null;
      telegramFirstName?: string | null;
      telegramLastName?: string | null;
      fromBot?: boolean;
      mediaGroupId: string | null;
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

function toBoolean(value: unknown): boolean {
  return value === true;
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

function resolveTelegramSenderDisplayName(
  event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>
): string | null {
  const displayName = [event.telegramFirstName, event.telegramLastName]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ")
    .trim();
  if (displayName.length > 0) {
    return displayName;
  }
  return event.telegramUsername;
}

function buildTelegramTurnChannelContext(params: {
  event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>;
  accessMode: ResolvedTelegramChannelRuntimeConfig["accessMode"];
}): RuntimeChannelContext {
  return {
    telegram: {
      schema: "persai.runtime.telegramContext.v1",
      chat: {
        id: params.event.chatId,
        type: params.event.chatType,
        title: params.event.chatTitle
      },
      sender: {
        telegramUserId:
          params.event.telegramUserId === null ? null : String(params.event.telegramUserId),
        username: params.event.telegramUsername,
        firstName: params.event.telegramFirstName ?? null,
        lastName: params.event.telegramLastName ?? null,
        displayName: resolveTelegramSenderDisplayName(params.event)
      },
      accessMode: params.accessMode
    }
  };
}

function buildTelegramMessageMetadata(params: {
  event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>;
  accessMode: ResolvedTelegramChannelRuntimeConfig["accessMode"];
}): Record<string, unknown> {
  return {
    schema: "persai.chatMessage.telegramMetadata.v1",
    telegram: {
      chatId: params.event.chatId,
      chatType: params.event.chatType,
      chatTitle: params.event.chatTitle,
      messageId: params.event.telegramMessageId,
      updateId: params.event.updateId,
      fromUserId: params.event.telegramUserId === null ? null : String(params.event.telegramUserId),
      fromUsername: params.event.telegramUsername,
      fromFirstName: params.event.telegramFirstName ?? null,
      fromLastName: params.event.telegramLastName ?? null,
      fromDisplayName: resolveTelegramSenderDisplayName(params.event),
      accessMode: params.accessMode
    }
  };
}

function buildTelegramAutoCompactionNotice(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "После этого ответа старый контекст был автоматически сжат, чтобы уложиться в бюджет контекста тарифа."
    : "Older context was auto-compacted after this reply to stay within your plan's context budget.";
}

function buildTelegramCompactionQueueNotice(
  locale: "ru" | "en",
  kind: "compacted" | "exhausted"
): string {
  if (kind === "exhausted") {
    return locale === "ru"
      ? "Я уже сжимаю этот чат слишком слабо. Лучше начать новый чат."
      : "I am no longer shrinking this chat enough. It is better to start a new chat.";
  }
  return locale === "ru"
    ? "Готово, контекст сжал. Продолжаем."
    : "Done, I compacted the context. Let's continue.";
}

function buildTelegramNewSessionStartedReply(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "Начала новый чат с чистым контекстом. Следующее сообщение продолжу уже в новой сессии."
    : "Started a fresh chat with clean context. I will continue from your next message in the new session.";
}

export function normalizeTelegramTextIntent(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/new(?:@\w+)?$/i, "/new")
    .replace(/[!?.:,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTelegramNewSessionRequest(params: {
  event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>;
}): boolean {
  if (params.event.turnKind !== "text" || params.event.chatType !== "private") {
    return false;
  }
  const normalized = normalizeTelegramTextIntent(params.event.incomingText);
  return (
    normalized === "/new" ||
    normalized === "new chat" ||
    normalized === "start new chat" ||
    normalized === "start a new chat" ||
    normalized === "новый чат" ||
    normalized === "начни новый чат" ||
    normalized === "начать новый чат"
  );
}

export function buildTelegramRuntimeThreadKey(chatId: string, sessionThreadKey: string): string {
  if (sessionThreadKey === "default_session") {
    return chatId;
  }
  return `telegram:${chatId}:session:${sessionThreadKey}`;
}

function evaluateTelegramPrivateOwnerGate(params: {
  currentConfig: ResolvedTelegramChannelRuntimeConfig;
  incomingText: string;
  telegramUserId: number | null;
}): {
  allowed: boolean;
  claimNow: boolean;
  replyText: string | null;
} {
  const { currentConfig, incomingText, telegramUserId } = params;
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

export function extractTelegramWebhookEvent(
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

  const mediaGroupId = toStringOrNull(message.media_group_id);

  const base = {
    kind: "message" as const,
    updateId,
    telegramMessageId: toNumberOrNull(message.message_id),
    chatId,
    chatType: normalizedChatType,
    chatTitle: toStringOrNull(chat.title),
    telegramUserId: toNumberOrNull(from?.id),
    telegramUsername: toStringOrNull(from?.username),
    telegramFirstName: toStringOrNull(from?.first_name),
    telegramLastName: toStringOrNull(from?.last_name),
    fromBot: toBoolean(from?.is_bot),
    mediaGroupId,
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
    private readonly notificationDeliveryWorkerService: NotificationDeliveryWorkerService,
    private readonly telegramAlbumCollectorService: TelegramAlbumCollectorService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY)
    private readonly bindingRepository: AssistantChannelSurfaceBindingRepository
  ) {}

  async finalizeCollectedAlbum(
    claimed: ClaimedTelegramAlbumCollector
  ): Promise<TelegramAlbumFinalizeOutcome> {
    const config = await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(
      claimed.assistantId
    );
    if (config === null || !config.inbound || !config.outbound) {
      this.logger.warn(
        `Skipping Telegram album finalize for ${claimed.assistantId}/${claimed.mediaGroupId}: channel unavailable.`
      );
      return "skipped";
    }

    const caption = claimed.caption?.trim() ?? "";
    const userMessage =
      caption.length > 0 ? caption : buildTelegramAlbumFallbackMessage(config.locale);
    const primaryTurnKind = claimed.parts.some((part) => part.turnKind === "document")
      ? "document"
      : "photo";
    const event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }> = {
      kind: "message",
      updateId: null,
      telegramMessageId: null,
      chatId: claimed.telegramChatId,
      chatType: claimed.telegramChatType,
      chatTitle: null,
      telegramUserId: Number.isFinite(Number(claimed.telegramUserId))
        ? Number(claimed.telegramUserId)
        : null,
      telegramUsername: null,
      telegramFirstName: null,
      telegramLastName: null,
      fromBot: false,
      mediaGroupId: claimed.mediaGroupId,
      incomingText: caption,
      replyToUserId: null,
      turnKind: primaryTurnKind,
      userMessage,
      attachment: null
    };

    const turnOutcome = await this.executeInboundMessageTurn({
      config,
      event,
      loadRawAttachments: async () => this.buildRawAttachmentsFromAlbumParts(config, claimed.parts)
    });
    return turnOutcome.kind === "ok" ? "ok" : "failed";
  }

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

    if (event.fromBot === true) {
      return { statusCode: 200, body: { ok: true } };
    }

    if (event.turnKind === "text" && shouldIgnoreGroupText({ event, config })) {
      return { statusCode: 200, body: { ok: true } };
    }

    const accessGate = await this.evaluateTelegramAccessGate({ config, event });

    if (accessGate.claimNow) {
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

    if (!accessGate.allowed) {
      if (accessGate.replyText) {
        const unauthorized = await this.safeSendPlainText(
          config,
          event.chatId,
          accessGate.replyText
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

    if (event.mediaGroupId !== null && event.attachment !== null) {
      const albumUpdateClaim = await this.claimTelegramUpdateIfNeeded(
        config.assistantId,
        event.updateId
      );
      if (albumUpdateClaim !== "claimed") {
        return { statusCode: 200, body: { ok: true } };
      }
      try {
        const resolved =
          await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
            config.assistantId
          );
        const runtimeThreadKey = buildTelegramRuntimeThreadKey(
          event.chatId,
          config.sessionThreadKey
        );
        const chat = await this.assistantChatRepository.findOrCreateChatBySurfaceThread({
          assistantId: resolved.assistantId,
          userId: resolved.userId,
          workspaceId: resolved.workspaceId,
          surface: "telegram",
          surfaceThreadKey: runtimeThreadKey,
          title: null
        });
        const appendOutcome = await this.telegramAlbumCollectorService.appendPart({
          assistantId: config.assistantId,
          workspaceId: config.workspaceId,
          chatId: chat.id,
          telegramChatId: event.chatId,
          telegramChatType: event.chatType,
          telegramUserId:
            event.telegramUserId !== null ? String(event.telegramUserId) : event.chatId,
          mediaGroupId: event.mediaGroupId,
          caption: event.incomingText.trim().length > 0 ? event.incomingText : null,
          part: {
            fileId: event.attachment.fileId,
            mimeType: event.attachment.mimeType,
            originalFilename: event.attachment.originalFilename,
            turnKind: event.turnKind === "document" ? "document" : "photo"
          }
        });
        if (appendOutcome === "ignored") {
          this.logger.warn(
            `Ignored late Telegram album part for ${config.assistantId}/${event.mediaGroupId} (collector no longer collecting).`
          );
        }
        await this.completeTelegramUpdateBestEffort(config.assistantId, event.updateId);
        return { statusCode: 200, body: { ok: true } };
      } catch (error) {
        await this.releaseTelegramUpdateClaimBestEffort(config.assistantId, event.updateId);
        throw error;
      }
    }

    if (isTelegramNewSessionRequest({ event })) {
      const updateClaim = await this.claimTelegramUpdateIfNeeded(
        config.assistantId,
        event.updateId
      );
      if (updateClaim !== "claimed") {
        return { statusCode: 200, body: { ok: true } };
      }
      try {
        const binding = await this.bindingRepository.findByAssistantProviderSurface(
          config.assistantId,
          "telegram",
          "telegram_bot"
        );
        if (binding !== null) {
          await this.bindingRepository.patchMetadata(
            config.assistantId,
            "telegram",
            "telegram_bot",
            rotateTelegramSessionMetadata(binding.metadata)
          );
        }
        this.logger.log({
          event: "telegram.session.rotated",
          assistantId: config.assistantId,
          telegramChatId: event.chatId,
          trigger: normalizeTelegramTextIntent(event.incomingText)
        });
        const unauthorized = await this.safeSendPlainText(
          config,
          event.chatId,
          buildTelegramNewSessionStartedReply(config.locale)
        );
        if (unauthorized) {
          return { statusCode: 200, body: { ok: false, error: "invalid_bot_token" } };
        }
        await this.completeTelegramUpdateBestEffort(config.assistantId, event.updateId);
        return { statusCode: 200, body: { ok: true } };
      } catch (error) {
        await this.releaseTelegramUpdateClaimBestEffort(config.assistantId, event.updateId);
        throw error;
      }
    }

    const turnOutcome = await this.executeInboundMessageTurn({
      config,
      event,
      loadRawAttachments: async () => this.buildRawAttachments(config, event)
    });
    if (turnOutcome.kind === "ok") {
      return { statusCode: 200, body: { ok: true } };
    }
    return turnOutcome.result;
  }

  private async evaluateTelegramAccessGate(params: {
    config: ResolvedTelegramChannelRuntimeConfig;
    event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>;
  }): Promise<{
    allowed: boolean;
    claimNow: boolean;
    replyText: string | null;
  }> {
    const { config, event } = params;
    if (event.chatType === "private") {
      return evaluateTelegramPrivateOwnerGate({
        currentConfig: config,
        incomingText: event.incomingText,
        telegramUserId: event.telegramUserId
      });
    }

    if (config.accessMode === "group_members") {
      const activeGroup = await this.syncTelegramGroupMembershipService.hasActiveGroup({
        assistantId: config.assistantId,
        telegramChatId: event.chatId
      });
      return {
        allowed: activeGroup,
        claimNow: false,
        replyText: null
      };
    }

    if (
      config.ownerClaimStatus === "claimed" &&
      config.ownerTelegramUserId !== null &&
      event.telegramUserId !== null &&
      config.ownerTelegramUserId === event.telegramUserId
    ) {
      return { allowed: true, claimNow: false, replyText: null };
    }

    return {
      allowed: false,
      claimNow: false,
      replyText:
        config.ownerClaimStatus === "claimed"
          ? buildTelegramUnauthorizedUserReply(config.locale)
          : null
    };
  }

  private async executeInboundMessageTurn(params: {
    config: ResolvedTelegramChannelRuntimeConfig;
    event: Extract<ParsedTelegramWebhookEvent, { kind: "message" }>;
    loadRawAttachments: () => Promise<RawInboundAttachment[]>;
  }): Promise<{ kind: "ok" } | { kind: "failure"; result: TelegramWebhookHandleResult }> {
    const { config, event } = params;
    let turnResult;
    const chatActionState: { current: TelegramChatActionHeartbeat | null } = {
      current: null
    };
    try {
      const conversationIdentity = toTelegramConversationIdentity(event);
      const runtimeThreadKey = buildTelegramRuntimeThreadKey(event.chatId, config.sessionThreadKey);
      turnResult = await this.handleInternalTelegramTurnService.execute({
        assistantId: config.assistantId,
        threadId: runtimeThreadKey,
        conversationMode: conversationIdentity.mode,
        externalUserKey: conversationIdentity.externalUserKey,
        message: event.userMessage,
        channelContext: buildTelegramTurnChannelContext({
          event,
          accessMode: config.accessMode
        }),
        messageMetadata: buildTelegramMessageMetadata({
          event,
          accessMode: config.accessMode
        }),
        updateId: event.updateId,
        hasAttachments: event.attachment !== null || event.mediaGroupId !== null,
        loadRawAttachments: params.loadRawAttachments,
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
        return {
          kind: "failure",
          result: { statusCode: 200, body: { ok: false, error: "invalid_bot_token" } }
        };
      }
      if (error instanceof TelegramInboundAttachmentDownloadError) {
        return {
          kind: "failure",
          result: await this.replyWithTerminalTurnFailure({
            config,
            event,
            text: fallbackTurnFailureCopy(event.turnKind),
            errorCode: "attachment_download_failed"
          })
        };
      }
      const failure = toAssistantInboundFailurePayload(error, config.locale);
      this.logger.warn(
        `[telegram-turn] inbound turn failed assistantId=${config.assistantId} chatId=${event.chatId} updateId=${String(event.updateId ?? "none")} code=${failure.code}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      const fallbackMessage =
        failure.message.trim().length > 0
          ? failure.message
          : fallbackTurnFailureCopy(event.turnKind);
      const outboundMessage = this.renderAssistantInboundSurfaceMessageService.renderError(
        "telegram",
        failure.code,
        failure.guidance !== null ? `${fallbackMessage}\n\n${failure.guidance}` : fallbackMessage,
        config.locale,
        { reasonCode: failure.reasonCode }
      );
      return {
        kind: "failure",
        result: await this.replyWithTerminalTurnFailure({
          config,
          event,
          text: outboundMessage.text,
          errorCode: failure.code
        })
      };
    }

    if (turnResult.deduplicated) {
      chatActionState.current?.stop();
      return { kind: "ok" };
    }

    let mediaDeliveryCompleted = false;
    let outboundTurnResult = turnResult;
    try {
      let deliveredAttachmentCount = 0;
      let deliveredAttachmentFilenames: string[] = [];
      let externalDeliveryCount = 0;
      if (turnResult.media.length > 0 && !turnResult.deduplicated) {
        const deliveredMedia = await this.mediaDeliveryService.deliver({
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
        mediaDeliveryCompleted = true;
        deliveredAttachmentCount = deliveredMedia.attachments.length;
        externalDeliveryCount = 0;
        deliveredAttachmentFilenames = deliveredMedia.attachments
          .map((attachment) => attachment.originalFilename)
          .filter(
            (filename): filename is string =>
              typeof filename === "string" && filename.trim().length > 0
          );
        if (deliveredAttachmentCount < turnResult.media.length) {
          this.logger.warn(
            `Telegram media delivery incomplete for ${config.assistantId}: delivered ${deliveredAttachmentCount}/${turnResult.media.length} artifact(s).`
          );
        }
        if (deliveredAttachmentCount === 0 && externalDeliveryCount === 0) {
          outboundTurnResult = { ...turnResult, media: [] };
        }
      }

      const finalAssistantMessage = applyFinalDeliveryHonestyCorrection({
        assistantText: turnResult.assistantMessage,
        attemptedArtifactCount: turnResult.media.length,
        deliveredAttachmentCount: deliveredAttachmentCount + externalDeliveryCount,
        deliveredAttachmentFilenames,
        attemptedArtifactKind: resolveUndeliveredArtifactKind(turnResult.media),
        locale: config.locale
      });
      if (
        finalAssistantMessage !== turnResult.assistantMessage ||
        (turnResult.media.length > 0 &&
          deliveredAttachmentCount === 0 &&
          externalDeliveryCount === 0)
      ) {
        outboundTurnResult = {
          ...outboundTurnResult,
          assistantMessage: finalAssistantMessage
        };
      }
      if (
        finalAssistantMessage !== turnResult.assistantMessage &&
        turnResult.assistantMessageId.trim().length > 0
      ) {
        const updated = await this.assistantChatRepository.updateMessageContent(
          turnResult.assistantMessageId,
          config.assistantId,
          finalAssistantMessage
        );
        if (updated === null) {
          this.logger.warn(
            `Failed to persist final delivery-honesty correction for Telegram assistant message "${turnResult.assistantMessageId}".`
          );
        }
      }

      await this.telegramBotClientService.sendAssistantTurnReply({
        botToken: config.botToken,
        chatId: event.chatId,
        assistantId: config.assistantId,
        parseMode: config.parseMode,
        turnResult: outboundTurnResult,
        mediaAlreadyDelivered: deliveredAttachmentCount > 0,
        postReplyNotices: [
          ...(typeof outboundTurnResult.compactionQueueNoticeKind === "string" &&
          outboundTurnResult.compactionQueueNoticeKind.length > 0 &&
          !(
            outboundTurnResult.compactionQueueNoticeKind === "exhausted" &&
            typeof outboundTurnResult.compactionAdvisoryFollowUpIntentId === "string" &&
            outboundTurnResult.compactionAdvisoryFollowUpIntentId.length > 0
          )
            ? [
                buildTelegramCompactionQueueNotice(
                  config.locale,
                  outboundTurnResult.compactionQueueNoticeKind
                )
              ]
            : []),
          ...(outboundTurnResult.autoCompaction === undefined ||
          (typeof outboundTurnResult.compactionAdvisoryFollowUpIntentId === "string" &&
            outboundTurnResult.compactionAdvisoryFollowUpIntentId.length > 0)
            ? []
            : [buildTelegramAutoCompactionNotice(config.locale)])
        ],
        onBeforeMediaSend: (media) => {
          chatActionState.current?.setAction(resolveTelegramOutboundChatAction(media));
        }
      });
      await this.completeTelegramUpdateBestEffort(config.assistantId, event.updateId);
      if (
        typeof outboundTurnResult.quotaAdvisoryFollowUpIntentId === "string" &&
        outboundTurnResult.quotaAdvisoryFollowUpIntentId.length > 0
      ) {
        await this.notificationDeliveryWorkerService.deliverIntentNow(
          outboundTurnResult.quotaAdvisoryFollowUpIntentId
        );
      }
      if (
        typeof outboundTurnResult.compactionAdvisoryFollowUpIntentId === "string" &&
        outboundTurnResult.compactionAdvisoryFollowUpIntentId.length > 0
      ) {
        await this.notificationDeliveryWorkerService.deliverIntentNow(
          outboundTurnResult.compactionAdvisoryFollowUpIntentId
        );
      }
    } catch (error) {
      chatActionState.current?.stop();
      await this.releaseTelegramUpdateClaimBestEffort(config.assistantId, event.updateId);
      if (turnResult.media.length > 0 && !turnResult.deduplicated && !mediaDeliveryCompleted) {
        await this.mediaDeliveryService.markUndeliveredArtifactsReconciliationRequired({
          assistantId: config.assistantId,
          artifacts: turnResult.media,
          reason: "telegram_delivery_not_completed"
        });
      }
      if (await this.handleUnauthorizedTelegramError(config.assistantId, error)) {
        return {
          kind: "failure",
          result: { statusCode: 200, body: { ok: false, error: "invalid_bot_token" } }
        };
      }
      this.logger.warn(
        `Telegram outbound delivery failed for ${config.assistantId}: ${String(error)}`
      );
      return {
        kind: "failure",
        result: { statusCode: 200, body: { ok: false, error: "telegram_delivery_failed" } }
      };
    }
    chatActionState.current?.stop();

    return { kind: "ok" };
  }

  private async buildRawAttachmentsFromAlbumParts(
    config: ResolvedTelegramChannelRuntimeConfig,
    parts: TelegramAlbumPart[]
  ): Promise<RawInboundAttachment[]> {
    const attachments: RawInboundAttachment[] = [];
    for (const part of parts) {
      try {
        const downloaded = await this.telegramBotClientService.downloadInboundFile(
          config.botToken,
          part.fileId
        );
        attachments.push({
          buffer: downloaded.buffer,
          mime: part.mimeType,
          originalFilename:
            part.originalFilename ??
            downloaded.filePath.split("/").pop() ??
            `telegram-${part.turnKind}`,
          source: "telegram_download"
        });
      } catch (error) {
        if (error instanceof TelegramBotUnauthorizedError) {
          throw error;
        }
        throw new TelegramInboundAttachmentDownloadError(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    return attachments;
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

  private async claimTelegramUpdateIfNeeded(
    assistantId: string,
    updateId: number | null
  ): Promise<"claimed" | "duplicate_handled" | "duplicate_inflight" | "missing_binding"> {
    if (updateId === null) {
      return "claimed";
    }
    try {
      const outcome = await this.bindingRepository.claimTelegramUpdateProcessing(
        assistantId,
        "telegram",
        "telegram_bot",
        updateId,
        new Date(),
        120_000
      );
      if (outcome === "duplicate_handled" || outcome === "duplicate_inflight") {
        this.logger.log(
          `[telegram-webhook] Dropped duplicate Telegram update ${updateId} for assistant ${assistantId} (${outcome})`
        );
      }
      return outcome;
    } catch (error) {
      this.logger.warn(
        `[telegram-webhook] Failed to claim Telegram update ${updateId} for assistant ${assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "missing_binding";
    }
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

  private async releaseTelegramUpdateClaimBestEffort(
    assistantId: string,
    updateId: number | null
  ): Promise<void> {
    if (updateId === null) {
      return;
    }
    try {
      await this.bindingRepository.releaseTelegramUpdateProcessing(
        assistantId,
        "telegram",
        "telegram_bot",
        updateId
      );
    } catch (error) {
      this.logger.warn(
        `[telegram-webhook] Non-fatal: failed to release Telegram update ${updateId}: ${
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
