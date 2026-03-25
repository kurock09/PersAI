import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAssistantWebChatTurn } from "./assistant-api-client";

const ORIGINAL_FETCH = global.fetch;

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream"
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

describe("streamAssistantWebChatTurn", () => {
  it("rejects when the stream closes without a terminal event", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: started\ndata: ${JSON.stringify({ chat: { id: "chat-1" }, userMessage: { id: "msg-1" } })}\n\n`,
          `event: delta\ndata: ${JSON.stringify({ delta: "Hi", accumulated: "Hi" })}\n\n`
        ])
      ) as typeof fetch;

    await expect(
      streamAssistantWebChatTurn("token-1", { surfaceThreadKey: "thread-1", message: "Hello" }, {})
    ).rejects.toThrow("Stream closed before terminal event.");
  });

  it("accepts a terminal event even when the final block has no trailing delimiter", async () => {
    const onCompleted = vi.fn();
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: started\ndata: ${JSON.stringify({ chat: { id: "chat-1" }, userMessage: { id: "msg-1" } })}\n\n`,
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}`
        ])
      ) as typeof fetch;

    await expect(
      streamAssistantWebChatTurn(
        "token-1",
        { surfaceThreadKey: "thread-1", message: "Hello" },
        { onCompleted }
      )
    ).resolves.toBeUndefined();

    expect(onCompleted).toHaveBeenCalledWith({ transport: { mode: "sse" } });
  });
});
