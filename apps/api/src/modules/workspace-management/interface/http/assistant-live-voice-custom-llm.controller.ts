import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Logger,
  Post,
  Req,
  Res
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { AssistantLiveVoiceCustomLlmService } from "../../application/assistant-live-voice-custom-llm.service";
import { PlatformRuntimeProviderSecretStoreService } from "../../application/platform-runtime-provider-secret-store.service";
import { TOOL_CREDENTIAL_IDS } from "../../application/tool-credential-settings";
import type {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import type { AssistantChatRepository } from "../../domain/assistant-chat.repository";
import { ASSISTANT_CHAT_REPOSITORY } from "../../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

type OpenAiChatCompletionRequestMessage = {
  role?: unknown;
  content?: unknown;
};

type LiveVoiceCustomLlmRequestBody = {
  messages?: unknown;
  model?: unknown;
  elevenlabs_extra_body?: unknown;
};

type JsonError = {
  code: string;
  message: string;
};

const DEFAULT_ECHO_MODEL = "persai-live-voice";

// ElevenLabs drives the Custom LLM endpoint server-to-server for the full life of
// a live conversation. The browser client, however, marks the DB session
// `failed` the moment its (short) connect-timeout elapses — even though the
// underlying conversation is actually live — and a re-start `supersede`s the
// previous row. Hard-gating on `status === "active"` therefore drops the user to
// the ElevenLabs fallback model mid-conversation. We keep serving PersAI's brain
// for any transport-torn-down session within this bounded live window; only a
// clean, user-initiated stop ends it for good.
const SESSION_SERVABLE_GRACE_MS = 30 * 60 * 1000;

@Controller("api/v1/assistant/live-voice/custom-llm")
export class AssistantLiveVoiceCustomLlmController {
  private readonly logger = new Logger(AssistantLiveVoiceCustomLlmController.name);

  constructor(
    private readonly assistantLiveVoiceCustomLlmService: AssistantLiveVoiceCustomLlmService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  @Post("chat/completions")
  async streamChatCompletions(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Body() bodyRaw: unknown
  ): Promise<void> {
    try {
      const body = this.parseBody(bodyRaw);
      const ingressSecret = await this.resolveIngressSecret();
      const bearerToken = this.extractBearerToken(req.headers);
      if (!constantTimeEquals(bearerToken, ingressSecret)) {
        this.sendJsonError(res, 401, {
          code: "live_voice_custom_llm_unauthorized",
          message: "Invalid live voice Custom LLM ingress secret."
        });
        return;
      }

      const model = this.parseModel(body.model);
      const sessionId = this.parseSessionId(body.elevenlabs_extra_body);
      const session = await this.prisma.assistantLiveVoiceSession.findUnique({
        where: { id: sessionId }
      });
      if (session === null) {
        this.sendJsonError(res, 404, {
          code: "live_voice_session_not_found",
          message: "Live voice session not found."
        });
        return;
      }
      if (!isSessionServable(session)) {
        this.sendJsonError(res, 400, {
          code: "live_voice_session_not_active",
          message: "Live voice session is not active."
        });
        return;
      }
      if (session.status !== "active") {
        this.logger.warn(
          `Live voice Custom LLM serving non-active session ${session.id} (status=${String(session.status)}, failureCode=${session.failureCode ?? "-"}).`
        );
      }

      const chat = await this.assistantChatRepository.findChatById(session.chatId);
      if (
        chat === null ||
        chat.id !== session.chatId ||
        chat.userId !== session.userId ||
        chat.assistantId !== session.assistantId
      ) {
        this.sendJsonError(res, 404, {
          code: "live_voice_chat_not_found",
          message: "Live voice session chat was not found."
        });
        return;
      }

      const message = extractLatestUserMessageText(body.messages);
      if (message === null) {
        this.sendJsonError(res, 400, {
          code: "live_voice_user_message_required",
          message: "Request must include a user message."
        });
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let aborted = false;
      const abortController = new AbortController();
      const markAborted = (): void => {
        aborted = true;
        abortController.abort();
      };
      req.on("aborted", markAborted);
      res.on("close", () => {
        if (!res.writableEnded) {
          markAborted();
        }
      });

      let doneWritten = false;
      const writeFrame = (frame: string): void => {
        if (res.writableEnded) {
          return;
        }
        if (frame === "data: [DONE]\n\n") {
          doneWritten = true;
        }
        res.write(frame);
      };

      try {
        await this.assistantLiveVoiceCustomLlmService.streamChatCompletion({
          userId: session.userId,
          surfaceThreadKey: chat.surfaceThreadKey,
          model,
          message,
          isClientAborted: () => aborted,
          clientAbortSignal: abortController.signal,
          writeFrame
        });
      } catch {
        if (!doneWritten && !res.writableEnded) {
          res.write("data: [DONE]\n\n");
          doneWritten = true;
        }
      } finally {
        if (!doneWritten && !res.writableEnded) {
          res.write("data: [DONE]\n\n");
        }
        if (!res.writableEnded) {
          res.end();
        }
      }
    } catch (error) {
      const payload =
        error instanceof BadRequestException
          ? this.normalizeBadRequest(error)
          : {
              statusCode: 400,
              error: {
                code: "invalid_request",
                message: error instanceof Error ? error.message : "Invalid request."
              }
            };
      this.sendJsonError(res, payload.statusCode, payload.error);
    }
  }

  private parseBody(body: unknown): LiveVoiceCustomLlmRequestBody {
    if (body === null || typeof body !== "object") {
      throw new BadRequestException("Request body must be an object.");
    }
    return body as LiveVoiceCustomLlmRequestBody;
  }

  private parseModel(model: unknown): string {
    // `model` is only echoed back in the OpenAI-compatible response frames; it
    // never selects a model on our side (PersAI routes via the chat turn
    // service). ElevenLabs sends an empty/absent `model` when the agent's
    // Custom LLM "Model ID" field is left blank, so we default it instead of
    // rejecting the whole turn (which would silently drop the user to the
    // ElevenLabs fallback LLM).
    if (typeof model !== "string" || model.trim().length === 0) {
      return DEFAULT_ECHO_MODEL;
    }
    return model.trim();
  }

  private parseSessionId(extraBody: unknown): string {
    if (extraBody === null || typeof extraBody !== "object") {
      throw new BadRequestException(
        "elevenlabs_extra_body.persaiLiveVoiceSessionId must be provided."
      );
    }
    const sessionId = (extraBody as { persaiLiveVoiceSessionId?: unknown })
      .persaiLiveVoiceSessionId;
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new BadRequestException(
        "elevenlabs_extra_body.persaiLiveVoiceSessionId must be a non-empty string."
      );
    }
    return sessionId.trim();
  }

  private async resolveIngressSecret(): Promise<string> {
    try {
      const secret = await this.platformRuntimeProviderSecretStoreService.resolveSecretValueById(
        TOOL_CREDENTIAL_IDS.tool_live_voice_custom_llm_ingress
      );
      return secret.trim();
    } catch {
      return "";
    }
  }

  private extractBearerToken(headers: IncomingHttpHeaders): string {
    const raw = headers.authorization;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string" || !value.startsWith("Bearer ")) {
      return "";
    }
    return value.slice("Bearer ".length).trim();
  }

  private sendJsonError(
    res: ResponseWithPlatformContext,
    statusCode: number,
    error: JsonError
  ): void {
    // Custom LLM rejections cause ElevenLabs to silently fall back to its own
    // model, so log the precise reason to keep the failure observable.
    this.logger.warn(
      `Live voice Custom LLM request rejected: status=${String(statusCode)} code=${error.code} message=${error.message}`
    );
    if (res.writableEnded) {
      return;
    }
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(error));
  }

  private normalizeBadRequest(error: BadRequestException): {
    statusCode: number;
    error: JsonError;
  } {
    const response = error.getResponse();
    if (typeof response === "string") {
      return {
        statusCode: error.getStatus(),
        error: { code: "invalid_request", message: response }
      };
    }
    const record = response as Record<string, unknown>;
    const messageValue = record.message;
    const message =
      typeof messageValue === "string"
        ? messageValue
        : Array.isArray(messageValue) && typeof messageValue[0] === "string"
          ? messageValue[0]
          : "Invalid request.";
    return {
      statusCode: error.getStatus(),
      error: { code: "invalid_request", message }
    };
  }
}

export function isSessionServable(session: {
  status: string;
  failureCode?: string | null;
  startedAt?: Date | string | null;
}): boolean {
  if (session.status === "active") {
    return true;
  }
  const failureCode = session.failureCode ?? null;
  // A clean, user-initiated stop is recorded as `stopped` with no failure code.
  // That deliberately ends the conversation — never serve it again.
  if (session.status === "stopped" && failureCode === null) {
    return false;
  }
  // Otherwise the row was torn down by a transport artifact (client connect
  // timeout -> `failed`, or a re-start -> `superseded`) while the ElevenLabs
  // conversation is still live. Serve PersAI's brain within a bounded window.
  const startedAtMs =
    session.startedAt instanceof Date
      ? session.startedAt.getTime()
      : typeof session.startedAt === "string"
        ? Date.parse(session.startedAt)
        : Number.NaN;
  if (Number.isNaN(startedAtMs)) {
    return false;
  }
  return Date.now() - startedAtMs <= SESSION_SERVABLE_GRACE_MS;
}

function constantTimeEquals(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length === 0 || expectedBuffer.length === 0) {
    return false;
  }
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function extractTextFromMessageContent(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .flatMap((item) => {
      if (item === null || typeof item !== "object") {
        return [];
      }
      const record = item as { type?: unknown; text?: unknown };
      if (record.type !== "text" || typeof record.text !== "string") {
        return [];
      }
      return [record.text];
    })
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

export function extractLatestUserMessageText(messages: unknown): string | null {
  if (!Array.isArray(messages)) {
    throw new BadRequestException("messages must be an array.");
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as OpenAiChatCompletionRequestMessage | undefined;
    if (message?.role !== "user") {
      continue;
    }
    return extractTextFromMessageContent(message.content);
  }
  return null;
}
