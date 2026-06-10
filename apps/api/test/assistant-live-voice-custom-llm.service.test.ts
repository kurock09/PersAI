import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AssistantLiveVoiceCustomLlmService } from "../src/modules/workspace-management/application/assistant-live-voice-custom-llm.service";
import {
  AssistantLiveVoiceCustomLlmController,
  extractLatestUserMessageText
} from "../src/modules/workspace-management/interface/http/assistant-live-voice-custom-llm.controller";

class MockResponse extends EventEmitter {
  statusCode = 200;
  writableEnded = false;
  readonly headers = new Map<string, string>();
  readonly writes: string[] = [];

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  end(chunk?: string): void {
    if (chunk !== undefined) {
      this.writes.push(chunk);
    }
    this.writableEnded = true;
  }
}

class MockRequest extends EventEmitter {
  constructor(readonly headers: Record<string, string | string[] | undefined> = {}) {
    super();
  }
}

function parseSseJsonFrames(writes: string[]): Array<Record<string, unknown>> {
  return writes
    .filter((entry) => entry.startsWith("data: {"))
    .map((entry) => JSON.parse(entry.slice("data: ".length).trim()));
}

async function runServiceTests(): Promise<void> {
  {
    const calls: Array<Record<string, unknown>> = [];
    const service = new AssistantLiveVoiceCustomLlmService({
      async prepare(userId: string, request: Record<string, unknown>) {
        calls.push({ phase: "prepare", userId, request });
        return {
          mode: "prepared",
          prepared: { ok: true }
        };
      },
      async streamToCompletion(
        prepared: Record<string, unknown>,
        callbacks: {
          onThinking: (delta: string, accumulated: string) => void;
          onDelta: (delta: string, accumulated: string) => void;
          onDone: () => void;
        }
      ) {
        calls.push({ phase: "stream", prepared });
        callbacks.onThinking("hidden", "hidden");
        callbacks.onDelta("Hel", "Hel");
        callbacks.onDelta("lo", "Hello");
        callbacks.onDone();
        return { status: "completed" };
      }
    } as never);
    const frames: string[] = [];
    await service.streamChatCompletion({
      userId: "user-1",
      surfaceThreadKey: "web-thread-1",
      model: "gpt-test",
      message: "last user utterance",
      isClientAborted: () => false,
      writeFrame: (frame) => frames.push(frame)
    });

    assert.deepEqual(calls[0], {
      phase: "prepare",
      userId: "user-1",
      request: {
        surfaceThreadKey: "web-thread-1",
        message: "last user utterance"
      }
    });
    assert.equal(calls[1]?.phase, "stream");

    const chunks = parseSseJsonFrames(frames);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]?.object, "chat.completion.chunk");
    assert.equal(chunks[0]?.model, "gpt-test");
    assert.deepEqual(chunks[0]?.choices, [
      {
        index: 0,
        delta: { role: "assistant", content: "Hel" },
        finish_reason: null
      }
    ]);
    assert.deepEqual(chunks[1]?.choices, [
      {
        index: 0,
        delta: { content: "lo" },
        finish_reason: null
      }
    ]);
    assert.deepEqual(chunks[2]?.choices, [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ]);
    assert.equal(frames.at(-1), "data: [DONE]\n\n");
    assert.equal(
      frames.some((frame) => frame.includes("hidden")),
      false,
      "thinking frames must never be emitted"
    );
  }

  {
    const service = new AssistantLiveVoiceCustomLlmService({
      async prepare() {
        return {
          mode: "replayed",
          transport: {
            assistantMessage: {
              content: "Replayed answer"
            }
          }
        };
      }
    } as never);
    const frames: string[] = [];
    await service.streamChatCompletion({
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      model: "gpt-test",
      message: "ignored",
      isClientAborted: () => false,
      writeFrame: (frame) => frames.push(frame)
    });
    const chunks = parseSseJsonFrames(frames);
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0]?.choices, [
      {
        index: 0,
        delta: { role: "assistant", content: "Replayed answer" },
        finish_reason: null
      }
    ]);
    assert.equal(frames.at(-1), "data: [DONE]\n\n");
  }

  {
    let observedAborted = false;
    let observedSignal = false;
    const controller = new AbortController();
    const service = new AssistantLiveVoiceCustomLlmService({
      async prepare() {
        return {
          mode: "prepared",
          prepared: { ok: true }
        };
      },
      async streamToCompletion(
        _prepared: Record<string, unknown>,
        callbacks: {
          isClientAborted: () => boolean;
          clientAbortSignal?: AbortSignal;
        }
      ) {
        controller.abort();
        observedAborted = callbacks.isClientAborted();
        observedSignal = callbacks.clientAbortSignal?.aborted === true;
        return { status: "interrupted" };
      }
    } as never);
    const frames: string[] = [];
    await service.streamChatCompletion({
      userId: "user-1",
      surfaceThreadKey: "thread-1",
      model: "gpt-test",
      message: "abort me",
      isClientAborted: () => controller.signal.aborted,
      clientAbortSignal: controller.signal,
      writeFrame: (frame) => frames.push(frame)
    });
    assert.equal(observedAborted, true);
    assert.equal(observedSignal, true);
    assert.equal(frames.at(-1), "data: [DONE]\n\n");
  }
}

async function runControllerTests(): Promise<void> {
  {
    const controller = new AssistantLiveVoiceCustomLlmController(
      {
        async streamChatCompletion() {
          throw new Error("should not be called");
        }
      } as never,
      {
        async resolveSecretValueById() {
          return "expected-secret";
        }
      } as never,
      {
        assistantLiveVoiceSession: {
          async findUnique() {
            return null;
          }
        }
      } as never,
      {
        async findChatById() {
          return null;
        }
      } as never
    );
    const req = new MockRequest({ authorization: "Bearer wrong-secret" });
    const res = new MockResponse();
    await controller.streamChatCompletions(req as never, res as never, {
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      elevenlabs_extra_body: { persaiLiveVoiceSessionId: "session-1" }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers.get("Content-Type"), "application/json");
    assert.match(res.writes.join(""), /live_voice_custom_llm_unauthorized/);
  }

  {
    const controller = new AssistantLiveVoiceCustomLlmController(
      {
        async streamChatCompletion() {
          throw new Error("should not be called");
        }
      } as never,
      {
        async resolveSecretValueById() {
          return "expected-secret";
        }
      } as never,
      {
        assistantLiveVoiceSession: {
          async findUnique() {
            return null;
          }
        }
      } as never,
      {
        async findChatById() {
          return null;
        }
      } as never
    );
    const req = new MockRequest({ authorization: "Bearer expected-secret" });
    const res = new MockResponse();
    await controller.streamChatCompletions(req as never, res as never, {
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      elevenlabs_extra_body: { persaiLiveVoiceSessionId: "missing-session" }
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.writes.join(""), /live_voice_session_not_found/);
  }

  {
    const controller = new AssistantLiveVoiceCustomLlmController(
      {
        async streamChatCompletion() {
          throw new Error("should not be called");
        }
      } as never,
      {
        async resolveSecretValueById() {
          return "expected-secret";
        }
      } as never,
      {
        assistantLiveVoiceSession: {
          async findUnique() {
            return {
              id: "session-1",
              userId: "user-1",
              chatId: "chat-1",
              status: "stopped"
            };
          }
        }
      } as never,
      {
        async findChatById() {
          return { id: "chat-1", surfaceThreadKey: "thread-1" };
        }
      } as never
    );
    const req = new MockRequest({ authorization: "Bearer expected-secret" });
    const res = new MockResponse();
    await controller.streamChatCompletions(req as never, res as never, {
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      elevenlabs_extra_body: { persaiLiveVoiceSessionId: "session-1" }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.writes.join(""), /live_voice_session_not_active/);
  }

  {
    // A recently-started session that the client marked `failed` via its
    // connect-timeout (while the ElevenLabs conversation is actually live) must
    // still be served, so the agent never silently falls back to its own model.
    let served = false;
    const controller = new AssistantLiveVoiceCustomLlmController(
      {
        async streamChatCompletion(input: { writeFrame: (frame: string) => void }) {
          served = true;
          input.writeFrame("data: [DONE]\n\n");
        }
      } as never,
      {
        async resolveSecretValueById() {
          return "expected-secret";
        }
      } as never,
      {
        assistantLiveVoiceSession: {
          async findUnique() {
            return {
              id: "session-1",
              assistantId: "assistant-1",
              userId: "user-1",
              chatId: "chat-1",
              status: "failed",
              failureCode: "live_voice_connection_failed",
              startedAt: new Date()
            };
          }
        }
      } as never,
      {
        async findChatById() {
          return {
            id: "chat-1",
            assistantId: "assistant-1",
            userId: "user-1",
            surfaceThreadKey: "thread-surface-key"
          };
        }
      } as never
    );
    const req = new MockRequest({ authorization: "Bearer expected-secret" });
    const res = new MockResponse();
    await controller.streamChatCompletions(req as never, res as never, {
      model: "gpt-test",
      messages: [{ role: "user", content: "still talking" }],
      elevenlabs_extra_body: { persaiLiveVoiceSessionId: "session-1" }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(served, true);
  }

  {
    // A `failed` session older than the live window is no longer served.
    const controller = new AssistantLiveVoiceCustomLlmController(
      {
        async streamChatCompletion() {
          throw new Error("should not be called");
        }
      } as never,
      {
        async resolveSecretValueById() {
          return "expected-secret";
        }
      } as never,
      {
        assistantLiveVoiceSession: {
          async findUnique() {
            return {
              id: "session-1",
              assistantId: "assistant-1",
              userId: "user-1",
              chatId: "chat-1",
              status: "failed",
              failureCode: "live_voice_connection_failed",
              startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
            };
          }
        }
      } as never,
      {
        async findChatById() {
          return { id: "chat-1", surfaceThreadKey: "thread-1" };
        }
      } as never
    );
    const req = new MockRequest({ authorization: "Bearer expected-secret" });
    const res = new MockResponse();
    await controller.streamChatCompletions(req as never, res as never, {
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      elevenlabs_extra_body: { persaiLiveVoiceSessionId: "session-1" }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.writes.join(""), /live_voice_session_not_active/);
  }

  {
    let serviceInput: {
      userId: string;
      surfaceThreadKey: string;
      model: string;
      message: string;
    } | null = null;
    const controller = new AssistantLiveVoiceCustomLlmController(
      {
        async streamChatCompletion(input: {
          userId: string;
          surfaceThreadKey: string;
          model: string;
          message: string;
          writeFrame: (frame: string) => void;
        }) {
          serviceInput = {
            userId: input.userId,
            surfaceThreadKey: input.surfaceThreadKey,
            model: input.model,
            message: input.message
          };
          input.writeFrame(`data: ${JSON.stringify({ ok: true })}\n\n`);
          input.writeFrame("data: [DONE]\n\n");
        }
      } as never,
      {
        async resolveSecretValueById() {
          return "expected-secret";
        }
      } as never,
      {
        assistantLiveVoiceSession: {
          async findUnique() {
            return {
              id: "session-1",
              assistantId: "assistant-1",
              userId: "user-1",
              chatId: "chat-1",
              status: "active"
            };
          }
        }
      } as never,
      {
        async findChatById() {
          return {
            id: "chat-1",
            assistantId: "assistant-1",
            userId: "user-1",
            surfaceThreadKey: "thread-surface-key"
          };
        }
      } as never
    );
    const req = new MockRequest({ authorization: "Bearer expected-secret" });
    const res = new MockResponse();
    await controller.streamChatCompletions(req as never, res as never, {
      model: "gpt-test",
      messages: [
        { role: "system", content: "ignore" },
        { role: "user", content: "first user" },
        { role: "assistant", content: "ignore assistant" },
        { role: "user", content: "last spoken utterance" }
      ],
      elevenlabs_extra_body: { persaiLiveVoiceSessionId: "session-1" }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
    assert.equal(serviceInput?.userId, "user-1");
    assert.equal(serviceInput?.surfaceThreadKey, "thread-surface-key");
    assert.equal(serviceInput?.message, "last spoken utterance");
    assert.equal(res.writes.at(-1), "data: [DONE]\n\n");

    // An absent `model` (ElevenLabs sends it empty when the agent's Custom LLM
    // Model ID is blank) must NOT reject the turn; it defaults to an echo model
    // so the user is not silently dropped to the ElevenLabs fallback LLM.
    serviceInput = null;
    const resNoModel = new MockResponse();
    await controller.streamChatCompletions(
      new MockRequest({ authorization: "Bearer expected-secret" }) as never,
      resNoModel as never,
      {
        messages: [{ role: "user", content: "no model field" }],
        elevenlabs_extra_body: { persaiLiveVoiceSessionId: "session-1" }
      }
    );
    assert.equal(resNoModel.statusCode, 200);
    assert.equal((serviceInput as { model: string } | null)?.model, "persai-live-voice");
  }

  {
    let observedAbort = false;
    let observedSignal = false;
    const req = new MockRequest({ authorization: "Bearer expected-secret" });
    const res = new MockResponse();
    const controller = new AssistantLiveVoiceCustomLlmController(
      {
        async streamChatCompletion(input: {
          clientAbortSignal?: AbortSignal;
          isClientAborted: () => boolean;
          writeFrame: (frame: string) => void;
        }) {
          // By the time the controller delegates to the service it has already
          // registered its req "aborted" listener, so emitting here exercises the
          // real wiring: barge-in must flip isClientAborted() and abort the signal.
          req.emit("aborted");
          observedAbort = input.isClientAborted();
          observedSignal = input.clientAbortSignal?.aborted === true;
          input.writeFrame("data: [DONE]\n\n");
        }
      } as never,
      {
        async resolveSecretValueById() {
          return "expected-secret";
        }
      } as never,
      {
        assistantLiveVoiceSession: {
          async findUnique() {
            return {
              id: "session-1",
              assistantId: "assistant-1",
              userId: "user-1",
              chatId: "chat-1",
              status: "active"
            };
          }
        }
      } as never,
      {
        async findChatById() {
          return {
            id: "chat-1",
            assistantId: "assistant-1",
            userId: "user-1",
            surfaceThreadKey: "thread-surface-key"
          };
        }
      } as never
    );
    await controller.streamChatCompletions(req as never, res as never, {
      model: "gpt-test",
      messages: [{ role: "user", content: "interrupt me" }],
      elevenlabs_extra_body: { persaiLiveVoiceSessionId: "session-1" }
    });
    assert.equal(observedAbort, true);
    assert.equal(observedSignal, true);
    assert.equal(res.writes.at(-1), "data: [DONE]\n\n");
  }
}

function runHelperTests(): void {
  assert.equal(
    extractLatestUserMessageText([
      { role: "assistant", content: "ignore" },
      { role: "user", content: "hello" },
      { role: "user", content: "last" }
    ]),
    "last"
  );
  assert.equal(
    extractLatestUserMessageText([
      {
        role: "user",
        content: [
          { type: "text", text: "hello " },
          { type: "input_audio", audio: "ignore" },
          { type: "text", text: "world" }
        ]
      }
    ]),
    "hello world"
  );
}

async function run(): Promise<void> {
  runHelperTests();
  await runServiceTests();
  await runControllerTests();
  console.log("assistant-live-voice-custom-llm.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
