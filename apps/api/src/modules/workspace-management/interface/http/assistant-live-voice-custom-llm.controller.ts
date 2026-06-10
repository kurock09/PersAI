import { BadRequestException, Body, Controller, Inject, Post, Req, Res } from "@nestjs/common";
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

@Controller("api/v1/assistant/live-voice/custom-llm")
export class AssistantLiveVoiceCustomLlmController {
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
      if (session.status !== "active") {
        this.sendJsonError(res, 400, {
          code: "live_voice_session_not_active",
          message: "Live voice session is not active."
        });
        return;
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
    if (typeof model !== "string" || model.trim().length === 0) {
      throw new BadRequestException("model must be a non-empty string.");
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
