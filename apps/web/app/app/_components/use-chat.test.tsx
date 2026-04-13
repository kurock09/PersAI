import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use-chat";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  compactChat: vi.fn(),
  getChatCompactionState: vi.fn(),
  getChatMessages: vi.fn(),
  stageWebChatAttachment: vi.fn(),
  streamAssistantWebChatTurn: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("../assistant-api-client", async () => {
  const actual =
    await vi.importActual<typeof import("../assistant-api-client")>("../assistant-api-client");
  return {
    ...actual,
    compactChat: assistantApiMocks.compactChat,
    getChatCompactionState: assistantApiMocks.getChatCompactionState,
    getChatMessages: assistantApiMocks.getChatMessages,
    stageWebChatAttachment: assistantApiMocks.stageWebChatAttachment,
    streamAssistantWebChatTurn: assistantApiMocks.streamAssistantWebChatTurn
  };
});

describe("useChat", () => {
  const rafCallbacks = new Map<number, FrameRequestCallback>();
  let nextRafId = 1;

  beforeEach(() => {
    clerkMocks.getToken.mockResolvedValue("token-1");
    assistantApiMocks.compactChat.mockReset();
    assistantApiMocks.getChatCompactionState.mockReset();
    assistantApiMocks.getChatMessages.mockReset();
    assistantApiMocks.stageWebChatAttachment.mockReset();
    assistantApiMocks.streamAssistantWebChatTurn.mockReset();
    nextRafId = 1;
    rafCallbacks.clear();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextRafId++;
        rafCallbacks.set(id, callback);
        return id;
      })
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        rafCallbacks.delete(id);
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rafCallbacks.clear();
  });

  it("flushes buffered assistant text before tool activity is shown", async () => {
    const streamGate: { release: () => void } = {
      release: () => undefined
    };
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onTool?: (payload: {
            phase: "start" | "end";
            toolName: string;
            toolCallId: string;
            isError: boolean;
          }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onDelta?.({ delta: "Preface " });
        handlers.onTool?.({
          phase: "start",
          toolName: "summarize_context",
          toolCallId: "tool-1",
          isError: false
        });
        await new Promise<void>((resolve) => {
          streamGate.release = resolve;
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send("Hello");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([
        expect.objectContaining({
          kind: "message",
          message: expect.objectContaining({
            role: "user",
            content: "Hello"
          })
        }),
        expect.objectContaining({
          kind: "message",
          message: expect.objectContaining({
            role: "assistant",
            content: "Preface "
          })
        }),
        expect.objectContaining({
          kind: "activity",
          event: expect.objectContaining({
            label: "Using summarize_context"
          })
        })
      ]);
    });
    expect(rafCallbacks.size).toBe(0);

    streamGate.release();
    await act(async () => {
      if (sendPromise !== undefined) {
        await sendPromise;
      }
    });
  });
});
