import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { StreamWebChatTurnService } from "./stream-web-chat-turn.service";

type OpenAiChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: {
      role?: "assistant";
      content?: string;
    };
    finish_reason: "stop" | null;
  }>;
};

export type AssistantLiveVoiceCustomLlmStreamInput = {
  userId: string;
  surfaceThreadKey: string;
  model: string;
  message: string;
  isClientAborted: () => boolean;
  clientAbortSignal?: AbortSignal;
  writeFrame: (frame: string) => void;
};

@Injectable()
export class AssistantLiveVoiceCustomLlmService {
  constructor(private readonly streamWebChatTurnService: StreamWebChatTurnService) {}

  async streamChatCompletion(input: AssistantLiveVoiceCustomLlmStreamInput): Promise<void> {
    const completionId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    let closed = false;
    let emittedAssistantRole = false;

    const writeDone = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      input.writeFrame("data: [DONE]\n\n");
    };

    const writeChunk = (chunk: OpenAiChunk): void => {
      input.writeFrame(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    const writeAssistantDelta = (content: string): void => {
      if (content.length === 0) {
        return;
      }
      writeChunk({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: input.model,
        choices: [
          {
            index: 0,
            delta: emittedAssistantRole ? { content } : { role: "assistant", content },
            finish_reason: null
          }
        ]
      });
      emittedAssistantRole = true;
    };

    const writeStopChunk = (): void => {
      writeChunk({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: input.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop"
          }
        ]
      });
    };

    const preparation = await this.streamWebChatTurnService.prepare(input.userId, {
      surfaceThreadKey: input.surfaceThreadKey,
      message: input.message
    });

    if (preparation.mode === "replayed") {
      writeAssistantDelta(preparation.transport.assistantMessage.content);
      writeStopChunk();
      writeDone();
      return;
    }

    const outcome = await this.streamWebChatTurnService.streamToCompletion(preparation.prepared, {
      isClientAborted: input.isClientAborted,
      ...(input.clientAbortSignal === undefined
        ? {}
        : { clientAbortSignal: input.clientAbortSignal }),
      onDelta: (delta) => {
        writeAssistantDelta(delta);
      },
      onThinking: () => {
        // Voice transport must never expose hidden reasoning/thinking.
      },
      onDone: () => {
        writeStopChunk();
        writeDone();
      }
    });

    if (outcome.status !== "completed") {
      writeDone();
    }
  }
}
