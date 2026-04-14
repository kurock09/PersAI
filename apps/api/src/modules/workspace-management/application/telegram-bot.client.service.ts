import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_FACADE,
  describeRuntimeMediaArtifact,
  readRuntimeMediaArtifactFilename,
  type AssistantRuntimeFacade,
  type RuntimeMediaArtifact
} from "./assistant-runtime.facade";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import {
  buildTelegramHtmlMessageBodies,
  lossyPlainFromTelegramHtml
} from "./telegram-assistant-markdown-html";
import type { TelegramChatAction } from "./telegram-chat-actions";
import {
  splitTelegramOutboundText,
  TELEGRAM_BOT_API_MAX_MESSAGE_LENGTH
} from "./telegram-outbound-chunks";
import type { InternalTelegramTurnResult } from "./handle-internal-telegram-turn.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";

type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
};

export interface TelegramChatActionHeartbeat {
  setAction: (action: TelegramChatAction) => void;
  stop: () => void;
}

export class TelegramBotApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: number | null,
    readonly description: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(description);
    this.name = "TelegramBotApiError";
  }
}

export class TelegramBotUnauthorizedError extends TelegramBotApiError {
  constructor(description: string) {
    super(401, 401, description);
    this.name = "TelegramBotUnauthorizedError";
  }
}

function isTelegramEntityParseError(error: unknown): boolean {
  return (
    error instanceof TelegramBotApiError &&
    error.errorCode === 400 &&
    error.description.includes("can't parse entities")
  );
}

function hasVoiceReply(media: RuntimeMediaArtifact[]): boolean {
  return media.some((item) => item.type === "audio" && item.audioAsVoice === true);
}

function isMultipartFilePart(value: unknown): value is {
  buffer: Buffer;
  filename: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "buffer" in value &&
    "filename" in value &&
    value.buffer instanceof Buffer &&
    typeof value.filename === "string"
  );
}

@Injectable()
export class TelegramBotClientService {
  private readonly logger = new Logger(TelegramBotClientService.name);

  constructor(
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async downloadInboundFile(
    botToken: string,
    fileId: string
  ): Promise<{ buffer: Buffer; filePath: string }> {
    const file = await this.requestJson<{ file_path?: string }>(botToken, "getFile", {
      file_id: fileId
    });
    if (!file.file_path) {
      throw new TelegramBotApiError(502, null, "Telegram file_path is missing.");
    }
    const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`);
    if (!response.ok) {
      if (response.status === 401) {
        throw new TelegramBotUnauthorizedError("Telegram bot token is unauthorized.");
      }
      throw new TelegramBotApiError(
        response.status,
        response.status,
        `Failed to download Telegram file: HTTP ${response.status}`
      );
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      filePath: file.file_path
    };
  }

  async sendPlainText(botToken: string, chatId: string, text: string): Promise<void> {
    await this.sendReplyWithConfiguredParseMode(botToken, chatId, text, "plain_text");
  }

  async sendChatAction(
    botToken: string,
    chatId: string,
    action: TelegramChatAction
  ): Promise<void> {
    await this.requestJson(botToken, "sendChatAction", {
      chat_id: chatId,
      action
    });
  }

  startChatActionHeartbeat(params: {
    botToken: string;
    chatId: string;
    initialAction?: TelegramChatAction;
    intervalMs?: number;
  }): TelegramChatActionHeartbeat {
    let currentAction = params.initialAction ?? "typing";
    let stopped = false;
    let inFlight = false;
    const intervalMs = params.intervalMs ?? 4_000;

    const sendCurrentAction = async (): Promise<void> => {
      if (stopped || inFlight) {
        return;
      }
      inFlight = true;
      try {
        await this.sendChatAction(params.botToken, params.chatId, currentAction);
      } catch (error) {
        if (error instanceof TelegramBotUnauthorizedError) {
          stopped = true;
          return;
        }
        this.logger.debug(
          `Telegram chat action "${currentAction}" failed for ${params.chatId}: ${String(error)}`
        );
      } finally {
        inFlight = false;
      }
    };

    void sendCurrentAction();
    const timer = setInterval(() => {
      void sendCurrentAction();
    }, intervalMs);
    timer.unref?.();

    return {
      setAction: (action) => {
        if (stopped || currentAction === action) {
          return;
        }
        currentAction = action;
        void sendCurrentAction();
      },
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        clearInterval(timer);
      }
    };
  }

  async sendReplyWithConfiguredParseMode(
    botToken: string,
    chatId: string,
    reply: string,
    parseMode: string
  ): Promise<void> {
    if (reply.length === 0) {
      return;
    }

    if (parseMode !== "markdown") {
      const chunks = splitTelegramOutboundText(reply, TELEGRAM_BOT_API_MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        await this.requestJson(botToken, "sendMessage", {
          chat_id: chatId,
          text: chunk
        });
      }
      return;
    }

    const bodies = buildTelegramHtmlMessageBodies(reply, TELEGRAM_BOT_API_MAX_MESSAGE_LENGTH);
    for (const body of bodies) {
      try {
        await this.requestJson(botToken, "sendMessage", {
          chat_id: chatId,
          text: body,
          parse_mode: "HTML"
        });
      } catch (error) {
        if (!isTelegramEntityParseError(error)) {
          throw error;
        }
        this.logger.warn("Telegram HTML parse failed, retrying as plain text.");
        await this.requestJson(botToken, "sendMessage", {
          chat_id: chatId,
          text: lossyPlainFromTelegramHtml(body)
        });
      }
    }
  }

  async sendAssistantTurnReply(params: {
    botToken: string;
    chatId: string;
    assistantId: string;
    parseMode: string;
    turnResult: InternalTelegramTurnResult;
    onBeforeMediaSend?: ((media: RuntimeMediaArtifact[]) => Promise<void> | void) | undefined;
    postReplyNotices?: string[] | undefined;
  }): Promise<void> {
    if (params.turnResult.deduplicated === true) {
      return;
    }

    if (!hasVoiceReply(params.turnResult.media)) {
      await this.sendReplyWithConfiguredParseMode(
        params.botToken,
        params.chatId,
        params.turnResult.assistantMessage,
        params.parseMode
      );
    }

    if (params.turnResult.media.length > 0) {
      await params.onBeforeMediaSend?.(params.turnResult.media);
      const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
        params.assistantId
      );
      for (const item of params.turnResult.media) {
        try {
          const downloaded =
            item.source === "persai_object_storage"
              ? await this.mediaObjectStorage.downloadObject(item.objectKey)
              : await this.assistantRuntime.downloadChatMedia(
                  params.assistantId,
                  item.url,
                  runtimeTier
                );
          if (!downloaded) {
            this.logger.warn(
              `Telegram outbound media not found: ${describeRuntimeMediaArtifact(item)}`
            );
            continue;
          }
          const filename = readRuntimeMediaArtifactFilename(item) ?? "media";
          await this.sendMedia({
            botToken: params.botToken,
            chatId: params.chatId,
            artifact: item,
            buffer: downloaded.buffer,
            filename
          });
        } catch (error) {
          this.logger.warn(
            `Failed to send Telegram media "${describeRuntimeMediaArtifact(item)}": ${String(error)}`
          );
        }
      }
    }

    for (const notice of params.postReplyNotices ?? []) {
      await this.sendReplyWithConfiguredParseMode(
        params.botToken,
        params.chatId,
        notice,
        params.parseMode
      );
    }
  }

  private async sendMedia(params: {
    botToken: string;
    chatId: string;
    artifact: RuntimeMediaArtifact;
    buffer: Buffer;
    filename: string;
  }): Promise<void> {
    const endpoint =
      params.artifact.type === "image"
        ? "sendPhoto"
        : params.artifact.type === "audio" && params.artifact.audioAsVoice
          ? "sendVoice"
          : params.artifact.type === "audio"
            ? "sendAudio"
            : params.artifact.type === "video"
              ? "sendVideo"
              : "sendDocument";
    const fileField =
      endpoint === "sendPhoto"
        ? "photo"
        : endpoint === "sendVoice"
          ? "voice"
          : endpoint === "sendAudio"
            ? "audio"
            : endpoint === "sendVideo"
              ? "video"
              : "document";
    await this.requestMultipart(params.botToken, endpoint, {
      chat_id: params.chatId,
      [fileField]: {
        buffer: params.buffer,
        filename: params.filename
      }
    });
  }

  private async requestJson<T>(
    botToken: string,
    method: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let body: TelegramApiEnvelope<T> | null = null;
    try {
      body = (await response.json()) as TelegramApiEnvelope<T>;
    } catch {
      body = null;
    }

    if (!response.ok || body?.ok === false) {
      throw this.toApiError(response.status, body, `Telegram API ${method} failed.`);
    }

    if (body?.result === undefined) {
      throw new TelegramBotApiError(
        502,
        null,
        `Telegram API ${method} returned an invalid response.`
      );
    }

    return body.result;
  }

  private async requestMultipart(
    botToken: string,
    method: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const formData = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      if (isMultipartFilePart(value)) {
        formData.set(key, new Blob([new Uint8Array(value.buffer)]), value.filename);
        continue;
      }
      if (value !== undefined && value !== null) {
        formData.set(key, String(value));
      }
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      body: formData
    });

    let body: TelegramApiEnvelope<unknown> | null = null;
    try {
      body = (await response.json()) as TelegramApiEnvelope<unknown>;
    } catch {
      body = null;
    }

    if (!response.ok || body?.ok === false) {
      throw this.toApiError(response.status, body, `Telegram API ${method} failed.`);
    }
  }

  private toApiError(
    status: number,
    body: TelegramApiEnvelope<unknown> | null,
    fallbackDescription: string
  ): TelegramBotApiError {
    const description = body?.description ?? fallbackDescription;
    const errorCode = body?.error_code ?? (status > 0 ? status : null);
    const retryAfterMs =
      typeof body?.parameters?.retry_after === "number"
        ? Math.ceil(body.parameters.retry_after * 1000)
        : null;
    if (status === 401 || errorCode === 401) {
      return new TelegramBotUnauthorizedError(description);
    }
    return new TelegramBotApiError(status, errorCode, description, retryAfterMs);
  }
}
