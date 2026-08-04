import { act, renderHook, waitFor } from "@testing-library/react";
import { ContractsApiError } from "@persai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use-chat";
import { StreamingThreadsProvider } from "./streaming-threads";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  compactChat: vi.fn(),
  getAssistantWebChatTurnStatus: vi.fn(),
  getChatCompactionState: vi.fn(),
  getChatMessages: vi.fn(),
  getAssistantWebChatPlan: vi.fn(),
  reattachAssistantWebChatTurnStream: vi.fn(),
  streamAssistantWebChatContinuationDiscovery: vi.fn(),
  stageWebChatAttachment: vi.fn(),
  uploadAssistantKnowledgeSource: vi.fn(),
  streamAssistantWebChatTurn: vi.fn(),
  stopAssistantWebChatTurn: vi.fn()
}));

const browserBridgeMocks = vi.hoisted(() => ({
  isNativeBrowserBridgeShell: vi.fn(),
  getCachedCurrentLocalBrowserBridgeStatus: vi.fn(),
  getCurrentLocalBrowserBridgeStatus: vi.fn()
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
    getAssistantWebChatTurnStatus: assistantApiMocks.getAssistantWebChatTurnStatus,
    getChatCompactionState: assistantApiMocks.getChatCompactionState,
    getChatMessages: assistantApiMocks.getChatMessages,
    getAssistantWebChatPlan: assistantApiMocks.getAssistantWebChatPlan,
    reattachAssistantWebChatTurnStream: assistantApiMocks.reattachAssistantWebChatTurnStream,
    streamAssistantWebChatContinuationDiscovery:
      assistantApiMocks.streamAssistantWebChatContinuationDiscovery,
    stageWebChatAttachment: assistantApiMocks.stageWebChatAttachment,
    uploadAssistantKnowledgeSource: assistantApiMocks.uploadAssistantKnowledgeSource,
    streamAssistantWebChatTurn: assistantApiMocks.streamAssistantWebChatTurn,
    stopAssistantWebChatTurn: assistantApiMocks.stopAssistantWebChatTurn
  };
});

vi.mock("../browser-bridge-client", () => ({
  isNativeBrowserBridgeShell: browserBridgeMocks.isNativeBrowserBridgeShell,
  getCachedCurrentLocalBrowserBridgeStatus:
    browserBridgeMocks.getCachedCurrentLocalBrowserBridgeStatus,
  getCurrentLocalBrowserBridgeStatus: browserBridgeMocks.getCurrentLocalBrowserBridgeStatus
}));

const CHAT_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

describe("useChat", () => {
  const rafCallbacks = new Map<number, FrameRequestCallback>();
  let nextRafId = 1;

  function createCompactionState(
    overrides?: Partial<{
      available: boolean;
      suggested: boolean;
      suggestionReason: "token_threshold" | "history_threshold" | null;
      exhaustedAtPlanLimit: boolean;
      recentAutoCompactionStreak: number;
      messageCount: number;
      assistantMessageCount: number;
      currentTokens: number | null;
      sessionKey: string | null;
      compactionCount: number;
      lastCompactedAt: string | null;
      reserveTokens: number;
      keepRecentTokens: number;
      autoCompactionEnabled: boolean;
    }>
  ) {
    return {
      available: true,
      suggested: false,
      suggestionReason: null,
      exhaustedAtPlanLimit: false,
      recentAutoCompactionStreak: 0,
      messageCount: 12,
      assistantMessageCount: 6,
      currentTokens: 7_800,
      sessionKey: null,
      compactionCount: 0,
      lastCompactedAt: null,
      reserveTokens: 24_000,
      keepRecentTokens: 16_000,
      autoCompactionEnabled: false,
      ...overrides
    };
  }

  function createHistoryImageAttachment(id: string) {
    return {
      id,
      path: `${CHAT_SESSION_ROOT}/${id}.png`,
      thumbnailStoragePath: `${CHAT_SESSION_ROOT}/${id}.thumb.png`,
      posterStoragePath: null,
      attachmentType: "image" as const,
      originalFilename: `${id}.png`,
      mimeType: "image/png",
      sizeBytes: 1024,
      processingStatus: "ready" as const,
      createdAt: "2026-04-14T10:00:00.000Z"
    };
  }

  beforeEach(() => {
    window.sessionStorage.clear();
    clerkMocks.getToken.mockReset();
    clerkMocks.getToken.mockResolvedValue("token-1");
    assistantApiMocks.compactChat.mockReset();
    assistantApiMocks.getAssistantWebChatTurnStatus.mockReset();
    assistantApiMocks.getChatCompactionState.mockReset();
    assistantApiMocks.getChatMessages.mockReset();
    assistantApiMocks.getAssistantWebChatPlan.mockReset();
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockReset();
    assistantApiMocks.streamAssistantWebChatContinuationDiscovery.mockReset();
    assistantApiMocks.stageWebChatAttachment.mockReset();
    assistantApiMocks.uploadAssistantKnowledgeSource.mockReset();
    assistantApiMocks.streamAssistantWebChatTurn.mockReset();
    assistantApiMocks.stopAssistantWebChatTurn.mockReset();
    browserBridgeMocks.isNativeBrowserBridgeShell.mockReset();
    browserBridgeMocks.getCachedCurrentLocalBrowserBridgeStatus.mockReset();
    browserBridgeMocks.getCurrentLocalBrowserBridgeStatus.mockReset();
    browserBridgeMocks.isNativeBrowserBridgeShell.mockReturnValue(false);
    browserBridgeMocks.getCachedCurrentLocalBrowserBridgeStatus.mockReturnValue(null);
    browserBridgeMocks.getCurrentLocalBrowserBridgeStatus.mockRejectedValue(
      new Error("bridge unavailable")
    );
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "unknown",
      chat: null,
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });
    // Default empty page (not mockResolvedValueOnce). Late in-flight
    // getChatMessages from a prior test under full parallel load must not
    // throw on undefined or steal the next test's Once queue.
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      messages: [],
      activeMediaJobs: [],
      activeDocumentJobs: [],
      activeSandboxJobs: []
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: { onTurnStatus?: (payload: unknown) => void }
      ) => {
        const turn = await assistantApiMocks.getAssistantWebChatTurnStatus("token-1", clientTurnId);
        handlers.onTurnStatus?.({ turn });
      }
    );
    assistantApiMocks.streamAssistantWebChatContinuationDiscovery.mockResolvedValue(undefined);
    assistantApiMocks.stopAssistantWebChatTurn.mockResolvedValue(undefined);
    assistantApiMocks.getAssistantWebChatPlan.mockResolvedValue({
      requestId: "r0",
      chatId: "",
      todos: [],
      windowed: false,
      totalCount: 0
    });
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

  afterEach(async () => {
    vi.useRealTimers();
    // Do not vi.restoreAllMocks(): hoisted assistantApiMocks are shared across
    // the file, and restore + late in-flight getChatMessages/stream calls from
    // the previous test land after the next beforeEach mockReset, shifting
    // Once queues and inflating toHaveBeenCalledTimes under parallel load.
    vi.unstubAllGlobals();
    rafCallbacks.clear();
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    assistantApiMocks.getChatMessages.mockClear();
    assistantApiMocks.streamAssistantWebChatTurn.mockClear();
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockClear();
    assistantApiMocks.getAssistantWebChatTurnStatus.mockClear();
    clerkMocks.getToken.mockClear();
  });

  it("sends a valid Russian title for the first welcome chat", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: "welcome-assistant-1",
              content: "Привет!"
            }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("welcome"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.sendWelcome("ru");
    });

    expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledWith(
      "token-1",
      expect.objectContaining({
        title: "Добро пожаловать",
        welcomeTurn: true,
        welcomeLocale: "ru"
      }),
      expect.any(Object),
      expect.any(AbortSignal)
    );
  });

  it("carries the connected Capacitor bridge device on the current turn", async () => {
    browserBridgeMocks.isNativeBrowserBridgeShell.mockReturnValue(true);
    browserBridgeMocks.getCurrentLocalBrowserBridgeStatus.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "mobile-device-1"
    });
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onCompleted?.({
          transport: {
            assistantMessage: { id: "assistant-message-1", content: "Done" }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1", { assistantId: "assistant-1" }), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.send("Open mail");
    });

    expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledWith(
      "token-1",
      expect.objectContaining({
        bridgeDeviceId: "mobile-device-1",
        bridgeDeviceKind: "capacitor"
      }),
      expect.any(Object),
      expect.any(AbortSignal)
    );
  });

  it("ADR-170 D5.2.1 replaces the live turn tail addressed with a null message id", async () => {
    let releaseStream: (() => void) | undefined;
    let clearTail: (() => void) | undefined;
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onTextTail?: (payload: { messageId: string | null; text: string }) => void;
        }
      ) => {
        handlers.onTextTail?.({ messageId: null, text: "Прив" });
        handlers.onTextTail?.({ messageId: null, text: "Привет" });
        clearTail = () => handlers.onTextTail?.({ messageId: null, text: "" });
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send("Hello");
      await Promise.resolve();
    });

    await waitFor(() => {
      const assistant = result.current.messages.find((message) => message.role === "assistant");
      expect(assistant?.textTail).toBe("Привет");
    });

    await act(async () => {
      clearTail?.();
    });

    await waitFor(() => {
      const assistant = result.current.messages.find((message) => message.role === "assistant");
      expect(assistant?.textTail).toBe("");
    });

    await act(async () => {
      releaseStream?.();
      await sendPromise;
    });
  });

  it("carries the connected extension device on a desktop turn", async () => {
    browserBridgeMocks.getCachedCurrentLocalBrowserBridgeStatus.mockReturnValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "extension-device-1"
    });
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onCompleted?.({
          transport: {
            assistantMessage: { id: "assistant-message-1", content: "Done" }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1", { assistantId: "assistant-1" }), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.send("Open mail");
    });

    expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledWith(
      "token-1",
      expect.objectContaining({
        bridgeDeviceId: "extension-device-1",
        bridgeDeviceKind: "extension"
      }),
      expect.any(Object),
      expect.any(AbortSignal)
    );
  });

  it("rechecks a cached disconnected extension before starting the turn", async () => {
    browserBridgeMocks.getCachedCurrentLocalBrowserBridgeStatus.mockReturnValue({
      connected: false,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "extension-device-1"
    });
    browserBridgeMocks.getCurrentLocalBrowserBridgeStatus.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "extension-device-1"
    });
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onCompleted?.({
          transport: {
            assistantMessage: { id: "assistant-message-1", content: "Done" }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1", { assistantId: "assistant-1" }), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.send("Open mail");
    });

    expect(browserBridgeMocks.getCurrentLocalBrowserBridgeStatus).toHaveBeenCalledWith(1_200);
    expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledWith(
      "token-1",
      expect.objectContaining({
        bridgeDeviceId: "extension-device-1",
        bridgeDeviceKind: "extension"
      }),
      expect.any(Object),
      expect.any(AbortSignal)
    );
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

  it("reconciles the final assistant text from terminal completed transport", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onDelta?.({ delta: "Hello" });
        handlers.onCompleted?.({
          transport: {
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            assistantMessage: {
              id: "assistant-msg-1",
              content: "Hello, full final answer",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Hello");
    });

    const assistantEntry = [...result.current.entries]
      .reverse()
      .find(
        (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "message" }> =>
          entry.kind === "message" && entry.message.role === "assistant"
      );

    expect(assistantEntry?.message.content).toBe("Hello, full final answer");
    expect(assistantEntry?.message.status).toBe("committed");
    expect(assistantEntry?.message.id).toBe("assistant-msg-1");
  });

  it("uses the completed transport body", async () => {
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
            isError: boolean;
          }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onDelta?.({ delta: "Проверяю сайт." });
        handlers.onTool?.({ phase: "start", toolName: "web_search", isError: false });
        handlers.onDelta?.({ delta: "Итоговый ответ" });
        handlers.onCompleted?.({
          transport: {
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            assistantMessage: {
              id: "assistant-msg-1",
              content: "Итоговый ответ",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Hello");
    });

    const assistantEntry = result.current.entries.find(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "message" }> =>
        entry.kind === "message" && entry.message.role === "assistant"
    );

    expect(assistantEntry?.message.content).toBe("Итоговый ответ");
  });

  it("keeps primary stream ownership when focus status returns running before completed", async () => {
    let releaseStream: (() => void) | null = null;
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onHeadersOk?: () => void;
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onDelta?.({ delta: "First " });
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
        handlers.onDelta?.({ delta: "Second " });
        handlers.onCompleted?.({
          transport: {
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            assistantMessage: {
              id: "assistant-msg-1",
              content: "First Second final",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: { id: "chat-1" },
      userMessage: {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "Hello",
        attachments: [],
        createdAt: "2026-04-30T21:21:09.000Z"
      },
      assistantMessage: {
        id: "active-assistant-from-status",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant",
        content: "First ",
        attachments: [],
        createdAt: "2026-04-30T21:21:10.000Z"
      },
      currentActivity: null,
      runtime: null,
      error: null
    });
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: {
        clientTurnId: "client-turn-1",
        status: "running",
        chat: { id: "chat-1" },
        userMessage: {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "Hello",
          attachments: [],
          createdAt: "2026-04-30T21:21:09.000Z"
        },
        assistantMessage: {
          id: "active-assistant-from-status",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "First ",
          attachments: [],
          createdAt: "2026-04-30T21:21:10.000Z"
        },
        currentActivity: null
      },
      messages: [
        {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "Hello",
          attachments: [],
          createdAt: "2026-04-30T21:21:09.000Z"
        }
      ]
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send("Hello", undefined, { clientTurnId: "client-turn-1" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalledWith(
        "token-1",
        "client-turn-1"
      );
    });

    await act(async () => {
      releaseStream?.();
      if (sendPromise !== undefined) {
        await sendPromise;
      }
    });

    const assistants = result.current.messages.filter((message) => message.role === "assistant");
    expect(assistants).toEqual([
      expect.objectContaining({
        id: "assistant-msg-1",
        content: "First Second final",
        status: "committed"
      })
    ]);
    expect(result.current.messages.map((message) => message.id)).not.toContain(
      "active-assistant-from-status"
    );
    expect(result.current.isStreaming).toBe(false);
  });

  it("does not copy old assistant attachments onto a running pending bubble during status refresh", async () => {
    let releaseStream: (() => void) | null = null;
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onHeadersOk?: () => void;
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onDelta?.({ delta: "Сделала запрос.\n\n4 картинки сейчас готовятся отдельно." });
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
        handlers.onCompleted?.({
          transport: {
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            assistantMessage: {
              id: "assistant-msg-1",
              content: "Сделала запрос.\n\n4 картинки сейчас готовятся отдельно.",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: { id: "chat-1" },
      userMessage: {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "раздели на 4 отдельных картинки и добавь красок",
        attachments: [],
        createdAt: "2026-06-01T00:20:00.000Z"
      },
      assistantMessage: {
        id: "older-committed-assistant",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant",
        content: "Исходник уже был отправлен раньше",
        attachments: [
          {
            id: "att-old-image",
            path: `${CHAT_SESSION_ROOT}/source-collage.png`,
            thumbnailStoragePath: `${CHAT_SESSION_ROOT}/source-collage.thumb.png`,
            posterStoragePath: null,
            attachmentType: "image",
            originalFilename: "source-collage.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            processingStatus: "ready",
            createdAt: "2026-06-01T00:19:00.000Z"
          }
        ],
        createdAt: "2026-06-01T00:19:01.000Z"
      },
      currentActivity: null,
      runtime: null,
      error: null
    });
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: {
        clientTurnId: "client-turn-attachments",
        status: "running",
        chat: { id: "chat-1" },
        userMessage: {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "раздели на 4 отдельных картинки и добавь красок",
          attachments: [],
          createdAt: "2026-06-01T00:20:00.000Z"
        },
        assistantMessage: {
          id: "older-committed-assistant",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Исходник уже был отправлен раньше",
          attachments: [
            {
              id: "att-old-image",
              path: `${CHAT_SESSION_ROOT}/source-collage.png`,
              thumbnailStoragePath: `${CHAT_SESSION_ROOT}/source-collage.thumb.png`,
              posterStoragePath: null,
              attachmentType: "image",
              originalFilename: "source-collage.png",
              mimeType: "image/png",
              sizeBytes: 2048,
              processingStatus: "ready",
              createdAt: "2026-06-01T00:19:00.000Z"
            }
          ],
          createdAt: "2026-06-01T00:19:01.000Z"
        },
        currentActivity: null
      },
      messages: [
        {
          id: "older-committed-assistant",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Исходник уже был отправлен раньше",
          attachments: [
            {
              id: "att-old-image",
              path: `${CHAT_SESSION_ROOT}/source-collage.png`,
              thumbnailStoragePath: `${CHAT_SESSION_ROOT}/source-collage.thumb.png`,
              posterStoragePath: null,
              attachmentType: "image",
              originalFilename: "source-collage.png",
              mimeType: "image/png",
              sizeBytes: 2048,
              processingStatus: "ready",
              createdAt: "2026-06-01T00:19:00.000Z"
            }
          ],
          createdAt: "2026-06-01T00:19:01.000Z"
        },
        {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "раздели на 4 отдельных картинки и добавь красок",
          attachments: [],
          createdAt: "2026-06-01T00:20:00.000Z"
        }
      ]
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send(
        "раздели на 4 отдельных картинки и добавь красок",
        undefined,
        {
          clientTurnId: "client-turn-attachments"
        }
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => {
      const liveAssistant = result.current.messages.find(
        (message) => message.role === "assistant" && message.status === "streaming"
      );
      expect(liveAssistant).toBeDefined();
      expect(liveAssistant?.attachments).toBeUndefined();
    });

    await act(async () => {
      releaseStream?.();
      if (sendPromise !== undefined) {
        await sendPromise;
      }
    });
  });

  it("does not restore the primary local assistant after completed history replaces it", async () => {
    let releaseStream: (() => void) | null = null;
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onHeadersOk?: () => void;
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onDelta?.({ delta: "Visible streaming text " });
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
        handlers.onCompleted?.({
          transport: {
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            assistantMessage: {
              id: "assistant-msg-1",
              content: "Visible streaming text final",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );

    const completedHistory = {
      nextCursor: null,
      activeTurn: null,
      messages: [
        {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "Hello",
          attachments: [],
          createdAt: "2026-04-30T21:21:09.000Z"
        },
        {
          id: "assistant-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Visible streaming text final",
          attachments: [],
          createdAt: "2026-04-30T21:21:10.000Z"
        }
      ]
    };
    assistantApiMocks.getChatMessages.mockResolvedValue(completedHistory);

    const { result, rerender } = renderHook(
      ({ threadKey }: { threadKey: string }) => useChat(threadKey),
      {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>,
        initialProps: { threadKey: "thread-1" }
      }
    );

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send("Hello", undefined, { clientTurnId: "client-turn-1" });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(
      result.current.messages.some((message) => message.id.startsWith("local-assistant-"))
    ).toBe(true);

    await act(async () => {
      releaseStream?.();
      if (sendPromise !== undefined) {
        await sendPromise;
      }
    });
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "user-msg-1",
      "assistant-msg-1"
    ]);

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    rerender({ threadKey: "thread-2" });
    rerender({ threadKey: "thread-1" });

    const ids = result.current.messages.map((message) => message.id);
    expect(ids).toEqual(["user-msg-1", "assistant-msg-1"]);
    expect(result.current.messages.filter((message) => message.role === "assistant")).toHaveLength(
      1
    );
    expect(result.current.messages.some((message) => message.status === "streaming")).toBe(false);
    expect(ids.some((id) => id.startsWith("local-assistant-"))).toBe(false);
  });

  it("restores activeMediaJobs from cached thread state after switch-back", async () => {
    const activeMediaJobs = [
      {
        id: "job-1",
        kind: "image",
        operation: "image_generate",
        status: "queued",
        createdAt: "2026-05-05T09:00:00.000Z",
        startedAt: null,
        updatedAt: "2026-05-05T09:00:00.000Z"
      }
    ];
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeMediaJobs,
      messages: []
    });
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onCompleted?.({
          transport: {
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            assistantMessage: {
              id: "assistant-msg-1",
              content: "I queued it."
            },
            activeMediaJobs
          }
        });
      }
    );

    const { result, rerender } = renderHook(
      ({ threadKey }: { threadKey: string }) => useChat(threadKey),
      {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>,
        initialProps: { threadKey: "thread-1" }
      }
    );

    await act(async () => {
      await result.current.send("Generate an image");
    });

    expect(result.current.activeMediaJobs).toEqual(activeMediaJobs);

    rerender({ threadKey: "thread-2" });
    rerender({ threadKey: "thread-1" });

    await waitFor(() => {
      expect(result.current.activeMediaJobs).toEqual(activeMediaJobs);
    });
  });

  it("refreshes history while activeDocumentJobs are present even without media jobs", async () => {
    vi.useFakeTimers();
    assistantApiMocks.getChatMessages
      .mockResolvedValueOnce({
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: [
          {
            id: "doc-job-1",
            documentType: "presentation",
            descriptorMode: "create_presentation",
            status: "running",
            createdAt: "2026-05-16T19:12:52.000Z",
            startedAt: "2026-05-16T19:12:53.000Z",
            updatedAt: "2026-05-16T19:12:53.000Z"
          }
        ],
        messages: []
      })
      .mockResolvedValue({
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: [],
        messages: []
      });

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.activeDocumentJobs).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(assistantApiMocks.getChatMessages).toHaveBeenCalledTimes(2);
    expect(assistantApiMocks.getChatMessages).toHaveBeenNthCalledWith(
      2,
      "token-1",
      "chat-1",
      undefined,
      20
    );
    vi.useRealTimers();
  });

  it("surfaces notify continuation bubbles promptly in chronological order without F5", async () => {
    vi.useFakeTimers();
    const baseMessages = [
      {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "run bg",
        attachments: [],
        createdAt: "2026-07-19T01:00:00.000Z"
      },
      {
        id: "assistant-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant",
        content: "subscribed",
        attachments: [],
        createdAt: "2026-07-19T01:00:05.000Z"
      }
    ];
    const continuationMessage = {
      id: "assistant-msg-continuation",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant",
      content: "FIVE_MIN_DONE",
      attachments: [],
      createdAt: "2026-07-19T01:05:00.000Z"
    };
    const sandboxJob = {
      jobRef: "jr1.sandbox.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      toolCode: "shell" as const,
      status: "detached" as const,
      notifyState: "subscribed" as const,
      createdAt: "2026-07-19T01:00:01.000Z",
      startedAt: "2026-07-19T01:00:01.000Z",
      updatedAt: "2026-07-19T01:00:01.000Z"
    };
    assistantApiMocks.getChatMessages
      .mockResolvedValueOnce({
        nextCursor: null,
        activeTurn: null,
        activeSandboxJobs: [sandboxJob],
        messages: baseMessages
      })
      .mockResolvedValue({
        nextCursor: null,
        activeTurn: null,
        activeSandboxJobs: [sandboxJob],
        messages: [...baseMessages, continuationMessage]
      });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    expect(result.current.activeSandboxJobs).toHaveLength(1);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "user-msg-1",
      "assistant-msg-1"
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.messages.map((message) => message.id)).toEqual([
      "user-msg-1",
      "assistant-msg-1",
      "assistant-msg-continuation"
    ]);
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "run bg",
      "subscribed",
      "FIVE_MIN_DONE"
    ]);
    vi.useRealTimers();
  });

  it("discovers a later continuation with no terminal job in Working and renders it once", async () => {
    const continuationClientTurnId = "async-cont:chat-discovery-1";
    const sourceMessages = [
      {
        id: "user-msg-discovery",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "run background work",
        attachments: [],
        createdAt: "2026-07-19T01:00:00.000Z"
      },
      {
        id: "assistant-msg-source",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "Started.",
        attachments: [],
        createdAt: "2026-07-19T01:00:01.000Z"
      }
    ];
    const persistedContinuation = {
      id: "assistant-msg-discovered-continuation",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "Live continuation",
      attachments: [],
      createdAt: "2026-07-19T01:01:00.000Z"
    };
    assistantApiMocks.getChatMessages
      .mockResolvedValueOnce({
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: [],
        activeSandboxJobs: [],
        messages: sourceMessages
      })
      .mockResolvedValue({
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: [],
        activeSandboxJobs: [],
        messages: [...sourceMessages, persistedContinuation]
      });

    let emitDiscovery: ((event: { clientTurnId: string; cursor: number }) => void) | undefined;
    assistantApiMocks.streamAssistantWebChatContinuationDiscovery.mockImplementation(
      async (
        _token: string,
        _chatId: string,
        _cursor: number,
        onDiscovery: (event: { clientTurnId: string; cursor: number }) => void,
        signal: AbortSignal
      ) => {
        emitDiscovery = onDiscovery;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      }
    );
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T01:00:00.000Z",
        updatedAt: "2026-07-19T01:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });
    let releaseTerminal!: () => void;
    const terminalHold = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        _clientTurnId: string,
        handlers: {
          onTurnStatus?: (payload: unknown) => void;
          onStarted?: (payload: unknown) => void;
          onDelta?: (payload: { delta: string }) => void;
          onTool?: (payload: unknown) => void;
          onToolProgress?: (payload: unknown) => void;
          onCompleted?: () => Promise<void>;
        }
      ) => {
        handlers.onTurnStatus?.({
          turn: {
            status: "running",
            chat: {
              id: "chat-1",
              assistantId: "assistant-1",
              surface: "web",
              surfaceThreadKey: "thread-1",
              title: null,
              chatMode: "normal",
              deepModeEnabled: false,
              skillDecisionState: null,
              archivedAt: null,
              lastMessageAt: null,
              createdAt: "2026-07-19T01:00:00.000Z",
              updatedAt: "2026-07-19T01:00:00.000Z"
            },
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          }
        });
        handlers.onStarted?.({ chat: { id: "chat-1" }, userMessage: null });
        handlers.onTool?.({
          phase: "start",
          toolName: "shell",
          toolCallId: "tool-1",
          isError: false
        });
        handlers.onToolProgress?.({
          toolName: "shell",
          toolCallId: "tool-1",
          kind: "stdout",
          line: "working"
        });
        handlers.onDelta?.({ delta: "Live continuation" });
        await terminalHold;
        await handlers.onCompleted?.();
      }
    );

    const { result, unmount } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });
    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await waitFor(() => expect(emitDiscovery).toBeTypeOf("function"));
    await act(async () => {
      emitDiscovery?.({ clientTurnId: continuationClientTurnId, cursor: 1 });
      emitDiscovery?.({ clientTurnId: continuationClientTurnId, cursor: 1 });
    });
    await waitFor(() =>
      expect(
        result.current.messages.some((message) => message.content === "Live continuation")
      ).toBe(true)
    );
    expect(result.current.activeMediaJobs).toEqual([]);
    expect(result.current.activeDocumentJobs).toEqual([]);
    expect(result.current.activeSandboxJobs).toEqual([]);
    expect(
      assistantApiMocks.reattachAssistantWebChatTurnStream.mock.calls.filter(
        (call) => call[1] === continuationClientTurnId
      )
    ).toHaveLength(1);

    await act(async () => releaseTerminal());
    await waitFor(() => {
      const bubbles = result.current.messages.filter(
        (message) => message.content === "Live continuation"
      );
      expect(bubbles).toHaveLength(1);
      expect(bubbles[0]?.id).toBe(persistedContinuation.id);
    });
    unmount();
    const discoverySignal =
      assistantApiMocks.streamAssistantWebChatContinuationDiscovery.mock.calls[0]?.[4];
    expect(discoverySignal).toBeInstanceOf(AbortSignal);
    expect((discoverySignal as AbortSignal).aborted).toBe(true);
  });

  describe("ADR-166 P2: already-terminal discovered async continuation", () => {
    const sourceMessages = [
      {
        id: "user-msg-terminal-discovery",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "run background work",
        attachments: [] as [],
        createdAt: "2026-07-27T20:00:00.000Z"
      },
      {
        id: "assistant-msg-source-terminal-discovery",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "Started.",
        attachments: [] as [],
        createdAt: "2026-07-27T20:00:01.000Z"
      }
    ];
    const continuationAttachment = {
      id: "att-terminal-discovery-1",
      attachmentType: "image" as const,
      originalFilename: "catchup.png",
      mimeType: "image/png",
      sizeBytes: 128,
      processingStatus: "ready" as const,
      createdAt: "2026-07-27T20:00:05.000Z"
    };
    const publishedContinuation = {
      id: "assistant-msg-terminal-discovery",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "Catch-up complete",
      attachments: [continuationAttachment],
      createdAt: "2026-07-27T20:00:05.000Z"
    };
    const chatMeta = {
      id: "chat-1",
      assistantId: "assistant-1",
      surface: "web" as const,
      surfaceThreadKey: "thread-1",
      title: null,
      chatMode: "normal" as const,
      deepModeEnabled: false,
      skillDecisionState: null,
      archivedAt: null,
      lastMessageAt: null,
      createdAt: "2026-07-27T20:00:00.000Z",
      updatedAt: "2026-07-27T20:00:05.000Z"
    };

    async function mountWithDiscoveryReady(): Promise<{
      result: { current: ReturnType<typeof useChat> };
      emitDiscovery: (event: { clientTurnId: string; cursor: number }) => void;
      unmount: () => void;
    }> {
      let emitDiscovery: ((event: { clientTurnId: string; cursor: number }) => void) | undefined;
      assistantApiMocks.streamAssistantWebChatContinuationDiscovery.mockImplementation(
        async (
          _token: string,
          _chatId: string,
          _cursor: number,
          onDiscovery: (event: { clientTurnId: string; cursor: number }) => void,
          signal: AbortSignal
        ) => {
          emitDiscovery = onDiscovery;
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        }
      );
      const { result, unmount } = renderHook(
        () => useChat("thread-1", { assistantId: "assistant-1" }),
        {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        }
      );
      await act(async () => {
        await result.current.loadHistory("chat-1");
      });
      await waitFor(() => expect(emitDiscovery).toBeTypeOf("function"));
      return {
        result,
        emitDiscovery: (event) => {
          emitDiscovery?.(event);
        },
        unmount
      };
    }

    it("immediate completed discovery reconciles the published bubble with attachments once", async () => {
      const continuationClientTurnId = "async-cont:terminal-discovery-completed-1";
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          activeTurn: null,
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: sourceMessages
        })
        .mockResolvedValue({
          nextCursor: null,
          activeTurn: null,
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: [...sourceMessages, publishedContinuation]
        });
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
        status: "completed",
        chat: chatMeta,
        userMessage: null,
        assistantMessage: publishedContinuation,
        followUpAssistantMessage: null,
        currentActivity: null,
        runtime: null,
        error: null
      });

      const { result, emitDiscovery, unmount } = await mountWithDiscoveryReady();
      const historyCallsBeforeDiscovery = assistantApiMocks.getChatMessages.mock.calls.length;

      await act(async () => {
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 1 });
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 1 });
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 2 });
      });

      await waitFor(() => {
        const bubbles = result.current.messages.filter(
          (message) => message.id === publishedContinuation.id
        );
        expect(bubbles).toHaveLength(1);
        expect(bubbles[0]?.content).toBe("Catch-up complete");
        expect(bubbles[0]?.attachments?.map((attachment) => attachment.id)).toEqual([
          continuationAttachment.id
        ]);
      });
      expect(assistantApiMocks.reattachAssistantWebChatTurnStream).not.toHaveBeenCalled();
      expect(assistantApiMocks.getChatMessages.mock.calls.length).toBe(
        historyCallsBeforeDiscovery + 1
      );
      unmount();
    });

    it("immediate failed discovery surfaces the published bubble without reattach", async () => {
      const continuationClientTurnId = "async-cont:terminal-discovery-failed-1";
      const failedContinuation = {
        ...publishedContinuation,
        id: "assistant-msg-terminal-discovery-failed",
        content: "Catch-up failed"
      };
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          activeTurn: null,
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: sourceMessages
        })
        .mockResolvedValue({
          nextCursor: null,
          activeTurn: null,
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: [...sourceMessages, failedContinuation]
        });
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
        status: "failed",
        chat: chatMeta,
        userMessage: null,
        assistantMessage: failedContinuation,
        followUpAssistantMessage: null,
        currentActivity: null,
        runtime: null,
        error: { code: "continuation_failed", message: "Continuation failed" }
      });

      const { result, emitDiscovery, unmount } = await mountWithDiscoveryReady();

      await act(async () => {
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 1 });
      });

      await waitFor(() => {
        expect(
          result.current.messages.some((message) => message.id === failedContinuation.id)
        ).toBe(true);
      });
      expect(assistantApiMocks.reattachAssistantWebChatTurnStream).not.toHaveBeenCalled();
      expect(result.current.issue).toMatchObject({
        message: "Chat could not complete this turn."
      });
      unmount();
    });

    it("immediate interrupted discovery reconciles once without duplicate bubbles or refresh storm", async () => {
      const continuationClientTurnId = "async-cont:terminal-discovery-interrupted-1";
      const interruptedContinuation = {
        ...publishedContinuation,
        id: "assistant-msg-terminal-discovery-interrupted",
        content: "Catch-up interrupted"
      };
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          activeTurn: null,
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: sourceMessages
        })
        .mockResolvedValue({
          nextCursor: null,
          activeTurn: null,
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: [...sourceMessages, interruptedContinuation]
        });
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
        status: "interrupted",
        chat: chatMeta,
        userMessage: null,
        assistantMessage: interruptedContinuation,
        followUpAssistantMessage: null,
        currentActivity: null,
        runtime: null,
        error: null
      });

      const { result, emitDiscovery, unmount } = await mountWithDiscoveryReady();
      const historyCallsBeforeDiscovery = assistantApiMocks.getChatMessages.mock.calls.length;

      await act(async () => {
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 1 });
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 1 });
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 3 });
      });

      await waitFor(() => {
        expect(
          result.current.messages.filter((message) => message.id === interruptedContinuation.id)
        ).toHaveLength(1);
      });

      await act(async () => {
        emitDiscovery({ clientTurnId: continuationClientTurnId, cursor: 4 });
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        result.current.messages.filter((message) => message.id === interruptedContinuation.id)
      ).toHaveLength(1);
      expect(assistantApiMocks.reattachAssistantWebChatTurnStream).not.toHaveBeenCalled();
      expect(assistantApiMocks.getChatMessages.mock.calls.length).toBe(
        historyCallsBeforeDiscovery + 1
      );
      unmount();
    });
  });

  it("reattaches the continuation clientTurnId when notify is claimed with continuationClientTurnId", async () => {
    const continuationClientTurnId = "async-cont:handle-reattach-1";
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T01:00:01.000Z",
          startedAt: "2026-07-19T01:00:01.000Z",
          updatedAt: "2026-07-19T01:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "run bg",
          attachments: [],
          createdAt: "2026-07-19T01:00:00.000Z"
        }
      ]
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      // Server may still project a source user on older builds; client must ignore it.
      userMessage: {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "run bg",
        attachments: [],
        createdAt: "2026-07-19T01:00:00.000Z"
      },
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(assistantApiMocks.reattachAssistantWebChatTurnStream).toHaveBeenCalledWith(
      "token-1",
      continuationClientTurnId,
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Number)
    );
    // Dedupe: effect re-runs must not storm reattach for the same clientTurnId.
    const reattachCalls = assistantApiMocks.reattachAssistantWebChatTurnStream.mock.calls.filter(
      (call) => call[1] === continuationClientTurnId
    );
    expect(reattachCalls.length).toBe(1);
  });

  it("keeps async-cont reattach live when history already has source user + prior assistant", async () => {
    const continuationClientTurnId = "async-cont:handle-history-merge-1";
    const historyPage = {
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T02:00:01.000Z",
          startedAt: "2026-07-19T02:00:01.000Z",
          updatedAt: "2026-07-19T02:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-msg-source",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "run bg notify",
          attachments: [],
          createdAt: "2026-07-19T02:00:00.000Z"
        },
        {
          id: "assistant-msg-prior",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "subscribed — waiting",
          attachments: [],
          createdAt: "2026-07-19T02:00:00.500Z"
        }
      ]
    };
    assistantApiMocks.getChatMessages.mockResolvedValue(historyPage);
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      // Legacy / mistaken projection of source user must not kill continuation.
      userMessage: {
        id: "user-msg-source",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "run bg notify",
        attachments: [],
        createdAt: "2026-07-19T02:00:00.000Z"
      },
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    let resolveReattachHold: (() => void) | undefined;
    const reattachHold = new Promise<void>((resolve) => {
      resolveReattachHold = resolve;
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
        }
      ) => {
        const turn = await assistantApiMocks.getAssistantWebChatTurnStatus("token-1", clientTurnId);
        handlers.onHeadersOk?.();
        handlers.onTurnStatus?.({ turn });
        handlers.onDelta?.({ delta: "continuation live " });
        await reattachHold;
      }
    );

    vi.useFakeTimers();
    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(assistantApiMocks.reattachAssistantWebChatTurnStream).toHaveBeenCalledWith(
      "token-1",
      continuationClientTurnId,
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Number)
    );
    expect(result.current.isStreaming).toBe(true);
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.status === "streaming" &&
          message.content.includes("continuation live")
      )
    ).toBe(true);

    // History poll while continuation is live must not treat prior assistant
    // after source user as "already committed" and tear down the bubble.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isStreaming).toBe(true);
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.status === "streaming" &&
          message.content.includes("continuation live")
      )
    ).toBe(true);
    expect(result.current.messages.map((message) => message.id)).toEqual(
      expect.arrayContaining(["user-msg-source", "assistant-msg-prior"])
    );

    resolveReattachHold?.();
    vi.useRealTimers();
  });

  it("live:false reattach does not leave permanent empty thinking as sole UX", async () => {
    const continuationClientTurnId = "async-cont:handle-live-false-1";
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T03:00:01.000Z",
          startedAt: "2026-07-19T03:00:01.000Z",
          updatedAt: "2026-07-19T03:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "run bg",
          attachments: [],
          createdAt: "2026-07-19T03:00:00.000Z"
        },
        {
          id: "assistant-msg-prior",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "subscribed",
          attachments: [],
          createdAt: "2026-07-19T03:00:00.500Z"
        }
      ]
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    let resolveReattachHold: (() => void) | undefined;
    const reattachHold = new Promise<void>((resolve) => {
      resolveReattachHold = resolve;
    });
    const baseHistoryMessages = [
      {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "run bg",
        attachments: [],
        createdAt: "2026-07-19T03:00:00.000Z"
      },
      {
        id: "assistant-msg-prior",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "subscribed",
        attachments: [],
        createdAt: "2026-07-19T03:00:00.500Z"
      }
    ];
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          onCompleted?: () => void | Promise<void>;
        }
      ) => {
        const turn = await assistantApiMocks.getAssistantWebChatTurnStatus("token-1", clientTurnId);
        handlers.onHeadersOk?.();
        handlers.onReattached?.({ turn, live: false });
        await reattachHold;
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          activeTurn: null,
          activeSandboxJobs: [],
          messages: [
            ...baseHistoryMessages,
            {
              id: "assistant-msg-continuation",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "DONE",
              attachments: [],
              createdAt: "2026-07-19T03:00:05.000Z"
            }
          ]
        });
        await handlers.onCompleted?.();
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isStreaming).toBe(true);
    const liveAssistant = result.current.messages.find(
      (message) =>
        message.role === "assistant" &&
        (message.status === "reconciling" || message.status === "streaming")
    );
    expect(liveAssistant).toBeDefined();
    expect(liveAssistant?.content.trim()).toBe("");
    // Non-live reattach must not imply token streaming / permanent «Думаю».
    expect(liveAssistant?.status).toBe("reconciling");
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.status === "streaming" &&
          message.content.trim().length === 0
      )
    ).toBe(false);

    resolveReattachHold?.();
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "user-msg-1",
        "assistant-msg-prior",
        "assistant-msg-continuation"
      ]);
    });
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" &&
          (message.status === "streaming" || message.status === "reconciling")
      )
    ).toBe(false);
  });

  it("F5 history clears a stale-running async-cont publish overlay once", async () => {
    const continuationClientTurnId = "async-cont:handle-terminal-absorb-1";
    const baseMessages = [
      {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "run bg",
        attachments: [],
        createdAt: "2026-07-19T04:00:00.000Z"
      },
      {
        id: "assistant-msg-prior",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "subscribed",
        attachments: [],
        createdAt: "2026-07-19T04:00:00.500Z"
      }
    ];
    const continuationMessage = {
      id: "assistant-msg-continuation",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "CONTINUATION_DONE",
      attachments: [],
      createdAt: "2026-07-19T04:00:08.000Z"
    };
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T04:00:01.000Z",
          startedAt: "2026-07-19T04:00:01.000Z",
          updatedAt: "2026-07-19T04:00:01.000Z"
        }
      ],
      messages: baseMessages
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          onCompleted?: () => void | Promise<void>;
        }
      ) => {
        const turn = await assistantApiMocks.getAssistantWebChatTurnStatus("token-1", clientTurnId);
        handlers.onHeadersOk?.();
        handlers.onReattached?.({ turn, live: true });
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          activeTurn: {
            clientTurnId: continuationClientTurnId,
            status: "running",
            updatedAt: "2026-07-19T04:00:08.000Z",
            currentActivity: null,
            pendingUserMessageId: null,
            assistantMessageId: continuationMessage.id,
            chat: null,
            userMessage: null,
            assistantMessage: continuationMessage,
            canReattach: true
          },
          activeSandboxJobs: [],
          messages: [...baseMessages, continuationMessage]
        });
        await handlers.onCompleted?.();
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "user-msg-1",
        "assistant-msg-prior",
        "assistant-msg-continuation"
      ]);
    });
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" &&
          (message.status === "streaming" || message.status === "reconciling")
      )
    ).toBe(false);
    expect(window.sessionStorage.getItem("persai.active-web-turn.v1.thread-1")).toBeNull();
  });

  it("clears sticky and Stop when continuation reattach dies without a terminal", async () => {
    const continuationClientTurnId = "async-cont:handle-sticky-fail-1";
    const claimedJobs = [
      {
        jobRef: "jr1.sandbox.FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
        toolCode: "shell" as const,
        status: "detached" as const,
        notifyState: "claimed" as const,
        continuationClientTurnId,
        createdAt: "2026-07-19T05:00:01.000Z",
        startedAt: "2026-07-19T05:00:01.000Z",
        updatedAt: "2026-07-19T05:00:01.000Z"
      }
    ];
    const historyPage = {
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: claimedJobs,
      messages: [
        {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "run bg",
          attachments: [],
          createdAt: "2026-07-19T05:00:00.000Z"
        }
      ]
    };
    assistantApiMocks.getChatMessages.mockResolvedValue(historyPage);
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    let reattachAttempts = 0;
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onReattached?: (payload: { turn: unknown; live: boolean }) => void;
        }
      ) => {
        reattachAttempts += 1;
        const turn = await assistantApiMocks.getAssistantWebChatTurnStatus("token-1", clientTurnId);
        handlers.onHeadersOk?.();
        handlers.onReattached?.({ turn, live: true });
        throw new Error("Stream closed before terminal event.");
      }
    );

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-1");
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(reattachAttempts).toBe(1);
      expect(result.current.isStreaming).toBe(false);

      // Sticky cleared on SSE death; notify history poll re-runs the effect.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
        await Promise.resolve();
      });
      expect(reattachAttempts).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start continuation reattach while an ordinary send is streaming", async () => {
    const continuationClientTurnId = "async-cont:handle-defer-ordinary-1";
    let releaseOrdinaryStream: (() => void) | undefined;
    const ordinaryStreamHold = new Promise<void>((resolve) => {
      releaseOrdinaryStream = resolve;
    });

    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onHeadersOk?: () => void;
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        },
        signal?: AbortSignal
      ) => {
        handlers.onHeadersOk?.();
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: {
            id: "user-ordinary-1",
            chatId: "chat-1",
            attachments: []
          }
        });
        handlers.onDelta?.({ delta: "ordinary live " });
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          signal?.addEventListener("abort", onAbort, { once: true });
          ordinaryStreamHold.then(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          });
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: { id: "assistant-ordinary-1", attachments: [] },
            userMessage: { id: "user-ordinary-1", chatId: "chat-1", attachments: [] },
            runtime: null
          }
        });
      }
    );
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.11111111111111111111111111111111",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T06:00:01.000Z",
          startedAt: "2026-07-19T06:00:01.000Z",
          updatedAt: "2026-07-19T06:00:01.000Z"
        }
      ],
      messages: []
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: { id: "chat-1" },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(async () => {
      /* should not run while ordinary owns */
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      void result.current.send("ordinary first");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      await result.current.loadHistory("chat-1");
      await Promise.resolve();
    });

    expect(assistantApiMocks.reattachAssistantWebChatTurnStream).not.toHaveBeenCalled();
    releaseOrdinaryStream?.();
  });

  it("soft-detach history finalize does not tear down an unrelated async-cont owner", async () => {
    const continuationClientTurnId = "async-cont:handle-soft-detach-owner-1";
    let releaseContinuation: (() => void) | undefined;
    const continuationHold = new Promise<void>((resolve) => {
      releaseContinuation = resolve;
    });

    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.22222222222222222222222222222222",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T07:00:01.000Z",
          startedAt: "2026-07-19T07:00:01.000Z",
          updatedAt: "2026-07-19T07:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-prior-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "prior",
          attachments: [],
          createdAt: "2026-07-19T07:00:00.000Z"
        },
        {
          id: "assistant-prior-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "prior answer",
          attachments: [],
          createdAt: "2026-07-19T07:00:00.500Z"
        }
      ]
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: { id: "chat-1" },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          onDelta?: (payload: { delta: string }) => void;
        }
      ) => {
        const turn = await assistantApiMocks.getAssistantWebChatTurnStatus("token-1", clientTurnId);
        handlers.onHeadersOk?.();
        handlers.onReattached?.({ turn, live: true });
        handlers.onDelta?.({ delta: "continuation still live " });
        await continuationHold;
      }
    );

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-1");
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStreaming).toBe(true);
      expect(
        result.current.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.status === "streaming" &&
            message.content.includes("continuation still live")
        )
      ).toBe(true);

      // History poll while continuation owns must not finalize/tear it down just
      // because prior user+assistant already exist in the page.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
        await Promise.resolve();
      });

      expect(result.current.isStreaming).toBe(true);
      expect(
        result.current.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.status === "streaming" &&
            message.content.includes("continuation still live")
        )
      ).toBe(true);
    } finally {
      releaseContinuation?.();
      vi.useRealTimers();
    }
  });

  it("demotes contentful streaming assistant to committed after terminal finalize + history", async () => {
    const continuationClientTurnId = "async-cont:handle-demote-contentful-1";
    const baseMessages = [
      {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "run bg",
        attachments: [],
        createdAt: "2026-07-19T08:00:00.000Z"
      },
      {
        id: "assistant-msg-prior",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "subscribed",
        attachments: [],
        createdAt: "2026-07-19T08:00:00.500Z"
      }
    ];
    const continuationMessage = {
      id: "assistant-msg-continuation",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "streamed then completed",
      attachments: [],
      createdAt: "2026-07-19T08:00:08.000Z"
    };
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.33333333333333333333333333333333",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T08:00:01.000Z",
          startedAt: "2026-07-19T08:00:01.000Z",
          updatedAt: "2026-07-19T08:00:01.000Z"
        }
      ],
      messages: baseMessages
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: { id: "chat-1" },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onCompleted?: () => void | Promise<void>;
        }
      ) => {
        const turn = await assistantApiMocks.getAssistantWebChatTurnStatus("token-1", clientTurnId);
        handlers.onHeadersOk?.();
        handlers.onReattached?.({ turn, live: true });
        handlers.onDelta?.({ delta: "streamed then completed" });
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          activeTurn: null,
          activeSandboxJobs: [],
          messages: [...baseMessages, continuationMessage]
        });
        await handlers.onCompleted?.();
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" &&
          (message.status === "streaming" || message.status === "reconciling")
      )
    ).toBe(false);
    const continuationBubbles = result.current.messages.filter(
      (message) =>
        message.role === "assistant" && message.content.includes("streamed then completed")
    );
    expect(continuationBubbles).toHaveLength(1);
    expect(continuationBubbles[0]?.id).toBe("assistant-msg-continuation");
    expect(continuationBubbles[0]?.status).not.toBe("streaming");
    expect(continuationBubbles[0]?.status).not.toBe("reconciling");
  });

  it("async-cont turn_status completed with null userMessage demotes streaming bubble", async () => {
    const continuationClientTurnId = "async-cont:handle-terminal-status-null-user-1";
    const baseMessages = [
      {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "run bg",
        attachments: [],
        createdAt: "2026-07-19T09:00:00.000Z"
      },
      {
        id: "assistant-msg-prior",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "subscribed",
        attachments: [],
        createdAt: "2026-07-19T09:00:00.500Z"
      }
    ];
    const claimedJobs = [
      {
        jobRef: "jr1.sandbox.44444444444444444444444444444444",
        toolCode: "shell" as const,
        status: "detached" as const,
        notifyState: "claimed" as const,
        continuationClientTurnId,
        createdAt: "2026-07-19T09:00:01.000Z",
        startedAt: "2026-07-19T09:00:01.000Z",
        updatedAt: "2026-07-19T09:00:01.000Z"
      }
    ];
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: claimedJobs,
      messages: baseMessages
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: { id: "chat-1" },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
        }
      ) => {
        const runningTurn = await assistantApiMocks.getAssistantWebChatTurnStatus(
          "token-1",
          clientTurnId
        );
        handlers.onHeadersOk?.();
        handlers.onReattached?.({ turn: runningTurn, live: true });
        handlers.onDelta?.({ delta: "contentful continuation text" });
        // Job left claimed so continuation effect does not immediately re-reattach.
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          activeTurn: null,
          activeSandboxJobs: [],
          messages: [
            ...baseMessages,
            {
              id: "assistant-msg-continuation",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "contentful continuation text",
              attachments: [],
              createdAt: "2026-07-19T09:00:08.000Z"
            }
          ]
        });
        // Terminal via turn_status only (no onCompleted) — async-cont has null userMessage.
        handlers.onTurnStatus?.({
          turn: {
            status: "completed",
            chat: { id: "chat-1" },
            userMessage: null,
            assistantMessage: {
              id: "assistant-msg-continuation",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "contentful continuation text",
              attachments: [],
              createdAt: "2026-07-19T09:00:08.000Z"
            },
            currentActivity: null,
            runtime: null,
            error: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(
        result.current.messages.some(
          (message) =>
            message.role === "assistant" &&
            (message.status === "streaming" || message.status === "reconciling")
        )
      ).toBe(false);
    });
    const continuationBubbles = result.current.messages.filter(
      (message) =>
        message.role === "assistant" && message.content.includes("contentful continuation text")
    );
    expect(continuationBubbles).toHaveLength(1);
    expect(continuationBubbles[0]?.id).toBe("assistant-msg-continuation");
    expect(continuationBubbles[0]?.status).not.toBe("streaming");
    expect(continuationBubbles[0]?.status).not.toBe("reconciling");
  });

  it("async-cont turn_status completed with null assistantMessage does not leave a full duplicate after history absorb", async () => {
    const continuationClientTurnId = "async-cont:handle-terminal-status-null-assistant-1";
    const baseMessages = [
      {
        id: "user-msg-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user" as const,
        content: "run bg",
        attachments: [],
        createdAt: "2026-07-19T10:00:00.000Z"
      },
      {
        id: "assistant-msg-prior",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "subscribed",
        attachments: [],
        createdAt: "2026-07-19T10:00:00.500Z"
      }
    ];
    const continuationContent = "notify stream full text";
    const continuationMessage = {
      id: "assistant-msg-continuation",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: continuationContent,
      attachments: [],
      createdAt: "2026-07-19T10:00:08.000Z"
    };
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.55555555555555555555555555555555",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T10:00:01.000Z",
          startedAt: "2026-07-19T10:00:01.000Z",
          updatedAt: "2026-07-19T10:00:01.000Z"
        }
      ],
      messages: baseMessages
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "running",
      chat: { id: "chat-1" },
      userMessage: null,
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
          onCompleted?: () => void | Promise<void>;
        }
      ) => {
        const runningTurn = await assistantApiMocks.getAssistantWebChatTurnStatus(
          "token-1",
          clientTurnId
        );
        handlers.onHeadersOk?.();
        handlers.onReattached?.({ turn: runningTurn, live: true });
        handlers.onDelta?.({ delta: continuationContent });
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          activeTurn: null,
          activeSandboxJobs: [],
          messages: [...baseMessages, continuationMessage]
        });
        // Terminal status before assistantMessage is projected — production race
        // that demoted local-assistant-* then history-appended the server twin.
        handlers.onTurnStatus?.({
          turn: {
            status: "completed",
            chat: { id: "chat-1" },
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          }
        });
        await handlers.onCompleted?.();
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });
    const continuationBubbles = result.current.messages.filter(
      (message) => message.role === "assistant" && message.content.includes(continuationContent)
    );
    expect(continuationBubbles).toHaveLength(1);
    expect(continuationBubbles[0]?.id).toBe("assistant-msg-continuation");
    expect(
      result.current.messages.some(
        (message) => message.role === "assistant" && message.id.startsWith("local-assistant-")
      )
    ).toBe(false);
  });

  it("async-cont with assistantMessageId binds live stream to the ConversationalPublish bubble", async () => {
    const continuationClientTurnId = "async-cont:handle-publish-bind-1";
    const publishAttachment = {
      id: "att-publish-1",
      path: `${CHAT_SESSION_ROOT}/cat.png`,
      thumbnailStoragePath: `${CHAT_SESSION_ROOT}/cat.thumb.png`,
      posterStoragePath: null,
      attachmentType: "image" as const,
      originalFilename: "cat.png",
      mimeType: "image/png",
      sizeBytes: 1200,
      processingStatus: "ready" as const,
      createdAt: "2026-07-19T11:00:02.000Z"
    };
    const publishMessage = {
      id: "assistant-msg-publish",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "",
      attachments: [publishAttachment],
      createdAt: "2026-07-19T11:00:02.000Z"
    };
    const historyPage = {
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.PUBLISHBIND0000000000000000000001",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T11:00:01.000Z",
          startedAt: "2026-07-19T11:00:01.000Z",
          updatedAt: "2026-07-19T11:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-msg-source",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "draw a cat",
          attachments: [],
          createdAt: "2026-07-19T11:00:00.000Z"
        },
        {
          id: "assistant-msg-prior",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant" as const,
          content: "Working on it.",
          attachments: [],
          createdAt: "2026-07-19T11:00:00.500Z"
        },
        publishMessage
      ]
    };
    assistantApiMocks.getChatMessages.mockResolvedValue(historyPage);
    const runningTurn = {
      status: "running" as const,
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: publishMessage,
      currentActivity: null,
      runtime: null,
      error: null
    };
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue(runningTurn);

    let resolveReattachHold: (() => void) | undefined;
    const reattachHold = new Promise<void>((resolve) => {
      resolveReattachHold = resolve;
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        _clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
          onStarted?: (payload: {
            chat: unknown;
            userMessage: unknown;
            assistantMessageId?: string;
          }) => void;
          onDelta?: (payload: { delta: string }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onTurnStatus?.({ turn: runningTurn });
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: null,
          assistantMessageId: publishMessage.id
        });
        handlers.onDelta?.({ delta: "Here is your cat." });
        await reattachHold;
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (message) =>
            message.id === publishMessage.id &&
            message.status === "streaming" &&
            message.content.includes("Here is your cat.")
        )
      ).toBe(true);
    });
    expect(
      result.current.messages.filter((message) => message.role === "assistant").map((m) => m.id)
    ).toEqual(["assistant-msg-prior", publishMessage.id]);
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" && message.id.startsWith("local-assistant-async-cont:")
      )
    ).toBe(false);
    const livePublish = result.current.messages.find((message) => message.id === publishMessage.id);
    expect(livePublish?.attachments?.map((attachment) => attachment.id)).toEqual([
      publishAttachment.id
    ]);

    resolveReattachHold?.();
  });

  it("async-cont publish-id overlay clears when completed is missed and history has final content", async () => {
    const continuationClientTurnId = "async-cont:handle-publish-missed-completed-1";
    const publishAttachment = {
      id: "att-publish-missed-1",
      path: `${CHAT_SESSION_ROOT}/bird.png`,
      thumbnailStoragePath: `${CHAT_SESSION_ROOT}/bird.thumb.png`,
      posterStoragePath: null,
      attachmentType: "image" as const,
      originalFilename: "bird.png",
      mimeType: "image/png",
      sizeBytes: 1800,
      processingStatus: "ready" as const,
      createdAt: "2026-07-19T13:00:02.000Z"
    };
    const publishMessageEmpty = {
      id: "assistant-msg-publish-missed",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "",
      attachments: [publishAttachment],
      createdAt: "2026-07-19T13:00:02.000Z"
    };
    const publishMessageFinal = {
      ...publishMessageEmpty,
      content: "Here is your bird."
    };
    const baseHistory = {
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.PUBLISHMISSED00000000000000000001",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T13:00:01.000Z",
          startedAt: "2026-07-19T13:00:01.000Z",
          updatedAt: "2026-07-19T13:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-msg-source",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "draw a bird",
          attachments: [],
          createdAt: "2026-07-19T13:00:00.000Z"
        },
        publishMessageEmpty
      ]
    };
    assistantApiMocks.getChatMessages.mockResolvedValue(baseHistory);
    const runningTurn = {
      status: "running" as const,
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: publishMessageEmpty,
      currentActivity: null,
      runtime: null,
      error: null
    };
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue(runningTurn);

    let resolveReattachHold: (() => void) | undefined;
    const reattachHold = new Promise<void>((resolve) => {
      resolveReattachHold = resolve;
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        _clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
          onStarted?: (payload: {
            chat: unknown;
            userMessage: unknown;
            assistantMessageId?: string;
          }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onCompleted?: () => void | Promise<void>;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onTurnStatus?.({ turn: runningTurn });
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: null,
          assistantMessageId: publishMessageEmpty.id
        });
        handlers.onDelta?.({ delta: "Here is your bird." });
        // Miss SSE completed — stream ends without terminal event.
        await reattachHold;
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (message) =>
            message.id === publishMessageEmpty.id &&
            message.status === "streaming" &&
            message.content.includes("Here is your bird.")
        )
      ).toBe(true);
    });

    assistantApiMocks.getChatMessages.mockResolvedValue({
      ...baseHistory,
      activeSandboxJobs: [],
      messages: [baseHistory.messages[0], publishMessageFinal]
    });

    await act(async () => {
      resolveReattachHold?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      const settled = result.current.messages.find(
        (message) => message.id === publishMessageFinal.id
      );
      expect(settled?.content).toBe("Here is your bird.");
      expect(settled?.status === "streaming" || settled?.status === "reconciling").toBe(false);
      expect(settled?.attachments?.map((attachment) => attachment.id)).toEqual([
        publishAttachment.id
      ]);
    });
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" && message.id.startsWith("local-assistant-async-cont:")
      )
    ).toBe(false);
  });

  it("async-cont thinking overlay preserves attachments on the publish bubble", async () => {
    const continuationClientTurnId = "async-cont:handle-publish-thinking-1";
    const publishAttachment = {
      id: "att-publish-think-1",
      path: `${CHAT_SESSION_ROOT}/dog.png`,
      thumbnailStoragePath: `${CHAT_SESSION_ROOT}/dog.thumb.png`,
      posterStoragePath: null,
      attachmentType: "image" as const,
      originalFilename: "dog.png",
      mimeType: "image/png",
      sizeBytes: 2200,
      processingStatus: "ready" as const,
      createdAt: "2026-07-19T12:00:02.000Z"
    };
    const publishMessage = {
      id: "assistant-msg-publish-think",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "",
      attachments: [publishAttachment],
      createdAt: "2026-07-19T12:00:02.000Z"
    };
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.PUBLISHTHINK000000000000000000001",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T12:00:01.000Z",
          startedAt: "2026-07-19T12:00:01.000Z",
          updatedAt: "2026-07-19T12:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-msg-source",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "draw a dog",
          attachments: [],
          createdAt: "2026-07-19T12:00:00.000Z"
        },
        publishMessage
      ]
    });
    const runningTurn = {
      status: "running" as const,
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: publishMessage,
      currentActivity: null,
      runtime: null,
      error: null
    };
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue(runningTurn);

    let resolveReattachHold: (() => void) | undefined;
    const reattachHold = new Promise<void>((resolve) => {
      resolveReattachHold = resolve;
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        _clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
          onStarted?: (payload: {
            chat: unknown;
            userMessage: unknown;
            assistantMessageId?: string;
          }) => void;
          onThinking?: (payload: { accumulated: string }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onTurnStatus?.({ turn: runningTurn });
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: null,
          assistantMessageId: publishMessage.id
        });
        handlers.onThinking?.({ accumulated: "composing a short ack" });
        await reattachHold;
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      const live = result.current.messages.find((message) => message.id === publishMessage.id);
      expect(live?.thought ?? "").toBe("");
      expect(result.current.liveThinkingPreviewByMessageId[publishMessage.id]).toBe(
        "composing a short ack"
      );
      expect(live?.status).toBe("streaming");
      expect(live?.attachments?.map((attachment) => attachment.id)).toEqual([publishAttachment.id]);
    });
    expect(
      result.current.messages.some(
        (message) =>
          message.role === "assistant" && message.id.startsWith("local-assistant-async-cont:")
      )
    ).toBe(false);

    resolveReattachHold?.();
  });

  it("uses durable ConversationalPublish provenance across live and committed history", async () => {
    const continuationClientTurnId = "async-cont:handle-suppress-receipts-1";
    const publishAttachment = {
      id: "att-publish-suppress-1",
      path: `${CHAT_SESSION_ROOT}/cat.png`,
      thumbnailStoragePath: `${CHAT_SESSION_ROOT}/cat.thumb.png`,
      posterStoragePath: null,
      attachmentType: "image" as const,
      originalFilename: "cat.png",
      mimeType: "image/png",
      sizeBytes: 1800,
      processingStatus: "ready" as const,
      createdAt: "2026-07-19T12:00:02.000Z"
    };
    const publishMessage = {
      id: "assistant-msg-publish-suppress",
      chatId: "chat-1",
      assistantId: "assistant-1",
      author: "assistant" as const,
      content: "",
      attachments: [publishAttachment],
      conversationalPublish: true,
      createdAt: "2026-07-19T12:00:02.000Z"
    };
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [
        {
          jobRef: "jr1.sandbox.SUPPRESSRECEIPT0000000000000000001",
          toolCode: "shell" as const,
          status: "detached" as const,
          notifyState: "claimed" as const,
          continuationClientTurnId,
          createdAt: "2026-07-19T12:00:01.000Z",
          startedAt: "2026-07-19T12:00:01.000Z",
          updatedAt: "2026-07-19T12:00:01.000Z"
        }
      ],
      messages: [
        {
          id: "user-msg-source-suppress",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "continue",
          attachments: [],
          createdAt: "2026-07-19T12:00:00.000Z"
        },
        publishMessage
      ]
    });
    const runningTurn = {
      status: "running" as const,
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: null,
        chatMode: "normal",
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      userMessage: null,
      assistantMessage: publishMessage,
      currentActivity: null,
      runtime: null,
      error: null
    };
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue(runningTurn);

    let resolveReattachHold: (() => void) | undefined;
    const reattachHold = new Promise<void>((resolve) => {
      resolveReattachHold = resolve;
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        _clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
          onStarted?: (payload: {
            chat: unknown;
            userMessage: unknown;
            assistantMessageId?: string;
          }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onTurnStatus?.({ turn: runningTurn });
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: null,
          assistantMessageId: publishMessage.id
        });
        await reattachHold;
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      const live = result.current.messages.find((message) => message.id === publishMessage.id);
      expect(live?.status).toBe("streaming");
      expect(live?.conversationalPublish).toBe(true);
    });

    const terminalPublish = {
      ...publishMessage,
      content: "Продолжаю."
    };
    assistantApiMocks.getChatMessages.mockResolvedValue({
      nextCursor: null,
      activeTurn: null,
      activeSandboxJobs: [],
      messages: [
        {
          id: "user-msg-source-suppress",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "continue",
          attachments: [],
          createdAt: "2026-07-19T12:00:00.000Z"
        },
        terminalPublish
      ]
    });
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      ...runningTurn,
      status: "completed",
      assistantMessage: terminalPublish
    });

    resolveReattachHold?.();
    await act(async () => {
      await result.current.loadHistory("chat-1");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      const committed = result.current.messages.find((message) => message.id === publishMessage.id);
      expect(committed?.status).toBe("committed");
      expect(committed?.conversationalPublish).toBe(true);
      expect(committed?.attachments?.map((attachment) => attachment.id)).toEqual([
        publishAttachment.id
      ]);
    });
  });

  it("clears the local streaming bubble when focus history already contains the completed turn", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden"
    });

    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      let sendPromise: Promise<void> | undefined;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          },
          signal?: AbortSignal
        ) => {
          observedSignal = signal;
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
          });
          handlers.onDelta?.({ delta: "Visible streaming text " });
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
        status: "running",
        chat: { id: "chat-1" },
        userMessage: {
          id: "user-msg-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "Hello",
          attachments: [],
          createdAt: "2026-04-30T21:21:09.000Z"
        },
        assistantMessage: null,
        currentActivity: null,
        runtime: null,
        error: null
      });
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        activeTurn: null,
        messages: [
          {
            id: "user-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "Hello",
            attachments: [],
            createdAt: "2026-04-30T21:21:09.000Z"
          },
          {
            id: "assistant-msg-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Visible streaming text final",
            attachments: [],
            createdAt: "2026-04-30T21:21:10.000Z"
          }
        ]
      });

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        sendPromise = result.current.send("Hello", undefined, { clientTurnId: "client-turn-1" });
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(result.current.isStreaming).toBe(true));
      expect(
        result.current.messages.some((message) => message.id.startsWith("local-assistant-"))
      ).toBe(true);

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible"
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await vi.waitFor(() =>
        expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalledWith(
          "token-1",
          "client-turn-1"
        )
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      await vi.waitFor(() => {
        expect(result.current.messages.map((message) => message.id)).toEqual([
          "user-msg-1",
          "assistant-msg-1"
        ]);
      });
      expect(
        result.current.messages.filter((message) => message.role === "assistant")
      ).toHaveLength(1);
      expect(result.current.messages.some((message) => message.status === "streaming")).toBe(false);
      expect(result.current.isStreaming).toBe(false);
      expect(observedSignal?.aborted).toBe(true);
      await sendPromise?.catch(() => undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps authoritative interrupted partial text instead of the shorter streamed prefix", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
          onInterrupted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onDelta?.({ delta: "Hel" });
        handlers.onInterrupted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-partial-1",
              content: "Hello, saved partial answer"
            }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Hello");
    });

    const assistantEntry = result.current.entries.find(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "message" }> =>
        entry.kind === "message" && entry.message.role === "assistant"
    );

    expect(assistantEntry?.message.content).toBe("Hello, saved partial answer");
    expect(assistantEntry?.message.status).toBe("partial");
    expect(assistantEntry?.message.id).toBe("assistant-msg-partial-1");
  });

  it("does not leave an empty thinking placeholder streaming after an interrupted turn without text", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onTool?: (payload: {
            phase: "start" | "end";
            toolName: string;
            toolCallId: string;
            isError: boolean;
          }) => void;
          onInterrupted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onTool?.({
          phase: "start",
          toolName: "image_generate",
          toolCallId: "tool-1",
          isError: false
        });
        handlers.onInterrupted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-interrupted-1"
            }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("make an image");
    });

    const assistantEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "message" }> =>
        entry.kind === "message" && entry.message.role === "assistant"
    );

    expect(assistantEntries).toHaveLength(1);
    expect(assistantEntries[0]?.message.id).toBe("assistant-msg-interrupted-1");
    expect(assistantEntries[0]?.message.status).toBe("committed");
    expect(result.current.entries.some((entry) => entry.kind === "activity")).toBe(false);
    expect(result.current.isStreaming).toBe(false);
  });

  it("commits failed turn text without leaving a streaming thinking placeholder", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onFailed?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onFailed?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-failed-1",
              content: "Попытка не прошла.\nМогу сделать ещё раз."
            }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Нарисуй ещё себя");
    });

    const assistantEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "message" }> =>
        entry.kind === "message" && entry.message.role === "assistant"
    );

    expect(assistantEntries).toHaveLength(1);
    expect(assistantEntries[0]?.message.id).toBe("assistant-msg-failed-1");
    expect(assistantEntries[0]?.message.status).toBe("partial");
    expect(assistantEntries[0]?.message.content).toContain("Попытка не прошла");
    expect(result.current.isStreaming).toBe(false);
  });

  it("does not append a chat activity when the turn was degraded by quota fallback", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1", chatId: "chat-1", attachments: [] }
        });
        handlers.onCompleted?.({
          transport: {
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "keep going",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            },
            assistantMessage: {
              id: "assistant-msg-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Still here.",
              attachments: [],
              createdAt: "2026-04-25T17:45:45.000Z"
            },
            runtime: {
              respondedAt: "2026-04-25T17:45:45.000Z",
              degradedByQuotaFallback: true,
              quotaFallbackModel: "cheap-model",
              turnRouting: null
            }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("keep going");
    });

    expect(result.current.entries.some((entry) => entry.kind === "activity")).toBe(false);
  });

  it("keeps only the last live status for tool-driven turns", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onTool?: (payload: {
            phase: "start" | "end";
            toolName: string;
            toolCallId: string;
            isError: boolean;
          }) => void;
          onRuntimeDone?: (payload: { respondedAt: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onTool?.({
          phase: "start",
          toolName: "image_generate",
          toolCallId: "tool-1",
          isError: false
        });
        handlers.onTool?.({
          phase: "end",
          toolName: "image_generate",
          toolCallId: "tool-1",
          isError: false
        });
        handlers.onRuntimeDone?.({
          respondedAt: "2026-04-14T10:00:00.000Z"
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-1",
              attachments: []
            },
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Make an image");
    });

    const activityEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );

    expect(activityEntries).toHaveLength(0);
  });

  it("clears live status activity after the latest assistant reply completes", async () => {
    let sendCount = 0;
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onRuntimeDone?: (payload: { respondedAt: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        sendCount += 1;
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: `user-msg-${String(sendCount)}` }
        });
        handlers.onRuntimeDone?.({
          respondedAt: `2026-04-14T10:0${String(sendCount)}:00.000Z`
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: `assistant-msg-${String(sendCount)}`,
              attachments: []
            },
            userMessage: {
              id: `user-msg-${String(sendCount)}`,
              attachments: []
            },
            runtime: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("First");
    });

    await act(async () => {
      await result.current.send("Second");
    });

    const activityEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );

    expect(activityEntries).toHaveLength(0);
  });

  it("keeps the last real live activity instead of a synthetic response-ready badge", async () => {
    let finishTurn: (() => void) | undefined;
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onActivity?: (payload: {
            source: "skill" | "user" | "product" | "web";
            resultCount: number;
            skillName?: string | null;
            skillIconEmoji?: string | null;
          }) => void;
          onRuntimeDone?: (payload: { respondedAt: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onActivity?.({
          source: "skill",
          resultCount: 0,
          skillName: "Диетолог",
          skillIconEmoji: "✈️"
        });
        handlers.onActivity?.({
          source: "product",
          resultCount: 1
        });
        await new Promise<void>((resolve) => {
          finishTurn = () => {
            handlers.onRuntimeDone?.({
              respondedAt: "2026-04-14T10:08:00.000Z"
            });
            handlers.onCompleted?.({
              transport: {
                assistantMessage: {
                  id: "assistant-msg-1",
                  attachments: []
                },
                userMessage: {
                  id: "user-msg-1",
                  attachments: []
                },
                runtime: null
              }
            });
            resolve();
          };
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send("антисрыв-план на 3 строки");
      await Promise.resolve();
    });

    await waitFor(() => {
      const activityEntries = result.current.entries.filter(
        (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
          entry.kind === "activity"
      );
      expect(activityEntries).toHaveLength(1);
      expect(activityEntries[0]?.event.label).toBe("retrieval_product_started");
      expect(activityEntries[0]?.event.detail).toContain("skillBadgePrefix - ✈️");
      expect(activityEntries[0]?.event.detail).not.toContain("Диетолог");
    });

    await act(async () => {
      finishTurn?.();
      if (sendPromise !== undefined) {
        await sendPromise.catch(() => undefined);
      }
    });

    const activityAfterComplete = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );
    expect(activityAfterComplete).toHaveLength(0);
  });

  it("keeps only the latest project live status for project-mode streams", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onProjectActivity?: (payload: {
            stage: "plan";
            status: "started";
            summary: string;
            detail?: string;
          }) => void;
          onProjectReasoningSummary?: (payload: {
            kind: "plan";
            summary: string;
            detail?: string;
          }) => void;
          onRuntimeDone?: (payload: { respondedAt: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onProjectActivity?.({
          stage: "plan",
          status: "started",
          summary: "Building the analysis plan"
        });
        handlers.onProjectReasoningSummary?.({
          kind: "plan",
          summary: "Mapping the request, current files, and likely sources.",
          detail: "Checking whether the local material already answers the task."
        });
        // Keep the stream live so project status stays in the single
        // live-activity slot instead of being cleared by completion.
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Analyze the project pack", undefined, { chatMode: "project" });
    });

    const activityEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );

    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]?.event.label).toBe(
      "Mapping the request, current files, and likely sources."
    );
    expect(activityEntries[0]?.event.detail).toBe(
      "Checking whether the local material already answers the task."
    );
    expect(activityEntries[0]?.event.emphasis).toBe("strong");
  });

  it("shows tool activity during project-mode streams", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onProjectActivity?: (payload: {
            stage: "plan" | "gather" | "analyze" | "replan" | "synthesize";
            status: "started" | "completed";
            summary: string;
            detail?: string | null;
          }) => void;
          onProjectReasoningSummary?: (payload: {
            kind: "plan" | "check" | "gap" | "conflict" | "interim" | "replan" | "synthesis";
            summary: string;
            detail?: string | null;
          }) => void;
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
        handlers.onProjectActivity?.({
          stage: "plan",
          status: "started",
          summary: "Reviewing local context and planning the next step"
        });
        handlers.onTool?.({
          phase: "start",
          toolName: "knowledge_search",
          toolCallId: "tool-1",
          isError: false
        });
        handlers.onProjectReasoningSummary?.({
          kind: "check",
          summary: "Checking whether the gathered context actually answers the task."
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Analyze the project pack", undefined, { chatMode: "project" });
    });

    const activityEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );

    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]?.event.label).toBe("knowledge_search_started");
    expect(activityEntries[0]?.event.emphasis).toBe("strong");
  });

  it("preserves active Skill detail when the final badge is a tool completion", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onActivity?: (payload: {
            source: "skill" | "user" | "product" | "web";
            resultCount: number;
            skillName?: string | null;
            skillIconEmoji?: string | null;
          }) => void;
          onTool?: (payload: {
            phase: "start" | "end";
            toolName: string;
            toolCallId: string;
            isError: boolean;
          }) => void;
          onRuntimeDone?: (payload: { respondedAt: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onActivity?.({
          source: "skill",
          resultCount: 0,
          skillName: "Диетолог",
          skillIconEmoji: "🥦"
        });
        handlers.onTool?.({
          phase: "end",
          toolName: "image_generate",
          toolCallId: "tool-1",
          isError: false
        });
        handlers.onRuntimeDone?.({
          respondedAt: "2026-04-14T10:08:00.000Z"
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-1",
              attachments: []
            },
            userMessage: {
              id: "user-msg-1",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("сделай картинку с меню");
    });

    const activityEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );

    expect(activityEntries).toHaveLength(0);
  });

  it("does not materialize a final shadow routing badge after completion", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onRuntimeDone?: (payload: { respondedAt: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onRuntimeDone?.({
          respondedAt: "2026-04-14T10:03:00.000Z"
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-1",
              attachments: []
            },
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            runtime: {
              respondedAt: "2026-04-14T10:03:00.000Z",
              turnRouting: {
                mode: "shadow",
                executionMode: "premium",
                source: "llm"
              }
            }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Polish this email");
    });

    const activityEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );

    expect(activityEntries).toHaveLength(0);
  });

  it("does not leave active-mode routing metadata in a final activity badge", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onRuntimeDone?: (payload: { respondedAt: string }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onRuntimeDone?.({
          respondedAt: "2026-04-14T10:04:00.000Z"
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-1",
              attachments: []
            },
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            runtime: {
              respondedAt: "2026-04-14T10:04:00.000Z",
              turnRouting: {
                mode: "active",
                executionMode: "reasoning",
                source: "precheck"
              }
            }
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Compare two rollout strategies");
    });

    const activityEntries = result.current.entries.filter(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
        entry.kind === "activity"
    );

    expect(activityEntries).toHaveLength(0);
  });

  it("surfaces a recent auto-compaction notice after a turn refresh", async () => {
    assistantApiMocks.getChatMessages.mockResolvedValue({
      messages: [],
      nextCursor: null
    });
    assistantApiMocks.getChatCompactionState
      .mockResolvedValueOnce(
        createCompactionState({
          currentTokens: 7_800,
          autoCompactionEnabled: true
        })
      )
      .mockResolvedValueOnce(
        createCompactionState({
          currentTokens: null,
          compactionCount: 1,
          lastCompactedAt: "2026-04-14T10:00:30.000Z",
          autoCompactionEnabled: true
        })
      );
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-1",
              attachments: []
            },
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: []
            },
            runtime: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    await waitFor(() => {
      expect(result.current.compaction?.compactionCount).toBe(0);
    });

    await act(async () => {
      await result.current.send("Hello");
    });

    await waitFor(() => {
      expect(result.current.recentAutoCompaction).toEqual(
        expect.objectContaining({
          tokensBefore: 7_800,
          tokensAfter: null
        })
      );
    });
  });

  it("does not reconstruct tool status from historical media attachments", async () => {
    assistantApiMocks.getChatMessages.mockResolvedValue({
      messages: [
        {
          id: "server-user-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "make an image",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        {
          id: "server-assistant-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Done.",
          attachments: [
            {
              id: "att-1",
              attachmentType: "image",
              originalFilename: "image.png",
              mimeType: "image/png",
              sizeBytes: 123,
              processingStatus: "ready",
              createdAt: "2026-04-25T17:48:03.000Z"
            }
          ],
          createdAt: "2026-04-25T17:48:03.000Z"
        }
      ],
      nextCursor: null
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(
      result.current.entries.some(
        (entry) =>
          entry.kind === "activity" &&
          entry.event.type === "tool_use" &&
          entry.event.afterMessageId === "server-assistant-1"
      )
    ).toBe(false);
    expect(
      result.current.entries.filter(
        (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "message" }> =>
          entry.kind === "message"
      )
    ).toHaveLength(2);
  });

  it("restores current tool status from active turn status after reload", async () => {
    window.sessionStorage.setItem("persai.active-web-turn.v1.thread-1", "turn-1");
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: "Chat",
        deepModeEnabled: false,
        archivedAt: null,
        lastMessageAt: "2026-04-25T17:45:35.000Z",
        createdAt: "2026-04-25T17:45:35.000Z",
        updatedAt: "2026-04-25T17:45:35.000Z"
      },
      userMessage: {
        id: "server-user-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "search this",
        attachments: [],
        createdAt: "2026-04-25T17:45:35.000Z"
      },
      assistantMessage: null,
      currentActivity: {
        type: "tool_use",
        toolName: "web_search",
        toolCallId: "tool-1",
        phase: "start",
        isError: false,
        updatedAt: "2026-04-25T17:45:36.000Z"
      },
      runtime: null,
      error: null
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.chatId).toBe("chat-1");
      expect(result.current.entries).toContainEqual(
        expect.objectContaining({
          kind: "activity",
          event: expect.objectContaining({
            type: "tool_use",
            label: "Searching the web"
          })
        })
      );
    });
  });

  it("namespaces stored active turns by assistant id", async () => {
    window.sessionStorage.setItem("persai.active-web-turn.v1.thread-1", "turn-stale");
    window.sessionStorage.setItem("persai.active-web-turn.v1.assistant-2::thread-1", "turn-2");
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
      status: "running",
      chat: {
        id: "chat-2",
        assistantId: "assistant-2",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: "Scoped chat",
        deepModeEnabled: false,
        archivedAt: null,
        lastMessageAt: "2026-04-25T17:45:35.000Z",
        createdAt: "2026-04-25T17:45:35.000Z",
        updatedAt: "2026-04-25T17:45:35.000Z"
      },
      userMessage: {
        id: "server-user-2",
        chatId: "chat-2",
        assistantId: "assistant-2",
        author: "user",
        content: "search this",
        attachments: [],
        createdAt: "2026-04-25T17:45:35.000Z"
      },
      assistantMessage: null,
      currentActivity: null,
      runtime: null,
      error: null
    });

    const { result } = renderHook(() => useChat("thread-1", { assistantId: "assistant-2" }), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => {
      expect(result.current.chatId).toBe("chat-2");
    });
    expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalledWith(
      "token-1",
      "turn-2"
    );
  });

  it("renders server-projected activeTurn from the messages response", async () => {
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      messages: [
        {
          id: "older-user-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "older",
          attachments: [],
          createdAt: "2026-04-25T17:40:35.000Z"
        },
        {
          id: "older-assistant-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "older answer",
          attachments: [],
          createdAt: "2026-04-25T17:40:36.000Z"
        }
      ],
      activeTurn: {
        clientTurnId: "turn-1",
        status: "running",
        updatedAt: "2026-04-25T17:45:36.000Z",
        currentActivity: {
          type: "tool_use",
          toolName: "web_search",
          toolCallId: "tool-1",
          phase: "start",
          isError: false,
          updatedAt: "2026-04-25T17:45:36.000Z"
        },
        pendingUserMessageId: "server-user-active",
        assistantMessageId: null,
        chat: {
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          deepModeEnabled: false,
          archivedAt: null,
          lastMessageAt: "2026-04-25T17:45:35.000Z",
          createdAt: "2026-04-25T17:45:35.000Z",
          updatedAt: "2026-04-25T17:45:35.000Z"
        },
        userMessage: {
          id: "server-user-active",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "search now",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        assistantMessage: null,
        canReattach: true
      }
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "older-user-1",
      "older-assistant-1",
      "server-user-active",
      "active-assistant-turn-1"
    ]);
    expect(result.current.entries).toContainEqual(
      expect.objectContaining({
        kind: "activity",
        event: expect.objectContaining({
          type: "tool_use",
          label: "Searching the web"
        })
      })
    );
    expect(window.sessionStorage.getItem("persai.active-web-turn.v1.thread-1")).toBe("turn-1");
  });

  it("preserves await toolInputPreview countdown when hydrating activeTurn overlay", async () => {
    const deadlinePreview = `await-deadline:${Date.now() + 30_000}`;
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      messages: [],
      activeTurn: {
        clientTurnId: "turn-await-1",
        status: "running",
        updatedAt: "2026-04-25T17:45:36.000Z",
        currentActivity: {
          type: "tool_use",
          toolName: "await",
          toolCallId: "tool-await-1",
          phase: "start",
          isError: false,
          toolInputPreview: deadlinePreview,
          updatedAt: "2026-04-25T17:45:36.000Z"
        },
        pendingUserMessageId: "server-user-await",
        assistantMessageId: null,
        chat: {
          id: "chat-1",
          assistantId: "assistant-1",
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          deepModeEnabled: false,
          archivedAt: null,
          lastMessageAt: "2026-04-25T17:45:35.000Z",
          createdAt: "2026-04-25T17:45:35.000Z",
          updatedAt: "2026-04-25T17:45:35.000Z"
        },
        userMessage: {
          id: "server-user-await",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "wait please",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        assistantMessage: null,
        canReattach: true
      }
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.entries).toContainEqual(
      expect.objectContaining({
        kind: "activity",
        event: expect.objectContaining({
          type: "tool_use",
          toolName: "await",
          detail: deadlinePreview
        })
      })
    );
  });

  it("does not replace a live local stream with an empty server activeTurn overlay", async () => {
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onHeadersOk?: () => void;
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "server-user-active" }
        });
        handlers.onDelta?.({ delta: "Already streaming" });
        await Promise.resolve();
        await new Promise(() => undefined);
      }
    );
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      messages: [],
      activeTurn: {
        clientTurnId: "turn-live",
        status: "running",
        updatedAt: "2026-04-25T17:45:36.000Z",
        currentActivity: null,
        pendingUserMessageId: "server-user-active",
        assistantMessageId: null,
        chat: null,
        userMessage: {
          id: "server-user-active",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "draw",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        assistantMessage: null,
        canReattach: true
      }
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      void result.current.send("draw");
      await Promise.resolve();
    });
    await act(async () => {
      for (const callback of Array.from(rafCallbacks.values())) {
        callback(0);
      }
    });
    await waitFor(() =>
      expect(
        result.current.messages.some((message) => message.content === "Already streaming")
      ).toBe(true)
    );

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(assistantApiMocks.reattachAssistantWebChatTurnStream).not.toHaveBeenCalled();
    expect(result.current.messages.some((message) => message.content === "Already streaming")).toBe(
      true
    );
    expect(result.current.messages.map((message) => message.id)).not.toContain(
      "active-assistant-turn-live"
    );
  });

  it("keeps a reattached running assistant bubble streaming after status refresh", async () => {
    window.sessionStorage.setItem("persai.active-web-turn.v1.thread-A", "turn-A");
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
      status: "running",
      chat: { id: "chat-A" },
      userMessage: {
        id: "server-user-A",
        chatId: "chat-A",
        assistantId: "assistant-1",
        author: "user",
        content: "write a long text",
        attachments: [],
        createdAt: "2026-04-25T17:45:35.000Z"
      },
      assistantMessage: {
        id: "server-assistant-A",
        chatId: "chat-A",
        assistantId: "assistant-1",
        author: "assistant",
        content: "Already streamed",
        attachments: [],
        createdAt: "2026-04-25T17:45:36.000Z"
      },
      currentActivity: null,
      runtime: null,
      error: null
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
      async (
        _token: string,
        _clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
          onDelta?: (payload: { delta: string }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onTurnStatus?.({
          turn: {
            status: "running",
            chat: { id: "chat-A" },
            userMessage: {
              id: "server-user-A",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "write a long text",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            },
            assistantMessage: {
              id: "server-assistant-A",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Already streamed",
              attachments: [],
              createdAt: "2026-04-25T17:45:36.000Z"
            },
            currentActivity: null,
            runtime: null,
            error: null
          }
        });
        handlers.onDelta?.({ delta: " and keeps going" });
      }
    );

    const { result } = renderHook(() => useChat("thread-A"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: "server-user-A",
          role: "user"
        }),
        expect.objectContaining({
          id: "server-assistant-A",
          role: "assistant",
          status: "streaming",
          content: "Already streamed and keeps going"
        })
      ]);
    });
  });

  it("attaches reattached tool activity to the live assistant after history merge", async () => {
    window.sessionStorage.setItem("persai.active-web-turn.v1.thread-A", "turn-A");
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
      status: "running",
      chat: { id: "chat-A" },
      userMessage: {
        id: "server-user-A",
        chatId: "chat-A",
        assistantId: "assistant-1",
        author: "user",
        content: "continue",
        attachments: [],
        createdAt: "2026-04-25T17:45:35.000Z"
      },
      assistantMessage: {
        id: "server-assistant-A",
        chatId: "chat-A",
        assistantId: "assistant-1",
        author: "assistant",
        content: "Working",
        attachments: [],
        createdAt: "2026-04-25T17:45:36.000Z"
      },
      currentActivity: null,
      runtime: null,
      error: null
    });
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      messages: [
        {
          id: "older-user-A",
          chatId: "chat-A",
          assistantId: "assistant-1",
          author: "user",
          content: "older question",
          attachments: [],
          createdAt: "2026-04-25T17:40:35.000Z"
        },
        {
          id: "older-assistant-A",
          chatId: "chat-A",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Older answer",
          attachments: [],
          createdAt: "2026-04-25T17:41:05.000Z"
        }
      ]
    });
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
      async (
        _token: string,
        _clientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTool?: (payload: {
            phase: "start" | "end";
            toolName: string;
            toolCallId: string;
            isError: boolean;
          }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onTool?.({
          phase: "start",
          toolName: "web_search",
          toolCallId: "tool-1",
          isError: false
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-A"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    await act(async () => {
      await result.current.loadHistory("chat-A");
    });

    await waitFor(() => {
      const activityEntries = result.current.entries.filter(
        (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
          entry.kind === "activity"
      );
      expect(activityEntries).toHaveLength(1);
      expect(activityEntries[0]?.event.label).toBe("Searching the web");
      expect(activityEntries[0]?.event.afterMessageId).toBe("server-assistant-A");
      expect(activityEntries[0]?.event.afterMessageId).not.toBe("older-assistant-A");
    });
  });

  it("keeps a running activeTurn authoritative when same-id history already has an early assistant row", async () => {
    const threadKey = "thread-same-id-running-overlay";
    const chatId = "chat-same-id-running-overlay";
    const clientTurnId = "turn-same-id-running-overlay";
    const runningTurn = {
      status: "running" as const,
      chat: {
        id: chatId,
        assistantId: "assistant-1",
        surface: "web" as const,
        surfaceThreadKey: threadKey,
        title: "Chat",
        chatMode: "normal" as const,
        deepModeEnabled: false,
        skillDecisionState: null,
        archivedAt: null,
        lastMessageAt: "2026-04-25T17:45:40.000Z",
        createdAt: "2026-04-25T17:45:35.000Z",
        updatedAt: "2026-04-25T17:45:40.000Z"
      },
      userMessage: {
        id: "server-user-active",
        chatId,
        assistantId: "assistant-1",
        author: "user" as const,
        content: "draw",
        attachments: [],
        createdAt: "2026-04-25T17:45:35.000Z"
      },
      assistantMessage: {
        id: "server-early-assistant",
        chatId,
        assistantId: "assistant-1",
        author: "assistant" as const,
        content: "Done",
        attachments: [],
        createdAt: "2026-04-25T17:45:40.000Z"
      },
      currentActivity: null,
      runtime: null,
      error: null
    };
    let releaseReattach: (() => void) | undefined;

    window.sessionStorage.setItem(`persai.active-web-turn.v1.${threadKey}`, clientTurnId);
    assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
      async (_token: string, requestedClientTurnId: string) => {
        if (requestedClientTurnId !== clientTurnId) {
          return {
            status: "unknown" as const,
            chat: null,
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          };
        }
        return runningTurn;
      }
    );
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      async (
        _token: string,
        requestedClientTurnId: string,
        handlers: {
          onHeadersOk?: () => void;
          onTurnStatus?: (payload: { turn: unknown }) => void;
        }
      ) => {
        handlers.onHeadersOk?.();
        handlers.onTurnStatus?.({
          turn: await assistantApiMocks.getAssistantWebChatTurnStatus(
            "token-1",
            requestedClientTurnId
          )
        });
        await new Promise<void>((resolve) => {
          releaseReattach = resolve;
        });
      }
    );
    assistantApiMocks.getChatMessages.mockImplementation(
      async (_token: string, requestedChatId: string) => {
        if (requestedChatId !== chatId) {
          return {
            nextCursor: null,
            messages: [],
            activeMediaJobs: [],
            activeDocumentJobs: [],
            activeSandboxJobs: []
          };
        }
        return {
          nextCursor: null,
          messages: [
            {
              id: "older-user-1",
              chatId,
              assistantId: "assistant-1",
              author: "user" as const,
              content: "older",
              attachments: [],
              createdAt: "2026-04-25T17:44:35.000Z"
            },
            runningTurn.userMessage,
            runningTurn.assistantMessage
          ],
          activeTurn: {
            clientTurnId,
            status: "running" as const,
            updatedAt: "2026-04-25T17:45:41.000Z",
            currentActivity: null,
            pendingUserMessageId: runningTurn.userMessage.id,
            assistantMessageId: runningTurn.assistantMessage.id,
            chat: null,
            userMessage: runningTurn.userMessage,
            assistantMessage: runningTurn.assistantMessage,
            canReattach: true
          },
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        };
      }
    );

    const { result } = renderHook(() => useChat(threadKey), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(assistantApiMocks.reattachAssistantWebChatTurnStream).toHaveBeenCalledWith(
      "token-1",
      clientTurnId,
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Number)
    );

    await act(async () => {
      await result.current.loadHistory(chatId);
    });

    const ids = result.current.messages.map((message) => message.id);
    expect(result.current.isStreaming).toBe(true);
    expect(ids).toEqual(["older-user-1", "server-user-active", "server-early-assistant"]);
    expect(ids.filter((id) => id === "server-user-active")).toHaveLength(1);
    expect(ids.filter((id) => id === "server-early-assistant")).toHaveLength(1);
    expect(
      result.current.messages.find((message) => message.id === "server-early-assistant")?.status
    ).toBe("streaming");
    expect(window.sessionStorage.getItem(`persai.active-web-turn.v1.${threadKey}`)).toBe(
      clientTurnId
    );

    act(() => {
      releaseReattach?.();
      result.current.stop();
    });
  });

  it("does not clear a live stream when activeTurn is null but history only has older assistant messages", async () => {
    let sendPromise: Promise<void> | undefined;
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onHeadersOk?: () => void;
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
        },
        signal?: AbortSignal
      ) => {
        handlers.onHeadersOk?.();
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "server-user-live", chatId: "chat-1", attachments: [] }
        });
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }
    );
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      activeTurn: null,
      messages: [
        {
          id: "older-user-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "older",
          attachments: [],
          createdAt: "2026-04-25T17:44:35.000Z"
        },
        {
          id: "older-assistant-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "older answer",
          attachments: [],
          createdAt: "2026-04-25T17:44:40.000Z"
        }
      ]
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await act(async () => {
      sendPromise = result.current.send("write a long answer");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages.map((message) => message.id)).toContain("server-user-live");
    expect(
      result.current.messages.some(
        (message) => message.role === "assistant" && message.status === "streaming"
      )
    ).toBe(true);

    act(() => {
      result.current.stop();
    });
    await sendPromise?.catch(() => undefined);
  });

  it("retries active turn restore after reload until the server exposes the running turn", async () => {
    vi.useFakeTimers();
    try {
      window.sessionStorage.setItem("persai.active-web-turn.v1.thread-1", "turn-1");
      assistantApiMocks.getAssistantWebChatTurnStatus
        .mockResolvedValueOnce({
          status: "unknown",
          chat: null,
          userMessage: null,
          assistantMessage: null,
          currentActivity: null,
          runtime: null,
          error: null
        })
        .mockResolvedValueOnce({
          status: "accepted",
          chat: null,
          userMessage: null,
          assistantMessage: null,
          currentActivity: null,
          runtime: null,
          error: null
        })
        .mockResolvedValueOnce({
          status: "running",
          chat: {
            id: "chat-1",
            assistantId: "assistant-1",
            surface: "web",
            surfaceThreadKey: "thread-1",
            title: "Chat",
            deepModeEnabled: false,
            archivedAt: null,
            lastMessageAt: "2026-04-25T17:45:35.000Z",
            createdAt: "2026-04-25T17:45:35.000Z",
            updatedAt: "2026-04-25T17:45:35.000Z"
          },
          userMessage: {
            id: "server-user-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "draw it",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          },
          assistantMessage: null,
          currentActivity: {
            type: "tool_use",
            toolName: "image_generate",
            toolCallId: "tool-1",
            phase: "start",
            isError: false,
            updatedAt: "2026-04-25T17:45:36.000Z"
          },
          runtime: null,
          error: null
        });

      renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
      });

      expect(
        assistantApiMocks.getAssistantWebChatTurnStatus.mock.calls.length
      ).toBeGreaterThanOrEqual(3);
      expect(assistantApiMocks.reattachAssistantWebChatTurnStream).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps restored active tool status when history loads after reload", async () => {
    // Unique turn + call-counted status: first restore refresh is `running`,
    // later reattach polls stay `unknown` so the default reattach mock does
    // not finish with latestResult===running and clear isStreaming.
    // getChatMessages is chatId-keyed (not Once) so late prior-test fetches
    // cannot steal the older-history page and leave only the live pair.
    const threadKey = "thread-restore-tool-status";
    const chatId = "chat-restore-tool-status";
    const clientTurnId = "turn-restore-tool-status";
    let statusCallsForTurn = 0;
    window.sessionStorage.setItem(`persai.active-web-turn.v1.${threadKey}`, clientTurnId);
    assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
      async (_token: string, requestedClientTurnId: string) => {
        if (requestedClientTurnId !== clientTurnId) {
          return {
            status: "unknown",
            chat: null,
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          };
        }
        statusCallsForTurn += 1;
        if (statusCallsForTurn > 1) {
          return {
            status: "unknown",
            chat: null,
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          };
        }
        return {
          status: "running",
          chat: {
            id: chatId,
            assistantId: "assistant-1",
            surface: "web",
            surfaceThreadKey: threadKey,
            title: "Chat",
            deepModeEnabled: false,
            archivedAt: null,
            lastMessageAt: "2026-04-25T17:45:35.000Z",
            createdAt: "2026-04-25T17:45:35.000Z",
            updatedAt: "2026-04-25T17:45:35.000Z"
          },
          userMessage: {
            id: "server-user-restore-tool",
            chatId,
            assistantId: "assistant-1",
            author: "user",
            content: "draw it",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          },
          assistantMessage: null,
          currentActivity: {
            type: "tool_use",
            toolName: "image_generate",
            toolCallId: "tool-restore-1",
            phase: "start",
            isError: false,
            updatedAt: "2026-04-25T17:45:36.000Z"
          },
          runtime: null,
          error: null
        };
      }
    );
    assistantApiMocks.getChatMessages.mockImplementation(
      async (_token: string, requestedChatId: string) => {
        if (requestedChatId !== chatId) {
          return {
            nextCursor: null,
            messages: [],
            activeMediaJobs: [],
            activeDocumentJobs: [],
            activeSandboxJobs: []
          };
        }
        return {
          nextCursor: null,
          messages: [
            {
              id: "older-user-restore-tool",
              chatId,
              assistantId: "assistant-1",
              author: "user",
              content: "older question",
              attachments: [],
              createdAt: "2026-04-25T17:40:35.000Z"
            }
          ]
        };
      }
    );

    const { result } = renderHook(() => useChat(threadKey), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    await act(async () => {
      await result.current.loadHistory(chatId);
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "older-user-restore-tool",
      "server-user-restore-tool",
      `local-assistant-${clientTurnId}`
    ]);
    // ADR-165 amendment: image/video live tool activity is visible again (not hidden).
    expect(
      result.current.entries.some(
        (entry) => entry.kind === "activity" && entry.event.label === "Generating image"
      )
    ).toBe(true);
  });

  it("keeps a restored turn closed when a passive stream close follows committed history", async () => {
    window.sessionStorage.setItem("persai.active-web-turn.v1.thread-1", "turn-1");
    let rejectPassiveReattach: ((reason?: unknown) => void) | null = null;
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPassiveReattach = reject;
        })
    );
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
      status: "running",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: "Chat",
        deepModeEnabled: false,
        archivedAt: null,
        lastMessageAt: "2026-04-25T17:45:35.000Z",
        createdAt: "2026-04-25T17:45:35.000Z",
        updatedAt: "2026-04-25T17:45:35.000Z"
      },
      userMessage: {
        id: "server-user-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "draw it",
        attachments: [],
        createdAt: "2026-04-25T17:45:35.000Z"
      },
      assistantMessage: {
        id: "server-active-assistant-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant",
        content: "Сейчас",
        attachments: [],
        createdAt: "2026-04-25T17:45:36.000Z"
      },
      currentActivity: {
        type: "tool_use",
        toolName: "web_fetch",
        toolCallId: "tool-1",
        phase: "start",
        isError: false,
        updatedAt: "2026-04-25T17:45:36.000Z"
      },
      runtime: null,
      error: null
    });
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      messages: [
        {
          id: "server-user-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "draw it",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        {
          id: "server-final-assistant-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Готово.",
          attachments: [],
          createdAt: "2026-04-25T17:46:05.000Z"
        }
      ]
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => {
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-1",
        "server-active-assistant-1"
      ]);
      expect(result.current.isStreaming).toBe(true);
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "server-user-1",
      "server-final-assistant-1"
    ]);
    expect(result.current.entries).toEqual([
      expect.objectContaining({
        kind: "message",
        message: expect.objectContaining({ id: "server-user-1" })
      }),
      expect.objectContaining({
        kind: "message",
        message: expect.objectContaining({ id: "server-final-assistant-1" })
      })
    ]);
    expect(window.sessionStorage.getItem("persai.active-web-turn.v1.thread-1")).toBeNull();

    await act(async () => {
      rejectPassiveReattach?.(new Error("Stream closed before terminal event."));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.hasOpenTurn).toBe(false);
      expect(result.current.issue).toBeNull();
    });
    expect(assistantApiMocks.reattachAssistantWebChatTurnStream).toHaveBeenCalledTimes(1);
  });

  it("loadHistory keeps the live cursor when history has active user but only an older assistant", async () => {
    const threadKey = "thread-live-cursor-older-assistant";
    const chatId = "chat-live-cursor-older-assistant";
    const clientTurnId = "turn-live-cursor-older-assistant";
    let statusCallsForTurn = 0;
    window.sessionStorage.setItem(`persai.active-web-turn.v1.${threadKey}`, clientTurnId);
    assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
      async (_token: string, requestedClientTurnId: string) => {
        if (requestedClientTurnId !== clientTurnId) {
          return {
            status: "unknown",
            chat: null,
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          };
        }
        statusCallsForTurn += 1;
        if (statusCallsForTurn > 1) {
          return {
            status: "unknown",
            chat: null,
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          };
        }
        return {
          status: "running",
          chat: {
            id: chatId,
            assistantId: "assistant-1",
            surface: "web",
            surfaceThreadKey: threadKey,
            title: "Chat",
            deepModeEnabled: false,
            archivedAt: null,
            lastMessageAt: "2026-04-25T17:45:35.000Z",
            createdAt: "2026-04-25T17:45:35.000Z",
            updatedAt: "2026-04-25T17:45:35.000Z"
          },
          userMessage: {
            id: "server-user-active-cursor",
            chatId,
            assistantId: "assistant-1",
            author: "user",
            content: "continue",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          },
          assistantMessage: null,
          currentActivity: {
            type: "tool_use",
            toolName: "web_fetch",
            toolCallId: "tool-cursor-1",
            phase: "start",
            isError: false,
            updatedAt: "2026-04-25T17:45:36.000Z"
          },
          runtime: null,
          error: null
        };
      }
    );
    assistantApiMocks.getChatMessages.mockImplementation(
      async (_token: string, requestedChatId: string) => {
        if (requestedChatId !== chatId) {
          return {
            nextCursor: null,
            messages: [],
            activeMediaJobs: [],
            activeDocumentJobs: [],
            activeSandboxJobs: []
          };
        }
        return {
          nextCursor: null,
          messages: [
            {
              id: "server-user-old-cursor",
              chatId,
              assistantId: "assistant-1",
              author: "user",
              content: "older question",
              attachments: [],
              createdAt: "2026-04-25T17:40:35.000Z"
            },
            {
              id: "server-assistant-old-cursor",
              chatId,
              assistantId: "assistant-1",
              author: "assistant",
              content: "Older answer.",
              attachments: [],
              createdAt: "2026-04-25T17:41:05.000Z"
            },
            {
              id: "server-user-active-cursor",
              chatId,
              assistantId: "assistant-1",
              author: "user",
              content: "continue",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            }
          ]
        };
      }
    );

    const { result } = renderHook(() => useChat(threadKey), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-active-cursor",
        `local-assistant-${clientTurnId}`
      ]);
    });

    await act(async () => {
      await result.current.loadHistory(chatId);
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "server-user-old-cursor",
      "server-assistant-old-cursor",
      "server-user-active-cursor",
      `local-assistant-${clientTurnId}`
    ]);
    expect(result.current.entries).toContainEqual(
      expect.objectContaining({
        kind: "activity",
        event: expect.objectContaining({ label: "Reading the page" })
      })
    );
    expect(window.sessionStorage.getItem(`persai.active-web-turn.v1.${threadKey}`)).toBe(
      clientTurnId
    );
  });

  it("keeps a completed turn-status result in the thread cache after switching away", async () => {
    window.sessionStorage.setItem("persai.active-web-turn.v1.thread-1", "turn-1");
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
      status: "completed",
      chat: {
        id: "chat-1",
        assistantId: "assistant-1",
        surface: "web",
        surfaceThreadKey: "thread-1",
        title: "Chat",
        deepModeEnabled: false,
        archivedAt: null,
        lastMessageAt: "2026-04-25T17:46:05.000Z",
        createdAt: "2026-04-25T17:45:35.000Z",
        updatedAt: "2026-04-25T17:46:05.000Z"
      },
      userMessage: {
        id: "server-user-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "user",
        content: "draw it",
        attachments: [],
        createdAt: "2026-04-25T17:45:35.000Z"
      },
      assistantMessage: {
        id: "server-assistant-1",
        chatId: "chat-1",
        assistantId: "assistant-1",
        author: "assistant",
        content: "Готово.",
        attachments: [
          {
            id: "att-1",
            attachmentType: "image",
            originalFilename: "image.png",
            mimeType: "image/png",
            sizeBytes: 123,
            processingStatus: "ready",
            createdAt: "2026-04-25T17:46:05.000Z"
          }
        ],
        createdAt: "2026-04-25T17:46:05.000Z"
      },
      currentActivity: null,
      runtime: {
        respondedAt: "2026-04-25T17:46:05.000Z",
        degradedByQuotaFallback: false,
        quotaFallbackReason: null,
        quotaFallbackModel: null
      },
      error: null
    });

    const { result, rerender } = renderHook(
      ({ threadKey }: { threadKey: string }) => useChat(threadKey),
      {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>,
        initialProps: { threadKey: "thread-1" }
      }
    );

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-1",
        "server-assistant-1"
      ]);
    });

    rerender({ threadKey: "thread-2" });
    expect(result.current.messages).toHaveLength(0);

    rerender({ threadKey: "thread-1" });
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "server-user-1",
      "server-assistant-1"
    ]);
    expect(result.current.messages[1]?.attachments?.[0]?.id).toBe("att-1");
  });

  it("restores previously loaded chat history from memory when switching threads", async () => {
    let chatAReturnsUpdatedPage = false;
    assistantApiMocks.getChatMessages.mockImplementation(async (_token: string, chatId: string) => {
      if (chatId === "chat-b") {
        return {
          nextCursor: null,
          messages: [
            {
              id: "chat-b-user-1",
              chatId: "chat-b",
              assistantId: "assistant-1",
              author: "user",
              content: "Question B",
              attachments: [],
              createdAt: "2026-04-25T17:46:35.000Z"
            }
          ]
        };
      }
      if (chatId === "chat-a") {
        if (chatAReturnsUpdatedPage) {
          return {
            nextCursor: null,
            messages: [
              {
                id: "chat-a-user-2",
                chatId: "chat-a",
                assistantId: "assistant-1",
                author: "user",
                content: "New Question A",
                attachments: [],
                createdAt: "2026-04-25T17:47:35.000Z"
              },
              {
                id: "chat-a-assistant-2",
                chatId: "chat-a",
                assistantId: "assistant-1",
                author: "assistant",
                content: "New Answer A",
                attachments: [],
                createdAt: "2026-04-25T17:47:36.000Z"
              }
            ]
          };
        }
        return {
          nextCursor: "cursor-a",
          messages: [
            {
              id: "chat-a-user-1",
              chatId: "chat-a",
              assistantId: "assistant-1",
              author: "user",
              content: "Question A",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            },
            {
              id: "chat-a-assistant-1",
              chatId: "chat-a",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Answer A",
              attachments: [],
              createdAt: "2026-04-25T17:45:36.000Z"
            }
          ]
        };
      }
      return { nextCursor: null, messages: [] };
    });

    const { result, rerender } = renderHook(
      ({ threadKey }: { threadKey: string }) => useChat(threadKey),
      {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>,
        initialProps: { threadKey: "thread-a" }
      }
    );

    await act(async () => {
      await result.current.loadHistory("chat-a");
    });
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "Question A",
      "Answer A"
    ]);
    expect(result.current.hasOlderMessages).toBe(true);

    rerender({ threadKey: "thread-b" });
    await act(async () => {
      await result.current.loadHistory("chat-b");
    });
    expect(result.current.messages.map((message) => message.content)).toEqual(["Question B"]);

    rerender({ threadKey: "thread-a" });
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "Question A",
      "Answer A"
    ]);
    expect(result.current.historyLoading).toBe(false);
    expect(result.current.hasOlderMessages).toBe(true);

    chatAReturnsUpdatedPage = true;
    const chatAFetchesBeforeReload = assistantApiMocks.getChatMessages.mock.calls.filter(
      (call) => call[1] === "chat-a"
    ).length;
    await act(async () => {
      await result.current.loadHistory("chat-a");
    });
    const chatAFetchesAfterReload = assistantApiMocks.getChatMessages.mock.calls.filter(
      (call) => call[1] === "chat-a"
    ).length;
    expect(chatAFetchesAfterReload - chatAFetchesBeforeReload).toBe(1);
    expect(assistantApiMocks.getChatMessages.mock.calls.some((call) => call[1] === "chat-b")).toBe(
      true
    );
    expect(result.current.messages.map((message) => message.content)).toEqual([
      "New Question A",
      "New Answer A",
      "Question A",
      "Answer A"
    ]);
  });

  it("uploads eligible documents into the knowledge base when requested", async () => {
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    assistantApiMocks.stageWebChatAttachment.mockResolvedValue({
      chatId: "chat-1",
      messageId: "staged-msg-1",
      attachment: {
        id: "att-1",
        messageId: "staged-msg-1",
        chatId: "chat-1",
        attachmentType: "document",
        originalFilename: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
        processingStatus: "ready",
        createdAt: "2026-04-14T10:00:00.000Z"
      }
    });
    assistantApiMocks.uploadAssistantKnowledgeSource.mockResolvedValue({
      id: "source-1",
      displayName: null,
      originalFilename: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      status: "ready",
      currentVersion: 1,
      chunkCount: 1,
      lastIndexedAt: "2026-04-14T10:00:00.000Z",
      lastReindexRequestedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-04-14T10:00:00.000Z",
      updatedAt: "2026-04-14T10:00:00.000Z"
    });
    assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
      async (
        _token: string,
        _payload: unknown,
        handlers: {
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onCompleted?: (payload: { transport: unknown }) => void;
        }
      ) => {
        handlers.onStarted?.({
          chat: { id: "chat-1" },
          userMessage: { id: "user-msg-1" }
        });
        handlers.onCompleted?.({
          transport: {
            assistantMessage: {
              id: "assistant-msg-1",
              attachments: []
            },
            userMessage: {
              id: "user-msg-1",
              chatId: "chat-1",
              attachments: [
                {
                  id: "att-1",
                  attachmentType: "document",
                  originalFilename: "notes.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 5,
                  processingStatus: "ready",
                  createdAt: "2026-04-14T10:00:00.000Z"
                }
              ]
            },
            runtime: null
          }
        });
      }
    );

    const { result } = renderHook(() => useChat("thread-1"));

    await act(async () => {
      await result.current.send("Use this doc", [file], { addToKnowledgeBase: true });
    });

    expect(assistantApiMocks.stageWebChatAttachment).toHaveBeenCalledWith(
      "token-1",
      "thread-1",
      expect.any(String),
      expect.any(String),
      file,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onProgress: expect.any(Function)
      })
    );
    expect(assistantApiMocks.stageWebChatAttachment.mock.calls[0]?.[5]).not.toHaveProperty(
      "hardTimeoutMs"
    );
    expect(assistantApiMocks.stageWebChatAttachment.mock.calls[0]?.[5]).not.toHaveProperty(
      "stallTimeoutMs"
    );
    await waitFor(() => {
      expect(assistantApiMocks.uploadAssistantKnowledgeSource).toHaveBeenCalledWith(
        "token-1",
        file
      );
    });
    await waitFor(() => {
      expect(result.current.entries).toContainEqual(
        expect.objectContaining({
          kind: "activity",
          event: expect.objectContaining({
            label: "knowledgeUploadReady"
          })
        })
      );
    });
  });

  describe("pending-send slot (ADR-075)", () => {
    afterEach(() => {
      // Restore navigator.onLine if a test stubbed it.
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    });

    it("marks the user bubble as send_failed immediately when offline", async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("Hello while offline");
      });

      expect(assistantApiMocks.streamAssistantWebChatTurn).not.toHaveBeenCalled();
      expect(result.current.pendingSendStatus).toBe("send_failed_confirmed");
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]).toMatchObject({
        role: "user",
        content: "Hello while offline",
        status: "send_failed_confirmed"
      });
    });

    it("blocks a second send while a previous one is in send_failed", async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("first");
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_confirmed");

      // Second send must be a no-op until the user retries or cancels.
      await act(async () => {
        await result.current.send("second");
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.content).toBe("first");
      expect(assistantApiMocks.streamAssistantWebChatTurn).not.toHaveBeenCalled();
    });

    it("flips the bubble to committed when the stream returns 2xx headers", async () => {
      const stream = assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onCompleted?.({
            transport: {
              userMessage: { id: "u1", chatId: "chat-1" },
              assistantMessage: { id: "a1", content: "ok" }
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("hi");
      });

      expect(stream).toHaveBeenCalledTimes(1);
      expect(result.current.pendingSendStatus).toBeNull();
      const userMsg = result.current.messages.find((m) => m.role === "user");
      expect(userMsg?.status).toBe("committed");
    });

    it("flips the bubble to send_failed when the stream aborts before headers", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (_token: string, _payload: unknown, _handlers: unknown, signal?: AbortSignal) => {
          await new Promise<never>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        const sendPromise = result.current.send("slow");
        // Force the headers timeout immediately by aborting from outside —
        // this mirrors what the headersTimer setTimeout does in production
        // when 10s elapse without the server returning 2xx.
        await new Promise((r) => setTimeout(r, 0));
        result.current.stop();
        await sendPromise;
      });

      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");
      const userMsg = result.current.messages.find((m) => m.role === "user");
      expect(userMsg?.status).toBe("send_failed_unconfirmed");
      // Assistant placeholder must not linger after pre-headers failure.
      expect(result.current.messages.some((m) => m.role === "assistant")).toBe(false);
    });

    it("surfaces chat_message_limit as a banner issue instead of a send_failed bubble", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
        new ContractsApiError(
          "This chat has reached its message limit.",
          409,
          {
            error: {
              code: "chat_message_limit_reached",
              message: "This chat has reached its message limit."
            }
          },
          "chat_message_limit_reached"
        )
      );

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("limit me");
      });

      expect(result.current.issue).toMatchObject({
        classId: "chat_message_limit",
        message: "This chat has reached its message limit."
      });
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages).toHaveLength(0);
    });

    it("surfaces active_chat_cap as a banner issue instead of a send_failed bubble", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
        new ContractsApiError(
          "You already have the maximum number of active chats for this plan.",
          409,
          {
            error: {
              code: "active_chat_cap_reached",
              message: "You already have the maximum number of active chats for this plan."
            }
          },
          "active_chat_cap_reached"
        )
      );

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("new chat please");
      });

      expect(result.current.issue).toMatchObject({
        classId: "active_chat_cap",
        message: "You already have the maximum number of active chats for this plan."
      });
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages).toHaveLength(0);
    });

    it("surfaces quota hard-stops as an issue instead of a send_failed bubble before headers", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
        new ContractsApiError(
          "Browser is exhausted for the current daily limit.",
          409,
          {
            error: {
              code: "tool_daily_limit_reached",
              message: "Browser is exhausted for the current daily limit.",
              details: {
                userFacingGuidance:
                  "Try a request that does not need Browser until the daily limit resets."
              }
            }
          },
          "tool_daily_limit_reached"
        )
      );

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("open browser");
      });

      expect(result.current.issue).toMatchObject({
        classId: "quota_limit_reached",
        message: "Browser is exhausted for the current daily limit.",
        guidance: "Try a request that does not need Browser until the daily limit resets."
      });
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages).toHaveLength(0);
    });

    it("does not redispatch an unknown pending turn and keeps its slot recoverable", async () => {
      let callCount = 0;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { message?: string },
          handlers: {
            onHeadersOk?: () => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          callCount++;
          // First call fails before headers. An unknown reconciliation must
          // never create a second logical server turn.
          if (callCount === 1) {
            throw new TypeError("fetch failed");
          }
          handlers.onHeadersOk?.();
          handlers.onCompleted?.({
            transport: {
              userMessage: { id: "u1", chatId: "chat-1" },
              assistantMessage: { id: "a1", content: payload.message ?? "" }
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("retry me");
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

      await act(async () => {
        await result.current.retryPendingSend();
      });

      expect(callCount).toBe(1);
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");
      const userMsg = result.current.messages.find((m) => m.role === "user");
      expect(userMsg?.status).toBe("send_failed_unconfirmed");
    });

    it("retryPendingSend reconciles a completed server turn instead of sending a duplicate", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
        new TypeError("fetch failed")
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
        status: "completed",
        chat: null,
        userMessage: {
          id: "server-user-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "retry me",
          attachments: [],
          createdAt: "2026-04-14T10:00:00.000Z"
        },
        assistantMessage: {
          id: "server-assistant-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "already saved",
          attachments: [],
          createdAt: "2026-04-14T10:00:01.000Z"
        },
        currentActivity: null,
        runtime: {
          respondedAt: "2026-04-14T10:00:01.000Z",
          degradedByQuotaFallback: false,
          quotaFallbackReason: null,
          quotaFallbackModel: null
        },
        error: null
      });

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("retry me");
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

      await act(async () => {
        await result.current.retryPendingSend();
      });

      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-1",
        "server-assistant-1"
      ]);
    });

    it("retryPendingSend keeps a completed follow-up assistant message when the server turn already finished", async () => {
      // Keyed mocks + clientTurnId-scoped stream assertion: absolute
      // toHaveBeenCalledTimes(1) flakes when a late prior-test stream call
      // lands after mockClear, and mockResolvedValueOnce(completed) can be
      // stolen so retry falls through to a real duplicate send.
      const threadKey = "thread-retry-follow-up";
      const chatId = "chat-retry-follow-up";
      const retryText = "retry me follow-up stable";
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(async () => {
        throw new TypeError("fetch failed");
      });
      assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(async () => ({
        status: "completed",
        chat: {
          id: chatId,
          assistantId: "assistant-1",
          surface: "web",
          surfaceThreadKey: threadKey,
          title: "Chat",
          deepModeEnabled: false,
          archivedAt: null,
          lastMessageAt: "2026-04-14T10:00:02.000Z",
          createdAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:00:02.000Z"
        },
        userMessage: {
          id: "server-user-retry-follow-up",
          chatId,
          assistantId: "assistant-1",
          author: "user",
          content: retryText,
          attachments: [],
          createdAt: "2026-04-14T10:00:00.000Z"
        },
        assistantMessage: {
          id: "server-assistant-retry-follow-up",
          chatId,
          assistantId: "assistant-1",
          author: "assistant",
          content: "already saved",
          attachments: [],
          createdAt: "2026-04-14T10:00:01.000Z"
        },
        followUpAssistantMessage: {
          id: "follow-up-retry-stable",
          chatId,
          assistantId: "assistant-1",
          author: "assistant",
          content: "Please start a new chat.",
          attachments: [],
          createdAt: "2026-04-14T10:00:02.000Z"
        },
        currentActivity: null,
        runtime: {
          respondedAt: "2026-04-14T10:00:01.000Z",
          degradedByQuotaFallback: false,
          quotaFallbackReason: null,
          quotaFallbackModel: null
        },
        error: null
      }));
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, requestedChatId: string) => {
          if (requestedChatId !== chatId) {
            return {
              nextCursor: null,
              activeMediaJobs: [],
              messages: []
            };
          }
          return {
            nextCursor: null,
            activeMediaJobs: [],
            messages: [
              {
                id: "server-user-retry-follow-up",
                chatId,
                assistantId: "assistant-1",
                author: "user",
                content: retryText,
                attachments: [],
                createdAt: "2026-04-14T10:00:00.000Z"
              },
              {
                id: "server-assistant-retry-follow-up",
                chatId,
                assistantId: "assistant-1",
                author: "assistant",
                content: "already saved",
                attachments: [],
                createdAt: "2026-04-14T10:00:01.000Z"
              },
              {
                id: "follow-up-retry-stable",
                chatId,
                assistantId: "assistant-1",
                author: "assistant",
                content: "Please start a new chat.",
                attachments: [],
                createdAt: "2026-04-14T10:00:02.000Z"
              }
            ]
          };
        }
      );
      assistantApiMocks.getChatCompactionState.mockResolvedValue(createCompactionState());

      const { result } = renderHook(() => useChat(threadKey));

      await act(async () => {
        await result.current.send(retryText);
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");
      const initialStreamCalls = assistantApiMocks.streamAssistantWebChatTurn.mock.calls.filter(
        (call) => {
          const payload = call[1] as { message?: string; clientTurnId?: string };
          return payload.message === retryText;
        }
      );
      expect(initialStreamCalls).toHaveLength(1);
      const clientTurnId = (initialStreamCalls[0]?.[1] as { clientTurnId: string }).clientTurnId;

      await act(async () => {
        await result.current.retryPendingSend();
      });

      const streamCallsForTurn = assistantApiMocks.streamAssistantWebChatTurn.mock.calls.filter(
        (call) => {
          const payload = call[1] as { clientTurnId?: string };
          return payload.clientTurnId === clientTurnId;
        }
      );
      // Retry must reconcile the completed server turn — never dispatch a
      // second stream for the same clientTurnId.
      expect(streamCallsForTurn).toHaveLength(1);
      expect(assistantApiMocks.getChatMessages).toHaveBeenCalledWith(
        "token-1",
        chatId,
        undefined,
        20
      );
      expect(assistantApiMocks.getChatCompactionState).toHaveBeenCalledWith("token-1", chatId);
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-retry-follow-up",
        "server-assistant-retry-follow-up",
        "follow-up-retry-stable"
      ]);
    });

    it("retryPendingSend follows an accepted server turn until it becomes running", async () => {
      vi.useFakeTimers();
      try {
        assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
          new TypeError("fetch failed")
        );
        assistantApiMocks.getAssistantWebChatTurnStatus
          .mockResolvedValueOnce({
            status: "accepted",
            chat: null,
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          })
          .mockResolvedValueOnce({
            status: "running",
            chat: {
              id: "chat-1",
              assistantId: "assistant-1",
              surface: "web",
              surfaceThreadKey: "thread-1",
              title: "Chat",
              deepModeEnabled: false,
              archivedAt: null,
              lastMessageAt: "2026-04-14T10:00:00.000Z",
              createdAt: "2026-04-14T10:00:00.000Z",
              updatedAt: "2026-04-14T10:00:00.000Z"
            },
            userMessage: {
              id: "server-user-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "retry me",
              attachments: [],
              createdAt: "2026-04-14T10:00:00.000Z"
            },
            assistantMessage: null,
            currentActivity: {
              type: "tool_use",
              toolName: "web_search",
              toolCallId: "tool-1",
              phase: "start",
              isError: false,
              updatedAt: "2026-04-14T10:00:01.000Z"
            },
            runtime: null,
            error: null
          });

        const { result } = renderHook(() => useChat("thread-1"), {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        });

        await act(async () => {
          await result.current.send("retry me");
        });
        expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

        let retryPromise: Promise<string | null> | undefined;
        await act(async () => {
          retryPromise = result.current.retryPendingSend();
          await Promise.resolve();
        });
        expect(result.current.pendingSendStatus).toBe("reconciling");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
          if (retryPromise !== undefined) await retryPromise;
        });

        expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
        expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalledTimes(3);
        expect(result.current.pendingSendStatus).toBeNull();
        expect(result.current.isStreaming).toBe(true);
        expect(result.current.entries).toContainEqual(
          expect.objectContaining({
            kind: "activity",
            event: expect.objectContaining({ label: "Searching the web" })
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancelPendingSend removes the bubble and returns the draft text", async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("draft text");
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_confirmed");

      let restored: string | null = null;
      await act(async () => {
        restored = await result.current.cancelPendingSend();
      });

      expect(restored).toBe("draft text");
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages).toHaveLength(0);
    });

    it("cancelPendingSend keeps an accepted attempt without a user row recoverable", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
        new TypeError("fetch failed")
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
        status: "accepted",
        chat: null,
        userMessage: null,
        assistantMessage: null,
        currentActivity: null,
        runtime: null,
        error: null
      });
      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("do not lose me");
      });
      await act(async () => {
        await result.current.cancelPendingSend();
      });

      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");
      expect(result.current.messages).toContainEqual(
        expect.objectContaining({ role: "user", status: "send_failed_unconfirmed" })
      );
    });

    it("cancelPendingSend restores an exact running turn with its canonical user row", async () => {
      const clientTurnId = "turn-cancel-running";
      const runningTurn = {
        status: "running" as const,
        chat: {
          id: "chat-running",
          assistantId: "assistant-1",
          surface: "web" as const,
          surfaceThreadKey: "thread-1",
          title: "Chat",
          chatMode: "normal" as const,
          deepModeEnabled: false,
          skillDecisionState: null,
          archivedAt: null,
          lastMessageAt: "2026-04-14T10:00:01.000Z",
          createdAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:00:01.000Z"
        },
        userMessage: {
          id: "server-user-running",
          chatId: "chat-running",
          assistantId: "assistant-1",
          author: "user" as const,
          content: "keep running",
          attachments: [],
          createdAt: "2026-04-14T10:00:00.000Z"
        },
        assistantMessage: null,
        currentActivity: {
          type: "tool_use" as const,
          toolName: "web_search",
          toolCallId: "tool-running",
          phase: "start" as const,
          isError: false,
          updatedAt: "2026-04-14T10:00:01.000Z"
        },
        runtime: null,
        error: null
      };
      let releaseReattach: (() => void) | undefined;

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(async () => {
        throw new TypeError("fetch failed");
      });
      assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
        async (_token: string, requestedClientTurnId: string) =>
          requestedClientTurnId === clientTurnId
            ? runningTurn
            : {
                status: "unknown" as const,
                chat: null,
                userMessage: null,
                assistantMessage: null,
                currentActivity: null,
                runtime: null,
                error: null
              }
      );
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
        async (
          _token: string,
          requestedClientTurnId: string,
          handlers: {
            onHeadersOk?: () => void;
            onTurnStatus?: (payload: { turn: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onTurnStatus?.({
            turn: await assistantApiMocks.getAssistantWebChatTurnStatus(
              "token-1",
              requestedClientTurnId
            )
          });
          await new Promise<void>((resolve) => {
            releaseReattach = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("keep running", undefined, { clientTurnId });
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

      let restored: string | null = "not-null";
      await act(async () => {
        restored = await result.current.cancelPendingSend();
      });

      expect(restored).toBeNull();
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.isStreaming).toBe(true);
      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
      expect(assistantApiMocks.reattachAssistantWebChatTurnStream).toHaveBeenCalledWith(
        "token-1",
        clientTurnId,
        expect.any(Object),
        expect.any(AbortSignal),
        expect.any(Number)
      );
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-running",
        `local-assistant-${clientTurnId}`
      ]);

      act(() => {
        releaseReattach?.();
        result.current.stop();
      });
    });

    it("cancelPendingSend hydrates a completed turn instead of redispatching", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
        new TypeError("fetch failed")
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
        status: "completed",
        chat: {
          id: "chat-completed",
          assistantId: "assistant-1",
          surface: "web",
          surfaceThreadKey: "thread-1",
          title: "Chat",
          chatMode: "normal",
          deepModeEnabled: false,
          skillDecisionState: null,
          archivedAt: null,
          lastMessageAt: "2026-04-14T10:00:01.000Z",
          createdAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:00:01.000Z"
        },
        userMessage: {
          id: "server-user-completed",
          chatId: "chat-completed",
          assistantId: "assistant-1",
          author: "user",
          content: "already finished",
          attachments: [],
          createdAt: "2026-04-14T10:00:00.000Z"
        },
        assistantMessage: {
          id: "server-assistant-completed",
          chatId: "chat-completed",
          assistantId: "assistant-1",
          author: "assistant",
          content: "finished",
          attachments: [],
          createdAt: "2026-04-14T10:00:01.000Z"
        },
        followUpAssistantMessage: null,
        currentActivity: null,
        runtime: {
          respondedAt: "2026-04-14T10:00:01.000Z",
          degradedByQuotaFallback: false,
          quotaFallbackReason: null,
          quotaFallbackModel: null
        },
        error: null
      });

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("already finished");
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

      let restored: string | null = "not-null";
      await act(async () => {
        restored = await result.current.cancelPendingSend();
      });

      expect(restored).toBeNull();
      expect(result.current.pendingSendStatus).toBeNull();
      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-completed",
        "server-assistant-completed"
      ]);
    });

    it.each(["failed", "interrupted"] as const)(
      "cancelPendingSend clears only the transient pending state when the server is terminal: %s",
      async (terminalStatus) => {
        assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
          new TypeError("fetch failed")
        );
        assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
          status: terminalStatus,
          chat: null,
          userMessage: null,
          assistantMessage: null,
          currentActivity: null,
          runtime: null,
          error:
            terminalStatus === "failed"
              ? { code: "server_error", message: "failed before assistant output" }
              : null
        });

        const { result } = renderHook(() => useChat("thread-1"));

        await act(async () => {
          await result.current.send(`cancel ${terminalStatus}`);
        });
        expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

        await act(async () => {
          await result.current.cancelPendingSend();
        });

        expect(result.current.pendingSendStatus).toBeNull();
        expect(result.current.messages).toHaveLength(0);
        expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
        expect(assistantApiMocks.reattachAssistantWebChatTurnStream).not.toHaveBeenCalled();
      }
    );

    it.each(["unknown", "throws"] as const)(
      "cancelPendingSend keeps an ambiguous pending turn recoverable when status is %s",
      async (mode) => {
        assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
          new TypeError("fetch failed")
        );
        if (mode === "throws") {
          assistantApiMocks.getAssistantWebChatTurnStatus.mockRejectedValueOnce(
            new Error("status probe failed")
          );
        } else {
          assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
            status: "unknown",
            chat: null,
            userMessage: null,
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: null
          });
        }

        const { result } = renderHook(() => useChat("thread-1"));

        await act(async () => {
          await result.current.send(`cancel ${mode}`);
        });
        expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

        let restored: string | null = "not-null";
        await act(async () => {
          restored = await result.current.cancelPendingSend();
        });

        expect(restored).toBeNull();
        expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");
        expect(result.current.messages).toContainEqual(
          expect.objectContaining({
            role: "user",
            content: `cancel ${mode}`,
            status: "send_failed_unconfirmed"
          })
        );
        expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
      }
    );

    it.each(["failed", "interrupted"] as const)(
      "retryPendingSend re-dispatches a terminal attempt exactly once with fresh identity: %s",
      async (terminalStatus) => {
        const sentPayloads: Array<{
          clientTurnId?: string;
          clientAttachmentIds?: string[];
          chatMode?: string;
          deepModeEnabled?: boolean;
        }> = [];
        assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
          async (
            _token: string,
            payload: {
              clientTurnId?: string;
              clientAttachmentIds?: string[];
              chatMode?: string;
              deepModeEnabled?: boolean;
            },
            handlers: {
              onHeadersOk?: () => void;
              onCompleted?: (payload: { transport: unknown }) => void;
            }
          ) => {
            sentPayloads.push(payload);
            if (sentPayloads.length === 1) {
              throw new TypeError("fetch failed");
            }
            handlers.onHeadersOk?.();
            handlers.onCompleted?.({
              transport: {
                userMessage: { id: "fresh-user", chatId: "chat-1" },
                assistantMessage: { id: "fresh-assistant", content: "Recovered" }
              }
            });
          }
        );
        assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
          status: terminalStatus,
          chat: null,
          userMessage: null,
          assistantMessage: null,
          currentActivity: null,
          runtime: null,
          error:
            terminalStatus === "failed"
              ? { code: "native_runtime_conflict", message: "Native runtime conflict" }
              : null
        });

        const { result } = renderHook(() => useChat("thread-1"));

        await act(async () => {
          await result.current.send("retry with fresh identity", undefined, {
            clientTurnId: "caller-supplied-terminal-id",
            clientAttachmentIds: ["caller-supplied-attachment-id"],
            chatMode: "project",
            deepModeEnabled: true
          });
        });
        await act(async () => {
          await result.current.retryPendingSend();
        });

        expect(sentPayloads).toHaveLength(2);
        expect(sentPayloads[0]?.clientTurnId).toBe("caller-supplied-terminal-id");
        expect(sentPayloads[1]?.clientTurnId).not.toBe("caller-supplied-terminal-id");
        expect(sentPayloads[1]?.clientAttachmentIds ?? []).not.toContain(
          "caller-supplied-attachment-id"
        );
        expect(sentPayloads[1]?.chatMode).toBe("project");
        expect(sentPayloads[1]?.deepModeEnabled).toBe(true);
      }
    );

    it("reload surfaces native_runtime_conflict as a recoverable failed turn, not a committed-looking orphan", async () => {
      const threadKey = "thread-native-runtime-conflict";
      const clientTurnId = "turn-native-runtime-conflict";
      window.sessionStorage.setItem(`persai.active-web-turn.v1.${threadKey}`, clientTurnId);
      assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
        async (_token: string, requestedClientTurnId: string) => {
          if (requestedClientTurnId !== clientTurnId) {
            return {
              status: "unknown" as const,
              chat: null,
              userMessage: null,
              assistantMessage: null,
              currentActivity: null,
              runtime: null,
              error: null
            };
          }
          return {
            status: "failed" as const,
            chat: {
              id: "chat-native-runtime-conflict",
              assistantId: "assistant-1",
              surface: "web" as const,
              surfaceThreadKey: threadKey,
              title: "Chat",
              chatMode: "normal" as const,
              deepModeEnabled: false,
              skillDecisionState: null,
              archivedAt: null,
              lastMessageAt: "2026-04-14T10:00:00.000Z",
              createdAt: "2026-04-14T10:00:00.000Z",
              updatedAt: "2026-04-14T10:00:00.000Z"
            },
            userMessage: {
              id: "server-user-native-runtime-conflict",
              chatId: "chat-native-runtime-conflict",
              assistantId: "assistant-1",
              author: "user" as const,
              content: "conflict me",
              attachments: [],
              createdAt: "2026-04-14T10:00:00.000Z"
            },
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: {
              code: "native_runtime_conflict",
              message: "Native runtime conflict"
            }
          };
        }
      );

      const { result } = renderHook(() => useChat(threadKey), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await waitFor(() => expect(result.current.issue).not.toBeNull());

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: "server-user-native-runtime-conflict",
          role: "user",
          content: "conflict me",
          status: "send_failed_unconfirmed"
        })
      ]);
      expect(window.sessionStorage.getItem(`persai.active-web-turn.v1.${threadKey}`)).toBeNull();
    });

    it("retryPendingSend keeps a restored canonical text-only conflict visible and sends one fresh turn", async () => {
      const threadKey = "thread-native-runtime-conflict-retry";
      const restoredClientTurnId = "turn-native-runtime-conflict-retry";
      const sentPayloads: Array<{ clientTurnId?: string; message?: string }> = [];
      window.sessionStorage.setItem(`persai.active-web-turn.v1.${threadKey}`, restoredClientTurnId);
      assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
        async (_token: string, requestedClientTurnId: string) => {
          if (requestedClientTurnId !== restoredClientTurnId) {
            return {
              status: "unknown" as const,
              chat: null,
              userMessage: null,
              assistantMessage: null,
              currentActivity: null,
              runtime: null,
              error: null
            };
          }
          return {
            status: "failed" as const,
            chat: {
              id: "chat-native-runtime-conflict-retry",
              assistantId: "assistant-1",
              surface: "web" as const,
              surfaceThreadKey: threadKey,
              title: "Chat",
              chatMode: "normal" as const,
              deepModeEnabled: false,
              skillDecisionState: null,
              archivedAt: null,
              lastMessageAt: "2026-04-14T10:00:00.000Z",
              createdAt: "2026-04-14T10:00:00.000Z",
              updatedAt: "2026-04-14T10:00:00.000Z"
            },
            userMessage: {
              id: "server-user-native-runtime-conflict-retry",
              chatId: "chat-native-runtime-conflict-retry",
              assistantId: "assistant-1",
              author: "user" as const,
              content: "conflict me again",
              attachments: [],
              createdAt: "2026-04-14T10:00:00.000Z"
            },
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: {
              code: "native_runtime_conflict",
              message: "Native runtime conflict"
            }
          };
        }
      );
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { clientTurnId?: string; message?: string },
          handlers: {
            onHeadersOk?: () => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          sentPayloads.push(payload);
          handlers.onHeadersOk?.();
          handlers.onCompleted?.({
            transport: {
              userMessage: { id: "fresh-user-native-runtime-conflict-retry", chatId: "chat-1" },
              assistantMessage: {
                id: "fresh-assistant-native-runtime-conflict-retry",
                content: "Recovered"
              }
            }
          });
        }
      );

      const { result } = renderHook(() => useChat(threadKey));

      await waitFor(() => expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed"));
      expect(result.current.pendingSendUserMessageId).toBe(
        "server-user-native-runtime-conflict-retry"
      );

      await act(async () => {
        await result.current.retryPendingSend();
      });

      expect(sentPayloads).toHaveLength(1);
      expect(sentPayloads[0]?.clientTurnId).not.toBe(restoredClientTurnId);
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.pendingSendUserMessageId).toBeNull();
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: "server-user-native-runtime-conflict-retry",
          status: "send_failed_confirmed"
        }),
        expect.objectContaining({
          id: "fresh-user-native-runtime-conflict-retry",
          status: "committed"
        }),
        expect.objectContaining({
          id: "fresh-assistant-native-runtime-conflict-retry",
          status: "committed"
        })
      ]);
    });

    it("cancelPendingSend keeps a restored canonical text-only conflict visible and unlocks the composer", async () => {
      const threadKey = "thread-native-runtime-conflict-cancel";
      const restoredClientTurnId = "turn-native-runtime-conflict-cancel";
      window.sessionStorage.setItem(`persai.active-web-turn.v1.${threadKey}`, restoredClientTurnId);
      assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
        async (_token: string, requestedClientTurnId: string) => {
          if (requestedClientTurnId !== restoredClientTurnId) {
            return {
              status: "unknown" as const,
              chat: null,
              userMessage: null,
              assistantMessage: null,
              currentActivity: null,
              runtime: null,
              error: null
            };
          }
          return {
            status: "failed" as const,
            chat: {
              id: "chat-native-runtime-conflict-cancel",
              assistantId: "assistant-1",
              surface: "web" as const,
              surfaceThreadKey: threadKey,
              title: "Chat",
              chatMode: "normal" as const,
              deepModeEnabled: false,
              skillDecisionState: null,
              archivedAt: null,
              lastMessageAt: "2026-04-14T10:00:00.000Z",
              createdAt: "2026-04-14T10:00:00.000Z",
              updatedAt: "2026-04-14T10:00:00.000Z"
            },
            userMessage: {
              id: "server-user-native-runtime-conflict-cancel",
              chatId: "chat-native-runtime-conflict-cancel",
              assistantId: "assistant-1",
              author: "user" as const,
              content: "leave me visible",
              attachments: [],
              createdAt: "2026-04-14T10:00:00.000Z"
            },
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: {
              code: "native_runtime_conflict",
              message: "Native runtime conflict"
            }
          };
        }
      );

      const { result } = renderHook(() => useChat(threadKey));

      await waitFor(() => expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed"));

      let restored: string | null = "not-null";
      await act(async () => {
        restored = await result.current.cancelPendingSend();
      });

      expect(restored).toBeNull();
      expect(assistantApiMocks.streamAssistantWebChatTurn).not.toHaveBeenCalled();
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.pendingSendUserMessageId).toBeNull();
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: "server-user-native-runtime-conflict-cancel",
          status: "send_failed_confirmed"
        })
      ]);
    });

    it("retryPendingSend requires manual reattachment for restored canonical attachment conflicts", async () => {
      const threadKey = "thread-native-runtime-conflict-attachment";
      const restoredClientTurnId = "turn-native-runtime-conflict-attachment";
      window.sessionStorage.setItem(`persai.active-web-turn.v1.${threadKey}`, restoredClientTurnId);
      assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(
        async (_token: string, requestedClientTurnId: string) => {
          if (requestedClientTurnId !== restoredClientTurnId) {
            return {
              status: "unknown" as const,
              chat: null,
              userMessage: null,
              assistantMessage: null,
              currentActivity: null,
              runtime: null,
              error: null
            };
          }
          return {
            status: "failed" as const,
            chat: {
              id: "chat-native-runtime-conflict-attachment",
              assistantId: "assistant-1",
              surface: "web" as const,
              surfaceThreadKey: threadKey,
              title: "Chat",
              chatMode: "normal" as const,
              deepModeEnabled: false,
              skillDecisionState: null,
              archivedAt: null,
              lastMessageAt: "2026-04-14T10:00:00.000Z",
              createdAt: "2026-04-14T10:00:00.000Z",
              updatedAt: "2026-04-14T10:00:00.000Z"
            },
            userMessage: {
              id: "server-user-native-runtime-conflict-attachment",
              chatId: "chat-native-runtime-conflict-attachment",
              assistantId: "assistant-1",
              author: "user" as const,
              content: "please send these again",
              attachments: [createHistoryImageAttachment("native-runtime-conflict-reattach")],
              createdAt: "2026-04-14T10:00:00.000Z"
            },
            assistantMessage: null,
            currentActivity: null,
            runtime: null,
            error: {
              code: "native_runtime_conflict",
              message: "Native runtime conflict"
            }
          };
        }
      );

      const { result } = renderHook(() => useChat(threadKey));

      await waitFor(() => expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed"));
      expect(result.current.pendingSendUserMessageId).toBe(
        "server-user-native-runtime-conflict-attachment"
      );

      let restored: string | null = null;
      await act(async () => {
        restored = await result.current.retryPendingSend();
      });

      expect(restored).toBe("please send these again");
      expect(assistantApiMocks.streamAssistantWebChatTurn).not.toHaveBeenCalled();
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.pendingSendUserMessageId).toBeNull();
      expect(result.current.issue).toMatchObject({
        classId: "input_validation",
        message: "pendingRetryNeedsReattachTitle",
        guidance: "pendingRetryNeedsReattachGuidance"
      });
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: "server-user-native-runtime-conflict-attachment",
          status: "send_failed_confirmed",
          attachments: [expect.objectContaining({ id: "native-runtime-conflict-reattach" })]
        })
      ]);
    });

    /*
     * Founder-repro: pressing Enter twice in quick succession (or sending,
     * then sending again immediately as the previous stream wraps up but
     * before React re-renders `isStreaming = false → true`) used to start
     * TWO parallel turns. Both pushed their own optimistic `[user, asst]`
     * pair into `messages`, both wrote their own snapshot to
     * `activeTurnSnapshotsRef` (snapshot is per-thread → the second
     * silently clobbered the first), and the loser's `finally` cleanup
     * cached the winner's snapshot — leaving a phantom user bubble or a
     * missing user bubble after the next swap, which only F5 cleared.
     *
     * The fix is the synchronous `sendInPreflightByThreadRef` gate added
     * at the top of `send()` (and `sendWelcome()`). The second call must
     * return *before* it claims an optimistic slot.
     */
    it("renders the optimistic bubble before a slow token refresh and blocks a second send", async () => {
      // Make `getToken` block on a controllable promise so weak mobile network
      // can be simulated without letting the actual stream start yet.
      let releaseToken: ((value: string) => void) | undefined;
      clerkMocks.getToken.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseToken = resolve;
          })
      );
      // Subsequent calls (if the second send leaks through and reaches
      // `await getToken()` again) should resolve normally so we observe the
      // bug rather than hang the test.
      clerkMocks.getToken.mockResolvedValue("token-1");

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { message?: string; clientTurnId?: string },
          handlers: {
            onStarted?: (p: { chat: unknown; userMessage: unknown }) => void;
            onCompleted?: (p: { transport: unknown }) => void;
          }
        ) => {
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: `server-user-${payload.clientTurnId ?? "x"}` }
          });
          handlers.onCompleted?.({
            transport: {
              userMessage: {
                id: `server-user-${payload.clientTurnId ?? "x"}`,
                chatId: "chat-1"
              },
              assistantMessage: {
                id: `server-assistant-${payload.clientTurnId ?? "x"}`,
                content: payload.message ?? ""
              }
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let firstPromise: Promise<void> | undefined;
      let secondPromise: Promise<void> | undefined;
      await act(async () => {
        // First call claims the optimistic local slot, then suspends inside
        // `await getToken()`.
        firstPromise = result.current.send("first");
        // Yield one microtask so the first call has hit the token refresh.
        await Promise.resolve();
        secondPromise = result.current.send("second");
        // Let the second call also reach its first await/return point.
        await Promise.resolve();
      });

      // Before token refresh resolves, the user still sees the outgoing bubble
      // immediately, but no network stream has been issued.
      expect(assistantApiMocks.streamAssistantWebChatTurn).not.toHaveBeenCalled();
      expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);
      expect(result.current.messages.find((m) => m.role === "user")?.content).toBe("first");
      expect(result.current.pendingSendStatus).toBe("sending");

      await act(async () => {
        releaseToken?.("token-1");
        await firstPromise;
        await secondPromise;
      });

      // Exactly ONE stream must have been issued — the second send must
      // have been short-circuited by the synchronous preflight guard.
      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);

      // Visible state must have ONLY the first user bubble + one assistant.
      const userMessages = result.current.messages.filter((m) => m.role === "user");
      const assistantMessages = result.current.messages.filter((m) => m.role === "assistant");
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0]?.content).toBe("first");
      expect(assistantMessages).toHaveLength(1);
    });

    it("retries the stream once with a fresh Clerk token after a cached-token 401", async () => {
      clerkMocks.getToken
        .mockResolvedValueOnce("cached-token")
        .mockResolvedValueOnce("fresh-token");
      assistantApiMocks.streamAssistantWebChatTurn
        .mockRejectedValueOnce(
          new ContractsApiError("Session expired. Sign in again and refresh the page.", 401, null)
        )
        .mockImplementationOnce(
          async (
            _token: string,
            payload: { message?: string; clientTurnId?: string },
            handlers: {
              onStarted?: (p: { chat: unknown; userMessage: unknown }) => void;
              onCompleted?: (p: { transport: unknown }) => void;
            }
          ) => {
            handlers.onStarted?.({
              chat: { id: "chat-1" },
              userMessage: { id: `server-user-${payload.clientTurnId ?? "x"}` }
            });
            handlers.onCompleted?.({
              transport: {
                userMessage: {
                  id: `server-user-${payload.clientTurnId ?? "x"}`,
                  chatId: "chat-1"
                },
                assistantMessage: {
                  id: `server-assistant-${payload.clientTurnId ?? "x"}`,
                  content: payload.message ?? ""
                }
              }
            });
          }
        );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("retry auth once");
      });

      expect(clerkMocks.getToken).toHaveBeenNthCalledWith(1);
      expect(clerkMocks.getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenNthCalledWith(
        1,
        "cached-token",
        expect.any(Object),
        expect.any(Object),
        expect.any(AbortSignal)
      );
      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenNthCalledWith(
        2,
        "fresh-token",
        expect.any(Object),
        expect.any(Object),
        expect.any(AbortSignal)
      );
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages.some((message) => message.content === "retry auth once")).toBe(
        true
      );
    });

    it("blocks a third send() fired in the same microtask as the second (triple-press defence)", async () => {
      let releaseToken: ((value: string) => void) | undefined;
      clerkMocks.getToken.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseToken = resolve;
          })
      );
      clerkMocks.getToken.mockResolvedValue("token-1");

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { message?: string },
          handlers: {
            onStarted?: (p: { chat: unknown; userMessage: unknown }) => void;
            onCompleted?: (p: { transport: unknown }) => void;
          }
        ) => {
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "server-user-1" }
          });
          handlers.onCompleted?.({
            transport: {
              userMessage: { id: "server-user-1", chatId: "chat-1" },
              assistantMessage: { id: "server-assistant-1", content: payload.message ?? "" }
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let p1: Promise<void> | undefined;
      let p2: Promise<void> | undefined;
      let p3: Promise<void> | undefined;
      await act(async () => {
        p1 = result.current.send("first");
        await Promise.resolve();
        p2 = result.current.send("second");
        p3 = result.current.send("third");
        await Promise.resolve();
      });

      await act(async () => {
        releaseToken?.("token-1");
        await p1;
        await p2;
        await p3;
      });

      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
      const userMessages = result.current.messages.filter((m) => m.role === "user");
      expect(userMessages.map((m) => m.content)).toEqual(["first"]);
    });
  });

  describe("per-thread streaming (slice 1.1)", () => {
    /**
     * The bug being fixed: pre-1.1 `useChat` held `isStreaming` in a single
     * local `useState`, so two `useChat(...)` calls in the tree (one per
     * mounted thread view) were unrelated booleans — but in production only
     * the active thread is mounted, so switching the `threadKey` argument
     * preserved the `true` until the stream finished, and the new thread's
     * composer stayed disabled. We now subscribe both calls to the same
     * registry keyed by `threadKey`.
     */
    it("does not block another thread's composer while one thread is streaming", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          streamGate.release = resolve;
        });
      });

      const { result } = renderHook(({ threadKey }: { threadKey: string }) => useChat(threadKey), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>,
        initialProps: { threadKey: "thread-A" }
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("hi from A");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });

      // Render a second view bound to thread-B sharing the same provider.
      const { result: bView } = renderHook(() => useChat("thread-B"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });
      // Same provider would expose A's flag; here we sanity-check that a
      // *different* thread key never observes A's stream as its own.
      expect(bView.current.isStreaming).toBe(false);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("restores the live placeholder and tool activity when returning to a streaming thread", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onTool?: (payload: {
              phase: "start" | "end";
              toolName: string;
              toolCallId: string;
              isError: boolean;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "user-msg-A", chatId: "chat-A", attachments: [] }
          });
          handlers.onTool?.({
            phase: "start",
            toolName: "image_generate",
            toolCallId: "tool-1",
            isError: false
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("make an image");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.entries).toEqual([
          expect.objectContaining({
            kind: "message",
            message: expect.objectContaining({ role: "user", content: "make an image" })
          }),
          expect.objectContaining({
            kind: "message",
            message: expect.objectContaining({ role: "assistant", status: "streaming" })
          }),
          expect.objectContaining({
            kind: "activity",
            event: expect.objectContaining({
              toolName: "image_generate",
              label: "Generating image",
              toolCallId: "tool-1"
            })
          })
        ]);
      });

      rerender({ threadKey: "thread-B" });
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages).toHaveLength(0);

      rerender({ threadKey: "thread-A" });
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.entries).toEqual([
        expect.objectContaining({
          kind: "message",
          message: expect.objectContaining({ role: "user", content: "make an image" })
        }),
        expect.objectContaining({
          kind: "message",
          message: expect.objectContaining({ role: "assistant", status: "streaming" })
        }),
        expect.objectContaining({
          kind: "activity",
          event: expect.objectContaining({
            toolName: "image_generate",
            label: "Generating image",
            toolCallId: "tool-1"
          })
        })
      ]);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("ADR-165 D6.2: await tool-end / empty open-jobs leave thinking path (streamingTextActive false)", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
            onTool?: (payload: {
              phase: "start" | "end";
              toolName: string;
              toolCallId: string;
              isError: boolean;
            }) => void;
            onAsyncJobsOpen?: (payload: {
              activeMediaJobs: unknown[];
              activeDocumentJobs: unknown[];
              activeSandboxJobs: unknown[];
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-think-1" },
            userMessage: { id: "user-msg-think-1", chatId: "chat-think-1", attachments: [] }
          });
          handlers.onTool?.({
            phase: "start",
            toolName: "image_generate",
            toolCallId: "tool-img-1",
            isError: false
          });
          handlers.onDelta?.({ delta: "partial" });
          handlers.onTool?.({
            phase: "start",
            toolName: "await",
            toolCallId: "tool-await-1",
            isError: false
          });
          handlers.onTool?.({
            phase: "end",
            toolName: "await",
            toolCallId: "tool-await-1",
            isError: false
          });
          handlers.onAsyncJobsOpen?.({
            activeMediaJobs: [],
            activeDocumentJobs: [],
            activeSandboxJobs: []
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-think-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("wait for image");
        await Promise.resolve();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find((message) => message.role === "assistant");
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.streamingTextActive).toBe(false);
      });
      expect(
        result.current.entries.some(
          (entry) =>
            entry.kind === "activity" &&
            "toolName" in entry.event &&
            entry.event.toolName === "image_generate"
        )
      ).toBe(false);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("restores a turn that completed while its thread was in the background", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "user-msg-A", chatId: "chat-A", attachments: [] }
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
          handlers.onCompleted?.({
            transport: {
              userMessage: { id: "user-msg-A", chatId: "chat-A", attachments: [] },
              assistantMessage: { id: "assistant-msg-A", content: "Long answer", attachments: [] }
            }
          });
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("write a long speech");
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.isStreaming).toBe(true));

      rerender({ threadKey: "thread-B" });
      expect(result.current.messages).toHaveLength(0);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages).toHaveLength(0);

      rerender({ threadKey: "thread-A" });
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: "user-msg-A",
          role: "user",
          content: "write a long speech",
          status: "committed"
        }),
        expect.objectContaining({
          id: "assistant-msg-A",
          role: "assistant",
          content: "Long answer",
          status: "committed"
        })
      ]);
      expect(result.current.historyLoading).toBe(false);
    });

    it("keeps a failed attachment upload on the originating thread after switching away", async () => {
      const uploadGate: { reject: (error: unknown) => void } = {
        reject: () => undefined
      };
      assistantApiMocks.stageWebChatAttachment.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            uploadGate.reject = reject;
          })
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("read this", [
          new File(["large pdf"], "large.pdf", { type: "application/pdf" })
        ]);
        await Promise.resolve();
      });

      await waitFor(() => expect(result.current.pendingSendStatus).toBe("sending"));
      rerender({ threadKey: "thread-B" });
      expect(result.current.pendingSendStatus).toBeNull();

      await act(async () => {
        uploadGate.reject(new Error("Network dropped during upload."));
        if (sendPromise !== undefined) await sendPromise;
      });

      rerender({ threadKey: "thread-A" });
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");
      expect(result.current.entries).toEqual([
        expect.objectContaining({
          kind: "message",
          message: expect.objectContaining({
            role: "user",
            content: "read this",
            status: "send_failed_unconfirmed"
          })
        })
      ]);
      expect(assistantApiMocks.streamAssistantWebChatTurn).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem("persai.active-web-turn.v1.thread-A")).toBeNull();
    });

    it("stop() aborts only the current thread's controller, not other threads", async () => {
      const aborts: { thread: string; aborted: boolean }[] = [];
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { surfaceThreadKey?: string },
          _handlers: unknown,
          signal?: AbortSignal
        ) => {
          const entry = { thread: payload.surfaceThreadKey ?? "?", aborted: false };
          aborts.push(entry);
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              entry.aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let sendA: Promise<void> | undefined;
      await act(async () => {
        sendA = result.current.send("hi A");
        await Promise.resolve();
      });
      await waitFor(() => expect(aborts).toHaveLength(1));

      // Switch the same hook to thread-B and start a stream there too.
      rerender({ threadKey: "thread-B" });
      let sendB: Promise<void> | undefined;
      await act(async () => {
        sendB = result.current.send("hi B");
        await Promise.resolve();
      });
      await waitFor(() => expect(aborts).toHaveLength(2));

      // stop() while viewing thread-B must abort only thread-B's controller.
      await act(async () => {
        result.current.stop();
        if (sendB !== undefined) {
          await sendB.catch(() => undefined);
        }
      });

      const aEntry = aborts.find((entry) => entry.thread === "thread-A");
      const bEntry = aborts.find((entry) => entry.thread === "thread-B");
      expect(aEntry?.aborted).toBe(false);
      expect(bEntry?.aborted).toBe(true);

      // Drain thread-A's still-running stream so the test cleans up.
      rerender({ threadKey: "thread-A" });
      await act(async () => {
        result.current.stop();
        if (sendA !== undefined) {
          await sendA.catch(() => undefined);
        }
      });
    });

    it("stop() with assistantId scoped thread key aborts only the matching assistant stream", async () => {
      const aborts: { key: string; aborted: boolean }[] = [];
      let streamIndex = 0;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: { surfaceThreadKey?: string },
          _handlers: unknown,
          signal?: AbortSignal
        ) => {
          const key =
            streamIndex === 0 ? "assistant-1::shared-thread" : "assistant-2::shared-thread";
          streamIndex += 1;
          const entry = { key, aborted: false };
          aborts.push(entry);
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              entry.aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      );
      const { result: resultA } = renderHook(
        () => useChat("shared-thread", { assistantId: "assistant-1" }),
        { wrapper }
      );
      const { result: resultB } = renderHook(
        () => useChat("shared-thread", { assistantId: "assistant-2" }),
        { wrapper }
      );

      let sendA: Promise<void> | undefined;
      let sendB: Promise<void> | undefined;
      await act(async () => {
        sendA = resultA.current.send("hi from A");
        sendB = resultB.current.send("hi from B");
        await Promise.resolve();
      });
      await waitFor(() => expect(aborts).toHaveLength(2));

      await act(async () => {
        resultB.current.stop();
        if (sendB !== undefined) {
          await sendB.catch(() => undefined);
        }
      });

      const aEntry = aborts.find((entry) => entry.key === "assistant-1::shared-thread");
      const bEntry = aborts.find((entry) => entry.key === "assistant-2::shared-thread");
      expect(aEntry?.aborted).toBe(false);
      expect(bEntry?.aborted).toBe(true);

      await act(async () => {
        resultA.current.stop();
        if (sendA !== undefined) {
          await sendA.catch(() => undefined);
        }
      });
    });
  });

  describe("ADR-166 Slice 1: same-id live USER_TURN history merge", () => {
    const sseOnlyAttachment = {
      id: "att-sse-only",
      attachmentType: "image" as const,
      originalFilename: "sse-only.png",
      mimeType: "image/png",
      sizeBytes: 42,
      processingStatus: "ready" as const,
      createdAt: "2026-07-27T12:00:01.000Z"
    };
    const historyAttachment = {
      id: "att-history",
      attachmentType: "image" as const,
      originalFilename: "history.png",
      mimeType: "image/png",
      sizeBytes: 99,
      processingStatus: "ready" as const,
      createdAt: "2026-07-27T12:00:00.500Z"
    };

    it("history refresh with early-bound USER_TURN media keeps streaming overlay, receipts, and SSE attachments", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      const olderHistory = {
        nextCursor: null as string | null,
        messages: [
          {
            id: "older-user-166",
            chatId: "chat-166-1",
            assistantId: "assistant-1",
            author: "user" as const,
            content: "prior question",
            attachments: [] as [],
            createdAt: "2026-07-27T11:00:00.000Z"
          },
          {
            id: "older-assistant-166",
            chatId: "chat-166-1",
            assistantId: "assistant-1",
            author: "assistant" as const,
            content: "prior answer",
            attachments: [] as [],
            createdAt: "2026-07-27T11:00:05.000Z"
          }
        ]
      };
      const liveHistoryPage = {
        nextCursor: null as string | null,
        messages: [
          ...olderHistory.messages,
          {
            id: "user-166-1",
            chatId: "chat-166-1",
            assistantId: "assistant-1",
            author: "user" as const,
            content: "three images please",
            attachments: [] as [],
            createdAt: "2026-07-27T12:00:00.000Z"
          },
          {
            id: "assistant-166-1",
            chatId: "chat-166-1",
            assistantId: "assistant-1",
            author: "assistant" as const,
            content: "Working on images",
            attachments: [historyAttachment],
            createdAt: "2026-07-27T12:00:00.100Z"
          }
        ]
      };
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce(olderHistory)
        .mockResolvedValue(liveHistoryPage);
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<typeof sseOnlyAttachment>;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-166-1" },
            userMessage: { id: "user-166-1", chatId: "chat-166-1", attachments: [] }
          });
          handlers.onDelta?.({ delta: "Working on images" });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-1",
            attachments: [sseOnlyAttachment]
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-166-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-166-1");
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("three images please");
        await Promise.resolve();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-166-1"
        );
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.streamingTextActive).toBe(false);
        expect(assistant?.attachments?.map((attachment) => attachment.id)).toContain(
          "att-sse-only"
        );
      });

      expect(
        result.current.messages.filter((message) => message.id === "older-user-166")
      ).toHaveLength(1);
      expect(
        result.current.messages.filter((message) => message.id === "older-assistant-166")
      ).toHaveLength(1);

      // Direct history refresh while the exact USER_TURN attempt is still live.
      await act(async () => {
        await result.current.loadHistory("chat-166-1");
      });

      const ids = result.current.messages.map((message) => message.id);
      expect(ids.filter((id) => id === "older-user-166")).toHaveLength(1);
      expect(ids.filter((id) => id === "older-assistant-166")).toHaveLength(1);
      expect(ids.filter((id) => id === "user-166-1")).toHaveLength(1);
      expect(ids.filter((id) => id === "assistant-166-1")).toHaveLength(1);
      const assistant = result.current.messages.find((message) => message.id === "assistant-166-1");
      expect(assistant?.status).toBe("streaming");
      expect(assistant?.streamingTextActive).toBe(false);
      expect(assistant?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
        "att-history",
        "att-sse-only"
      ]);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("document onMedia keeps a live PDF attachment mapped for process-timeline receipts across history refresh", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      const sseDocumentAttachment = {
        id: "att-doc-sse",
        attachmentType: "document" as const,
        originalFilename: "spec.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        processingStatus: "ready" as const,
        createdAt: "2026-07-27T12:00:01.000Z"
      };
      const historyDocumentAttachment = {
        id: "att-doc-history",
        attachmentType: "document" as const,
        originalFilename: "history-spec.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        processingStatus: "ready" as const,
        createdAt: "2026-07-27T12:00:00.500Z"
      };
      const olderHistory = {
        nextCursor: null as string | null,
        messages: [
          {
            id: "older-user-166-doc",
            chatId: "chat-166-doc",
            assistantId: "assistant-1",
            author: "user" as const,
            content: "prior question",
            attachments: [] as [],
            createdAt: "2026-07-27T11:00:00.000Z"
          },
          {
            id: "older-assistant-166-doc",
            chatId: "chat-166-doc",
            assistantId: "assistant-1",
            author: "assistant" as const,
            content: "prior answer",
            attachments: [] as [],
            createdAt: "2026-07-27T11:00:05.000Z"
          }
        ]
      };
      const liveHistoryPage = {
        nextCursor: null as string | null,
        messages: [
          ...olderHistory.messages,
          {
            id: "user-166-doc",
            chatId: "chat-166-doc",
            assistantId: "assistant-1",
            author: "user" as const,
            content: "generate a pdf",
            attachments: [] as [],
            createdAt: "2026-07-27T12:00:00.000Z"
          },
          {
            id: "assistant-166-doc",
            chatId: "chat-166-doc",
            assistantId: "assistant-1",
            author: "assistant" as const,
            content: "",
            attachments: [historyDocumentAttachment],
            createdAt: "2026-07-27T12:00:00.100Z"
          }
        ]
      };
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce(olderHistory)
        .mockResolvedValue(liveHistoryPage);
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<typeof sseDocumentAttachment>;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-166-doc" },
            userMessage: { id: "user-166-doc", chatId: "chat-166-doc", attachments: [] }
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-doc",
            attachments: [sseDocumentAttachment]
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-166-doc"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-166-doc");
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("generate a pdf");
        await Promise.resolve();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-166-doc"
        );
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.attachments?.map((attachment) => attachment.id)).toContain("att-doc-sse");
      });

      await act(async () => {
        await result.current.loadHistory("chat-166-doc");
      });

      const assistant = result.current.messages.find(
        (message) => message.id === "assistant-166-doc"
      );
      expect(assistant?.status).toBe("streaming");
      expect(assistant?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
        "att-doc-history",
        "att-doc-sse"
      ]);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("soft-detach history poll keeps same-id USER_TURN live overlay after early-bound media", async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden"
      });

      vi.useFakeTimers();
      try {
        const streamGate: { release: () => void } = { release: () => undefined };
        assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onHeadersOk?: () => void;
              onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
              onMedia?: (payload: {
                assistantMessageId: string;
                attachments: Array<typeof sseOnlyAttachment>;
              }) => void;
            },
            signal?: AbortSignal
          ) => {
            handlers.onHeadersOk?.();
            handlers.onStarted?.({
              chat: { id: "chat-166-poll" },
              userMessage: { id: "user-166-poll", chatId: "chat-166-poll", attachments: [] }
            });
            handlers.onMedia?.({
              assistantMessageId: "assistant-166-poll",
              attachments: [sseOnlyAttachment]
            });
            await new Promise<void>((resolve, reject) => {
              streamGate.release = resolve;
              signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            });
          }
        );
        assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
          status: "running",
          chat: { id: "chat-166-poll" },
          userMessage: {
            id: "user-166-poll",
            chatId: "chat-166-poll",
            assistantId: "assistant-1",
            author: "user",
            content: "draw",
            attachments: [],
            createdAt: "2026-07-27T12:30:00.000Z"
          },
          assistantMessage: {
            id: "assistant-166-poll",
            chatId: "chat-166-poll",
            assistantId: "assistant-1",
            author: "assistant",
            content: "",
            attachments: [historyAttachment],
            createdAt: "2026-07-27T12:30:01.000Z"
          },
          currentActivity: null,
          runtime: null,
          error: null
        });
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          messages: [
            {
              id: "older-user-166-poll",
              chatId: "chat-166-poll",
              assistantId: "assistant-1",
              author: "user",
              content: "prior",
              attachments: [],
              createdAt: "2026-07-27T11:30:00.000Z"
            },
            {
              id: "older-assistant-166-poll",
              chatId: "chat-166-poll",
              assistantId: "assistant-1",
              author: "assistant",
              content: "prior answer",
              attachments: [],
              createdAt: "2026-07-27T11:30:05.000Z"
            },
            {
              id: "user-166-poll",
              chatId: "chat-166-poll",
              assistantId: "assistant-1",
              author: "user",
              content: "draw",
              attachments: [],
              createdAt: "2026-07-27T12:30:00.000Z"
            },
            {
              id: "assistant-166-poll",
              chatId: "chat-166-poll",
              assistantId: "assistant-1",
              author: "assistant",
              content: "",
              attachments: [historyAttachment],
              createdAt: "2026-07-27T12:30:01.000Z"
            }
          ]
        });

        const { result } = renderHook(() => useChat("thread-166-poll"), {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        });

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
          sendPromise = result.current.send("draw", undefined, {
            clientTurnId: "client-turn-166-poll"
          });
          await Promise.resolve();
        });
        await vi.waitFor(() =>
          expect(
            result.current.messages.some((message) => message.id === "assistant-166-poll")
          ).toBe(true)
        );

        // Seed prior rows into the live transcript before the poll.
        await act(async () => {
          await result.current.loadHistory("chat-166-poll");
        });

        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible"
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_500);
          document.dispatchEvent(new Event("visibilitychange"));
          await vi.advanceTimersByTimeAsync(2_000);
        });

        await vi.waitFor(() => {
          const ids = result.current.messages.map((message) => message.id);
          expect(ids.filter((id) => id === "older-user-166-poll")).toHaveLength(1);
          expect(ids.filter((id) => id === "older-assistant-166-poll")).toHaveLength(1);
          const assistant = result.current.messages.find(
            (message) => message.id === "assistant-166-poll"
          );
          expect(assistant?.status).toBe("streaming");
          expect(assistant?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
            "att-history",
            "att-sse-only"
          ]);
        });

        streamGate.release();
        await act(async () => {
          await sendPromise?.catch(() => undefined);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("contentful soft-detach keeps live overlay while active jobs remain", async () => {
      vi.useFakeTimers();
      try {
        const remainingJobs = [
          {
            id: "job-166-remain-2",
            kind: "image" as const,
            operation: "image_generate",
            status: "running" as const,
            createdAt: "2026-07-27T12:40:00.000Z",
            startedAt: "2026-07-27T12:40:01.000Z",
            updatedAt: "2026-07-27T12:40:01.000Z"
          },
          {
            id: "job-166-remain-3",
            kind: "image" as const,
            operation: "image_generate",
            status: "running" as const,
            createdAt: "2026-07-27T12:40:00.100Z",
            startedAt: "2026-07-27T12:40:01.100Z",
            updatedAt: "2026-07-27T12:40:01.100Z"
          }
        ];
        assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onHeadersOk?: () => void;
              onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
              onDelta?: (payload: { delta: string }) => void;
              onMedia?: (payload: {
                assistantMessageId: string;
                attachments: Array<typeof sseOnlyAttachment>;
              }) => void;
              onAsyncJobsOpen?: (payload: {
                activeMediaJobs: typeof remainingJobs;
                activeDocumentJobs: unknown[];
                activeSandboxJobs: unknown[];
              }) => void;
            }
          ) => {
            handlers.onHeadersOk?.();
            handlers.onStarted?.({
              chat: { id: "chat-166-contentful" },
              userMessage: {
                id: "user-166-contentful",
                chatId: "chat-166-contentful",
                attachments: []
              }
            });
            handlers.onDelta?.({ delta: "Working on images" });
            handlers.onMedia?.({
              assistantMessageId: "assistant-166-contentful",
              attachments: [sseOnlyAttachment]
            });
            handlers.onAsyncJobsOpen?.({
              activeMediaJobs: remainingJobs,
              activeDocumentJobs: [],
              activeSandboxJobs: []
            });
            throw new TypeError("network disconnected while tab was backgrounded");
          }
        );
        assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
          status: "running",
          chat: { id: "chat-166-contentful" },
          userMessage: {
            id: "user-166-contentful",
            chatId: "chat-166-contentful",
            assistantId: "assistant-1",
            author: "user",
            content: "draw three",
            attachments: [],
            createdAt: "2026-07-27T12:40:00.000Z"
          },
          assistantMessage: {
            id: "assistant-166-contentful",
            chatId: "chat-166-contentful",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Working on images",
            attachments: [historyAttachment],
            createdAt: "2026-07-27T12:40:01.000Z"
          },
          currentActivity: null,
          runtime: null,
          error: null
        });
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          activeMediaJobs: remainingJobs,
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: [
            {
              id: "user-166-contentful",
              chatId: "chat-166-contentful",
              assistantId: "assistant-1",
              author: "user",
              content: "draw three",
              attachments: [],
              createdAt: "2026-07-27T12:40:00.000Z"
            },
            {
              id: "assistant-166-contentful",
              chatId: "chat-166-contentful",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Working on images",
              attachments: [historyAttachment],
              createdAt: "2026-07-27T12:40:01.000Z"
            }
          ]
        });

        const { result } = renderHook(() => useChat("thread-166-contentful"), {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        });

        await act(async () => {
          await result.current.send("draw three", undefined, {
            clientTurnId: "client-turn-166-contentful"
          });
        });

        await vi.waitFor(() => {
          const assistant = result.current.messages.find(
            (message) => message.id === "assistant-166-contentful"
          );
          expect(assistant?.status).toBe("streaming");
          expect(assistant?.content).toContain("Working on images");
          expect(result.current.activeMediaJobs).toHaveLength(2);
        });

        // Soft-detach reconcile: reattach ends (controller released) then history
        // poll sees contentful same-id + remaining jobs — must stay live.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6_000);
        });

        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-166-contentful"
        );
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.content).toContain("Working on images");
        expect(result.current.activeMediaJobs.map((job) => job.id).sort()).toEqual([
          "job-166-remain-2",
          "job-166-remain-3"
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("attachment-only empty-text soft-detach demotes when attempt is idle and jobs are gone", async () => {
      vi.useFakeTimers();
      try {
        assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onHeadersOk?: () => void;
              onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
              onMedia?: (payload: {
                assistantMessageId: string;
                attachments: Array<typeof historyAttachment>;
              }) => void;
            }
          ) => {
            handlers.onHeadersOk?.();
            handlers.onStarted?.({
              chat: { id: "chat-166-empty-demote" },
              userMessage: {
                id: "user-166-empty-demote",
                chatId: "chat-166-empty-demote",
                attachments: []
              }
            });
            handlers.onMedia?.({
              assistantMessageId: "assistant-166-empty-demote",
              attachments: [historyAttachment]
            });
            throw new TypeError("network disconnected while tab was backgrounded");
          }
        );
        // Reattach reports unknown — missed terminal; history is the recovery path.
        assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
          status: "unknown",
          chat: null,
          userMessage: null,
          assistantMessage: null,
          currentActivity: null,
          runtime: null,
          error: null
        });
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          messages: [
            {
              id: "user-166-empty-demote",
              chatId: "chat-166-empty-demote",
              assistantId: "assistant-1",
              author: "user",
              content: "one image",
              attachments: [],
              createdAt: "2026-07-27T12:50:00.000Z"
            },
            {
              id: "assistant-166-empty-demote",
              chatId: "chat-166-empty-demote",
              assistantId: "assistant-1",
              author: "assistant",
              content: "",
              attachments: [historyAttachment],
              createdAt: "2026-07-27T12:50:01.000Z"
            }
          ]
        });

        const { result } = renderHook(() => useChat("thread-166-empty-demote"), {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        });

        await act(async () => {
          await result.current.send("one image", undefined, {
            clientTurnId: "client-turn-166-empty-demote"
          });
        });

        await vi.waitFor(() => {
          expect(
            result.current.messages.some((message) => message.id === "assistant-166-empty-demote")
          ).toBe(true);
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(6_000);
        });

        await vi.waitFor(() => {
          const assistant = result.current.messages.find(
            (message) => message.id === "assistant-166-empty-demote"
          );
          expect(assistant?.status).not.toBe("streaming");
          expect(assistant?.status).not.toBe("reconciling");
          expect(assistant?.attachments?.map((attachment) => attachment.id)).toEqual([
            "att-history"
          ]);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("same-id onMedia retries preserve receipt identity on primary and reattach", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<typeof sseOnlyAttachment>;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-166-place" },
            userMessage: { id: "user-166-place", chatId: "chat-166-place", attachments: [] }
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-place",
            attachments: [sseOnlyAttachment]
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-place",
            attachments: [sseOnlyAttachment]
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-166-place"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("place me", undefined, {
          clientTurnId: "client-turn-166-place"
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-166-place"
        );
        expect(assistant?.attachments?.map((attachment) => attachment.id)).toEqual([
          "att-sse-only"
        ]);
      });

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });

      window.sessionStorage.setItem(
        "persai.active-web-turn.v1.thread-166-place-reattach",
        "turn-166-place-reattach"
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
        status: "running",
        chat: { id: "chat-166-place-reattach" },
        userMessage: {
          id: "user-166-place-reattach",
          chatId: "chat-166-place-reattach",
          assistantId: "assistant-1",
          author: "user",
          content: "place me",
          attachments: [],
          createdAt: "2026-07-27T13:00:00.000Z"
        },
        assistantMessage: {
          id: "assistant-166-place-reattach",
          chatId: "chat-166-place-reattach",
          assistantId: "assistant-1",
          author: "assistant",
          content: "",
          attachments: [sseOnlyAttachment],
          createdAt: "2026-07-27T13:00:01.000Z"
        },
        currentActivity: null,
        runtime: null,
        error: null
      });
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
        async (
          _token: string,
          clientTurnId: string,
          handlers: {
            onHeadersOk?: () => void;
            onTurnStatus?: (payload: { turn: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<typeof sseOnlyAttachment>;
            }) => void;
          }
        ) => {
          if (clientTurnId !== "turn-166-place-reattach") {
            const turn = await assistantApiMocks.getAssistantWebChatTurnStatus(
              "token-1",
              clientTurnId
            );
            handlers.onTurnStatus?.({ turn });
            return;
          }
          handlers.onHeadersOk?.();
          handlers.onTurnStatus?.({
            turn: {
              status: "running",
              chat: { id: "chat-166-place-reattach" },
              userMessage: {
                id: "user-166-place-reattach",
                chatId: "chat-166-place-reattach",
                assistantId: "assistant-1",
                author: "user",
                content: "place me",
                attachments: [],
                createdAt: "2026-07-27T13:00:00.000Z"
              },
              assistantMessage: {
                id: "assistant-166-place-reattach",
                chatId: "chat-166-place-reattach",
                assistantId: "assistant-1",
                author: "assistant",
                content: "",
                attachments: [sseOnlyAttachment],
                createdAt: "2026-07-27T13:00:01.000Z"
              },
              currentActivity: null,
              runtime: null,
              error: null
            }
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-place-reattach",
            attachments: [sseOnlyAttachment]
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-place-reattach",
            attachments: [sseOnlyAttachment]
          });
        }
      );

      const { result: reattachResult } = renderHook(() => useChat("thread-166-place-reattach"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await waitFor(() => {
        const assistant = reattachResult.current.messages.find(
          (message) => message.id === "assistant-166-place-reattach"
        );
        expect(assistant?.attachments?.map((attachment) => attachment.id)).toEqual([
          "att-sse-only"
        ]);
      });
    });

    it("primary and reattach onMedia both keep streaming + streamingTextActive false + receipts", async () => {
      const streamGate: { release: () => void } = { release: () => undefined };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<typeof sseOnlyAttachment>;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-166-parity" },
            userMessage: { id: "user-166-parity", chatId: "chat-166-parity", attachments: [] }
          });
          handlers.onDelta?.({ delta: "partial " });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-parity",
            attachments: [sseOnlyAttachment]
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-166-parity"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("draw one");
        await Promise.resolve();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-166-parity"
        );
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.streamingTextActive).toBe(false);
        expect(assistant?.attachments?.[0]?.id).toBe("att-sse-only");
      });

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });

      window.sessionStorage.setItem(
        "persai.active-web-turn.v1.thread-166-reattach",
        "turn-166-reattach"
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
        status: "running",
        chat: { id: "chat-166-reattach" },
        userMessage: {
          id: "user-166-reattach",
          chatId: "chat-166-reattach",
          assistantId: "assistant-1",
          author: "user",
          content: "draw one",
          attachments: [],
          createdAt: "2026-07-27T12:10:00.000Z"
        },
        assistantMessage: {
          id: "assistant-166-reattach",
          chatId: "chat-166-reattach",
          assistantId: "assistant-1",
          author: "assistant",
          content: "",
          attachments: [],
          createdAt: "2026-07-27T12:10:01.000Z"
        },
        currentActivity: null,
        runtime: null,
        error: null
      });
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
        async (
          _token: string,
          _clientTurnId: string,
          handlers: {
            onHeadersOk?: () => void;
            onTurnStatus?: (payload: { turn: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<typeof sseOnlyAttachment>;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onTurnStatus?.({
            turn: {
              status: "running",
              chat: { id: "chat-166-reattach" },
              userMessage: {
                id: "user-166-reattach",
                chatId: "chat-166-reattach",
                assistantId: "assistant-1",
                author: "user",
                content: "draw one",
                attachments: [],
                createdAt: "2026-07-27T12:10:01.000Z"
              },
              assistantMessage: {
                id: "assistant-166-reattach",
                chatId: "chat-166-reattach",
                assistantId: "assistant-1",
                author: "assistant",
                content: "",
                attachments: [],
                createdAt: "2026-07-27T12:10:01.000Z"
              },
              currentActivity: null,
              runtime: null,
              error: null
            }
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-166-reattach",
            attachments: [{ ...sseOnlyAttachment, id: "att-reattach-only" }]
          });
        }
      );

      const { result: reattachResult } = renderHook(() => useChat("thread-166-reattach"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await waitFor(() => {
        const assistant = reattachResult.current.messages.find(
          (message) => message.id === "assistant-166-reattach"
        );
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.streamingTextActive).toBe(false);
        expect(assistant?.attachments?.[0]?.id).toBe("att-reattach-only");
      });
    });

    it("terminal history with final same-id content still replaces the live overlay", async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden"
      });

      vi.useFakeTimers();
      try {
        let observedSignal: AbortSignal | undefined;
        let sendPromise: Promise<void> | undefined;
        assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onHeadersOk?: () => void;
              onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
              onMedia?: (payload: {
                assistantMessageId: string;
                attachments: Array<typeof sseOnlyAttachment>;
              }) => void;
            },
            signal?: AbortSignal
          ) => {
            observedSignal = signal;
            handlers.onHeadersOk?.();
            handlers.onStarted?.({
              chat: { id: "chat-166-term" },
              userMessage: { id: "user-166-term", chatId: "chat-166-term", attachments: [] }
            });
            handlers.onMedia?.({
              assistantMessageId: "assistant-166-term",
              attachments: [sseOnlyAttachment]
            });
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            });
          }
        );
        assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
          status: "completed",
          chat: { id: "chat-166-term" },
          userMessage: {
            id: "user-166-term",
            chatId: "chat-166-term",
            assistantId: "assistant-1",
            author: "user",
            content: "draw",
            attachments: [],
            createdAt: "2026-07-27T12:20:00.000Z"
          },
          assistantMessage: {
            id: "assistant-166-term",
            chatId: "chat-166-term",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Here is your image.",
            attachments: [historyAttachment, sseOnlyAttachment],
            createdAt: "2026-07-27T12:20:01.000Z"
          },
          currentActivity: null,
          runtime: null,
          error: null
        });
        assistantApiMocks.getChatMessages.mockResolvedValue({
          nextCursor: null,
          messages: [
            {
              id: "user-166-term",
              chatId: "chat-166-term",
              assistantId: "assistant-1",
              author: "user",
              content: "draw",
              attachments: [],
              createdAt: "2026-07-27T12:20:00.000Z"
            },
            {
              id: "assistant-166-term",
              chatId: "chat-166-term",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Here is your image.",
              attachments: [historyAttachment, sseOnlyAttachment],
              createdAt: "2026-07-27T12:20:01.000Z"
            }
          ]
        });

        const { result } = renderHook(() => useChat("thread-166-term"), {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        });

        await act(async () => {
          sendPromise = result.current.send("draw", undefined, {
            clientTurnId: "client-turn-166-term"
          });
          await Promise.resolve();
        });
        await vi.waitFor(() =>
          expect(
            result.current.messages.some((message) => message.id === "assistant-166-term")
          ).toBe(true)
        );
        expect(
          result.current.messages.find((message) => message.id === "assistant-166-term")?.status
        ).toBe("streaming");

        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible"
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_500);
          document.dispatchEvent(new Event("visibilitychange"));
        });

        await vi.waitFor(() => {
          const assistant = result.current.messages.find(
            (message) => message.id === "assistant-166-term"
          );
          expect(assistant?.status).toBe("committed");
          expect(assistant?.content).toBe("Here is your image.");
          expect(assistant?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
            "att-history",
            "att-sse-only"
          ]);
          expect(result.current.isStreaming).toBe(false);
        });

        expect(observedSignal?.aborted).toBe(true);
        await act(async () => {
          await sendPromise?.catch(() => undefined);
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("server-side soft-detach (slice 1.2)", () => {
    /**
     * The bug being fixed: the SSE controller used to abort the runtime
     * turn on *any* client disconnect — including a phone screen lock or
     * a tab going to background. Slice 1.2 splits "explicit Stop" (hard
     * abort) from "passive disconnect" (soft detach). The web side of the
     * split is `useChat.stop()`: before tearing down its local
     * `AbortController`, it must POST to `/assistant/chat/web/stop` so
     * the API knows this is a hard abort and the runtime should be
     * stopped. Conversely, anything that just tears down the local
     * controller without going through `stop()` (component unmount,
     * navigation, network drop) must *not* fire the POST — that's how the
     * runtime ends up in soft-detach mode.
     */
    it("stop() waits briefly for the hard-stop POST before aborting the local controller", async () => {
      let observedSignal: AbortSignal | undefined;
      let observedClientTurnId: string | undefined;
      let resolveStopPost: (() => void) | undefined;
      const stopPostStarted: Promise<void> = new Promise((resolve) => {
        assistantApiMocks.stopAssistantWebChatTurn.mockImplementationOnce(async () => {
          resolve();
          await new Promise<void>((stopResolve) => {
            resolveStopPost = stopResolve;
          });
        });
      });
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { clientTurnId?: string },
          _handlers: unknown,
          signal?: AbortSignal
        ) => {
          observedSignal = signal;
          observedClientTurnId = payload.clientTurnId;
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("hi");
        await Promise.resolve();
      });
      await waitFor(() => expect(observedClientTurnId).toBeDefined());

      act(() => {
        result.current.stop();
      });
      await stopPostStarted;

      // The hard-stop POST must fire with the same clientTurnId the
      // streaming endpoint received, so the API can route it through the
      // registry to the matching `AbortController`.
      await waitFor(() => {
        expect(assistantApiMocks.stopAssistantWebChatTurn).toHaveBeenCalledTimes(1);
      });
      expect(assistantApiMocks.stopAssistantWebChatTurn).toHaveBeenCalledWith(
        "token-1",
        observedClientTurnId
      );
      expect(observedSignal?.aborted).toBe(false);

      await act(async () => {
        resolveStopPost?.();
        if (sendPromise !== undefined) {
          await sendPromise.catch(() => undefined);
        }
      });

      expect(observedSignal?.aborted).toBe(true);
    });

    it("does not POST stop when the user simply navigates away (soft-detach)", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(async () => {
        // Stream "stays open" forever — the test exits while it's still
        // pending. The local AbortController is GC'd when the hook
        // unmounts, but the explicit hard-stop POST must *not* fire,
        // because the user did not press Stop.
        await new Promise(() => undefined);
      });

      const { result, unmount } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        void result.current.send("background me");
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1)
      );

      unmount();

      // No `stop()` was ever invoked, so the new explicit hard-stop POST
      // must not fire on plain unmount. This is what lets the API keep
      // the runtime alive on screen-lock / tab-switch.
      expect(assistantApiMocks.stopAssistantWebChatTurn).not.toHaveBeenCalled();
    });

    it("stop() still aborts locally even if the hard-stop POST rejects", async () => {
      // The POST is best-effort after a short wait: a network failure here
      // just means the runtime may keep generating server-side, which is no
      // worse than the soft-detach path. The user-visible UI guarantee —
      // composer unfreezes, isStreaming flips off — must hold regardless.
      assistantApiMocks.stopAssistantWebChatTurn.mockRejectedValueOnce(new Error("network down"));

      let observedSignal: AbortSignal | undefined;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (_token: string, _payload: unknown, _handlers: unknown, signal?: AbortSignal) => {
          observedSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("hi");
        await Promise.resolve();
      });
      await waitFor(() => expect(observedSignal).toBeDefined());

      await act(async () => {
        result.current.stop();
        if (sendPromise !== undefined) {
          await sendPromise.catch(() => undefined);
        }
      });

      // Local abort happened despite the POST rejection.
      expect(observedSignal?.aborted).toBe(true);
    });
  });

  describe("soft-detach resume refresh", () => {
    it("reconciles a switched-away passive disconnect against the originating chat", async () => {
      let releaseStream: (() => void) | null = null;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A", chatId: "chat-A", attachments: [] }
          });
          await new Promise<void>((resolve) => {
            releaseStream = () => {
              resolve();
            };
          });
          throw new TypeError("network disconnected while viewing another chat");
        }
      );
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, requestedChatId: string) => {
          if (requestedChatId === "chat-B") {
            return {
              nextCursor: null,
              messages: [
                {
                  id: "server-user-B",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "other chat",
                  attachments: [],
                  createdAt: "2026-04-25T17:50:00.000Z"
                },
                {
                  id: "server-assistant-B",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "assistant",
                  content: "Other answer.",
                  attachments: [],
                  createdAt: "2026-04-25T17:50:05.000Z"
                }
              ]
            };
          }
          if (requestedChatId === "chat-A") {
            return {
              nextCursor: null,
              messages: [
                {
                  id: "server-user-A",
                  chatId: "chat-A",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "keep going",
                  attachments: [],
                  createdAt: "2026-04-25T17:45:35.000Z"
                },
                {
                  id: "server-assistant-A",
                  chatId: "chat-A",
                  assistantId: "assistant-1",
                  author: "assistant",
                  content: "Recovered.",
                  attachments: [],
                  createdAt: "2026-04-25T17:45:45.000Z"
                }
              ]
            };
          }
          return { nextCursor: null, messages: [] };
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("keep going");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
        expect(result.current.chatId).toBe("chat-A");
      });

      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      expect(result.current.chatId).toBe("chat-B");

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });

      await waitFor(() => {
        expect(
          assistantApiMocks.getChatMessages.mock.calls.some(
            (call) => call[1] === "chat-A" && call[2] === undefined && call[3] === 20
          )
        ).toBe(true);
      });

      rerender({ threadKey: "thread-A" });
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-A",
        "server-assistant-A"
      ]);
    });

    it("refreshes terminal reattach history against the originating chat after switching away", async () => {
      let releaseStream: (() => void) | null = null;
      let chatATerminal = false;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A", chatId: "chat-A", attachments: [] }
          });
          await new Promise<void>((resolve) => {
            releaseStream = () => {
              resolve();
            };
          });
          throw new TypeError("network disconnected while viewing another chat");
        }
      );
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
        async (
          _token: string,
          _clientTurnId: string,
          handlers: {
            onHeadersOk?: () => void;
            onCompleted?: () => void | Promise<void>;
          }
        ) => {
          handlers.onHeadersOk?.();
          chatATerminal = true;
          await handlers.onCompleted?.();
        }
      );
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, chatId: string) => {
          if (chatId === "chat-B") {
            return {
              nextCursor: null,
              messages: [
                {
                  id: "server-user-B",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "other chat",
                  attachments: [],
                  createdAt: "2026-04-25T17:50:00.000Z"
                },
                {
                  id: "server-assistant-B",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "assistant",
                  content: "Other answer.",
                  attachments: [],
                  createdAt: "2026-04-25T17:50:05.000Z"
                }
              ]
            };
          }
          if (chatId === "chat-A") {
            if (chatATerminal) {
              return {
                nextCursor: null,
                messages: [
                  {
                    id: "server-user-A",
                    chatId: "chat-A",
                    assistantId: "assistant-1",
                    author: "user",
                    content: "keep going",
                    attachments: [],
                    createdAt: "2026-04-25T17:45:35.000Z"
                  },
                  {
                    id: "server-assistant-A",
                    chatId: "chat-A",
                    assistantId: "assistant-1",
                    author: "assistant",
                    content: "Recovered via reattach.",
                    attachments: [],
                    createdAt: "2026-04-25T17:45:45.000Z"
                  }
                ]
              };
            }
            return {
              nextCursor: null,
              messages: [
                {
                  id: "server-user-A",
                  chatId: "chat-A",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "keep going",
                  attachments: [],
                  createdAt: "2026-04-25T17:45:35.000Z"
                }
              ]
            };
          }
          return { nextCursor: null, messages: [] };
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("keep going");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
        expect(result.current.chatId).toBe("chat-A");
      });

      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      expect(result.current.chatId).toBe("chat-B");

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });

      await waitFor(() => {
        expect(chatATerminal).toBe(true);
        expect(
          assistantApiMocks.getChatMessages.mock.calls.some((call) => call[1] === "chat-A")
        ).toBe(true);
      });

      rerender({ threadKey: "thread-A" });
      await waitFor(() => {
        expect(result.current.messages.map((message) => message.id)).toEqual([
          "server-user-A",
          "server-assistant-A"
        ]);
      });
    });

    it("keeps post-headers passive stream disconnects quiet and reconciles history", async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible"
      });
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] }
          });
          throw new TypeError("network disconnected while tab was backgrounded");
        }
      );
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        activeTurn: null,
        messages: [
          {
            id: "server-user-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "make images",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          },
          {
            id: "server-assistant-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Done.",
            attachments: [
              {
                id: "att-1",
                attachmentType: "image",
                originalFilename: "image.png",
                mimeType: "image/png",
                sizeBytes: 123,
                processingStatus: "ready",
                createdAt: "2026-04-25T17:48:03.000Z"
              }
            ],
            createdAt: "2026-04-25T17:48:03.000Z"
          }
        ]
      });

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("make images");
      });

      expect(result.current.issue).toBeNull();

      await waitFor(() => {
        expect(assistantApiMocks.getChatMessages).toHaveBeenCalledWith(
          "token-1",
          "chat-1",
          undefined,
          20
        );
      });
      await waitFor(() => {
        expect(result.current.issue).toBeNull();
        expect(result.current.isStreaming).toBe(false);
      });
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-1",
        "server-assistant-1"
      ]);
      expect(result.current.messages[1]?.attachments?.[0]?.id).toBe("att-1");
    });

    it("replaces a stale local thinking placeholder when passive reconnect history materializes the turn before onStarted", async () => {
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-old",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "older question",
              attachments: [],
              createdAt: "2026-04-25T17:40:35.000Z"
            },
            {
              id: "server-assistant-old",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Older answer.",
              attachments: [],
              createdAt: "2026-04-25T17:41:05.000Z"
            }
          ]
        })
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-old",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "older question",
              attachments: [],
              createdAt: "2026-04-25T17:40:35.000Z"
            },
            {
              id: "server-assistant-old",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Older answer.",
              attachments: [],
              createdAt: "2026-04-25T17:41:05.000Z"
            },
            {
              id: "server-user-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "сожми контекст",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            },
            {
              id: "server-assistant-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Сжал.",
              attachments: [],
              createdAt: "2026-04-25T17:46:05.000Z"
            }
          ]
        });
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (_token: string, _payload: unknown, handlers: { onHeadersOk?: () => void }) => {
          handlers.onHeadersOk?.();
          throw new TypeError("network disconnected while tab was backgrounded");
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-1");
      });
      expect(result.current.chatId).toBe("chat-1");

      await act(async () => {
        await result.current.send("сожми контекст");
      });

      await waitFor(() => {
        expect(assistantApiMocks.getChatMessages).toHaveBeenCalledTimes(2);
      });
      await waitFor(() => {
        expect(result.current.issue).toBeNull();
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.messages.map((message) => message.id)).toEqual([
          "server-user-old",
          "server-assistant-old",
          "server-user-1",
          "server-assistant-1"
        ]);
      });
      expect(
        result.current.messages.some(
          (message) => message.id.startsWith("local-") || message.status === "streaming"
        )
      ).toBe(false);
    });

    it("clears stale streaming when resume history already has the completed image turn", async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden"
      });

      let observedSignal: AbortSignal | undefined;
      let sendPromise: Promise<void> | undefined;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          },
          signal?: AbortSignal
        ) => {
          observedSignal = signal;
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] }
          });
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        messages: [
          {
            id: "server-user-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "нарисуй картинку",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          },
          {
            id: "server-assistant-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Готово.",
            attachments: [
              {
                id: "att-1",
                attachmentType: "image",
                originalFilename: "image.png",
                mimeType: "image/png",
                sizeBytes: 123,
                processingStatus: "ready",
                createdAt: "2026-04-25T17:48:03.000Z"
              }
            ],
            createdAt: "2026-04-25T17:48:03.000Z"
          }
        ]
      });

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        sendPromise = result.current.send("нарисуй картинку");
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.isStreaming).toBe(true));

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible"
      });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await waitFor(() => {
        expect(assistantApiMocks.getChatMessages).toHaveBeenCalledWith(
          "token-1",
          "chat-1",
          undefined,
          20
        );
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.messages.map((message) => message.id)).toEqual([
          "server-user-1",
          "server-assistant-1"
        ]);
      });
      expect(result.current.messages[1]?.attachments?.[0]?.id).toBe("att-1");
      expect(observedSignal?.aborted).toBe(true);
      expect(assistantApiMocks.stopAssistantWebChatTurn).not.toHaveBeenCalled();

      await sendPromise?.catch(() => undefined);
    });

    it("continues bounded resume polling when the first resume refresh lands before tool completion", async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden"
      });

      vi.useFakeTimers();
      try {
        let observedSignal: AbortSignal | undefined;
        let sendPromise: Promise<void> | undefined;
        assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onHeadersOk?: () => void;
              onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            },
            signal?: AbortSignal
          ) => {
            observedSignal = signal;
            handlers.onHeadersOk?.();
            handlers.onStarted?.({
              chat: { id: "chat-1" },
              userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] }
            });
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            });
          }
        );
        const incompleteHistory = {
          nextCursor: null,
          messages: [
            {
              id: "server-user-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "нарисуй картинку",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            }
          ]
        };
        assistantApiMocks.getChatMessages
          .mockResolvedValueOnce(incompleteHistory)
          .mockResolvedValue({
            nextCursor: null,
            messages: [
              {
                id: "server-user-1",
                chatId: "chat-1",
                assistantId: "assistant-1",
                author: "user",
                content: "нарисуй картинку",
                attachments: [],
                createdAt: "2026-04-25T17:45:35.000Z"
              },
              {
                id: "server-assistant-1",
                chatId: "chat-1",
                assistantId: "assistant-1",
                author: "assistant",
                content: "Готово.",
                attachments: [
                  {
                    id: "att-1",
                    attachmentType: "image",
                    originalFilename: "image.png",
                    mimeType: "image/png",
                    sizeBytes: 123,
                    processingStatus: "ready",
                    createdAt: "2026-04-25T17:48:03.000Z"
                  }
                ],
                createdAt: "2026-04-25T17:48:03.000Z"
              }
            ]
          });
        const runningTurnStatus = {
          status: "running",
          chat: null,
          userMessage: {
            id: "server-user-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "нарисуй картинку",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          },
          assistantMessage: null,
          currentActivity: {
            type: "tool_use",
            toolName: "image_generate",
            toolCallId: "tool-1",
            phase: "start",
            isError: false,
            updatedAt: "2026-04-25T17:45:36.000Z"
          },
          runtime: null,
          error: null
        };
        assistantApiMocks.getAssistantWebChatTurnStatus
          .mockResolvedValueOnce(runningTurnStatus)
          .mockResolvedValueOnce(runningTurnStatus)
          .mockResolvedValue({
            status: "completed",
            chat: null,
            userMessage: {
              id: "server-user-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "нарисуй картинку",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            },
            assistantMessage: {
              id: "server-assistant-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Готово.",
              attachments: [
                {
                  id: "att-1",
                  attachmentType: "image",
                  originalFilename: "image.png",
                  mimeType: "image/png",
                  sizeBytes: 123,
                  processingStatus: "ready",
                  createdAt: "2026-04-25T17:48:03.000Z"
                }
              ],
              createdAt: "2026-04-25T17:48:03.000Z"
            },
            currentActivity: null,
            runtime: {
              respondedAt: "2026-04-25T17:48:03.000Z",
              degradedByQuotaFallback: false,
              quotaFallbackReason: null,
              quotaFallbackModel: null
            },
            error: null
          });

        const { result } = renderHook(() => useChat("thread-1"), {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        });

        await act(async () => {
          sendPromise = result.current.send("нарисуй картинку");
          await Promise.resolve();
        });
        await vi.waitFor(() => expect(result.current.isStreaming).toBe(true));

        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible"
        });
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
        });

        await vi.waitFor(() =>
          expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalled()
        );
        expect(result.current.isStreaming).toBe(true);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_500);
          document.dispatchEvent(new Event("visibilitychange"));
        });

        await vi.waitFor(() => {
          expect(result.current.isStreaming).toBe(false);
          expect(result.current.messages.map((message) => message.id)).toEqual([
            "server-user-1",
            "server-assistant-1"
          ]);
        });
        expect(result.current.messages[1]?.attachments?.[0]?.id).toBe("att-1");
        expect(observedSignal?.aborted).toBe(true);
        expect(assistantApiMocks.stopAssistantWebChatTurn).not.toHaveBeenCalled();

        await sendPromise?.catch(() => undefined);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a passive mid-turn disconnect latched without an error until reconciliation", async () => {
      vi.useFakeTimers();
      try {
        assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onHeadersOk?: () => void;
              onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            }
          ) => {
            handlers.onHeadersOk?.();
            handlers.onStarted?.({
              chat: { id: "chat-1" },
              userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] }
            });
            throw new TypeError("network disconnected after headers");
          }
        );
        assistantApiMocks.reattachAssistantWebChatTurnStream.mockRejectedValue(
          new Error("reattach unavailable")
        );

        const incompleteHistory = {
          nextCursor: null,
          activeTurn: null,
          messages: [
            {
              id: "older-user-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "older",
              attachments: [],
              createdAt: "2026-04-25T17:40:00.000Z"
            },
            {
              id: "older-assistant-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Older answer.",
              attachments: [],
              createdAt: "2026-04-25T17:40:05.000Z"
            }
          ]
        };
        const completedHistory = {
          nextCursor: null,
          activeTurn: null,
          messages: [
            {
              id: "server-user-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "user",
              content: "long image turn",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            },
            {
              id: "server-assistant-1",
              chatId: "chat-1",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Finally done.",
              attachments: [],
              createdAt: "2026-04-25T17:48:03.000Z"
            }
          ]
        };
        assistantApiMocks.getChatMessages.mockResolvedValue(incompleteHistory);

        const { result } = renderHook(() => useChat("thread-1"), {
          wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
        });

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
          sendPromise = result.current.send("long image turn");
          await Promise.resolve();
        });
        await act(async () => {
          await sendPromise;
        });

        await vi.waitFor(() => expect(result.current.isStreaming).toBe(true));
        expect(result.current.issue).toBeNull();
        expect(result.current.messages.some((message) => message.status === "streaming")).toBe(
          true
        );

        await act(async () => {
          await vi.advanceTimersByTimeAsync(122_000);
        });
        expect(assistantApiMocks.getChatMessages.mock.calls.length).toBeGreaterThanOrEqual(60);
        expect(result.current.isStreaming).toBe(true);
        expect(result.current.messages.some((message) => message.status === "streaming")).toBe(
          true
        );

        assistantApiMocks.getChatMessages.mockResolvedValue(completedHistory);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        });
        await vi.waitFor(() => {
          expect(result.current.isStreaming).toBe(false);
          expect(result.current.messages.map((message) => message.id)).toEqual([
            "server-user-1",
            "server-assistant-1"
          ]);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a post-headers passive disconnect recoverable even before onStarted provides a chat id", async () => {
      // Pre-onStarted disconnect uses startStoredActiveTurnRestore (no chatId yet).
      // Product must treat onReattached completed as terminal_status and stop the
      // restore loop — otherwise under parallel load the 1s retry storm inflates
      // reattach counts while the UI already recovered.
      let recoveredClientTurnId: string | null = null;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          throw new TypeError("network disconnected before started event");
        }
      );
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
        async (
          _token: string,
          clientTurnId: string,
          handlers: {
            onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          }
        ) => {
          if (recoveredClientTurnId === null) {
            recoveredClientTurnId = clientTurnId;
          }
          // Idempotent: every call for this turn reports the same terminal truth.
          // After the product fix only one call should occur; duplicates must not
          // invent a second bubble or call Stop.
          handlers.onReattached?.({
            live: false,
            turn: {
              status: "completed",
              chat: { id: "chat-1" },
              userMessage: {
                id: "server-user-1",
                chatId: "chat-1",
                assistantId: "assistant-1",
                author: "user",
                content: "recover without started",
                attachments: [],
                createdAt: "2026-04-25T17:45:35.000Z"
              },
              assistantMessage: {
                id: "server-assistant-1",
                chatId: "chat-1",
                assistantId: "assistant-1",
                author: "assistant",
                content: "Recovered.",
                attachments: [],
                createdAt: "2026-04-25T17:45:45.000Z"
              },
              currentActivity: null,
              runtime: null,
              error: null
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("recover without started");
        await Promise.resolve();
      });
      await act(async () => {
        await sendPromise;
      });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.messages.map((message) => message.id)).toEqual([
          "server-user-1",
          "server-assistant-1"
        ]);
      });
      expect(recoveredClientTurnId).not.toBeNull();
      const reattachCallsForTurn =
        assistantApiMocks.reattachAssistantWebChatTurnStream.mock.calls.filter(
          (call) => call[1] === recoveredClientTurnId
        );
      // Exact one reattach owns recovery for this clientTurnId after terminal_status.
      expect(reattachCallsForTurn).toHaveLength(1);
      expect(assistantApiMocks.stopAssistantWebChatTurn).not.toHaveBeenCalled();
      expect(
        result.current.messages.filter((message) => message.role === "assistant")
      ).toHaveLength(1);
    });

    it("surfaces failed reattach payloads as an issue", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          throw new TypeError("network disconnected before started event");
        }
      );
      let emittedFailedReattach = false;
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(
        async (
          _token: string,
          _clientTurnId: string,
          handlers: {
            onFailed?: (payload: { code?: string; message: string; transport: unknown }) => void;
          }
        ) => {
          if (emittedFailedReattach) {
            return;
          }
          emittedFailedReattach = true;
          handlers.onFailed?.({
            code: "tool_daily_limit_reached",
            message: "Browser is exhausted for the current daily limit.",
            transport: {}
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("recover with failure");
      });

      await waitFor(() => {
        expect(result.current.issue).toMatchObject({
          classId: "quota_limit_reached",
          message: "Browser is exhausted for the current daily limit."
        });
      });
    });

    it("treats a failed stream before started as a non-accepted turn and clears pending send", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onFailed?: (payload: { code?: string; message: string; transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onFailed?.({
            code: "assistant_turn_failed",
            message: "Prepare step failed before the turn started.",
            transport: null
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("fail before started");
      });

      await waitFor(() => {
        expect(result.current.pendingSendStatus).toBeNull();
        expect(result.current.isStreaming).toBe(false);
      });
      expect(result.current.issue).toMatchObject({
        classId: "unknown",
        message: "Chat could not complete this turn."
      });
      expect(result.current.messages).toEqual([]);
    });

    it("uses turn status when tail history does not include the completed turn", async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible"
      });
      let observedSignal: AbortSignal | undefined;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          },
          signal?: AbortSignal
        ) => {
          observedSignal = signal;
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] }
          });
          throw new TypeError("network disconnected while tab was backgrounded");
        }
      );
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: "older",
        messages: Array.from({ length: 20 }, (_value, index) => ({
          id: `tail-message-${index}`,
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: index % 2 === 0 ? "user" : "assistant",
          content: `tail ${index}`,
          attachments: [],
          createdAt: `2026-04-25T17:49:${String(index).padStart(2, "0")}.000Z`
        }))
      });
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
        status: "completed",
        chat: null,
        userMessage: {
          id: "server-user-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "older turn",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        assistantMessage: {
          id: "server-assistant-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Recovered from turn status.",
          attachments: [],
          createdAt: "2026-04-25T17:48:03.000Z"
        },
        currentActivity: null,
        runtime: {
          respondedAt: "2026-04-25T17:48:03.000Z",
          degradedByQuotaFallback: false,
          quotaFallbackReason: null,
          quotaFallbackModel: null
        },
        error: null
      });

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("older turn");
      });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.messages.map((message) => message.id)).toEqual([
          "server-user-1",
          "server-assistant-1"
        ]);
      });
      expect(observedSignal?.aborted).toBe(true);
      expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalled();
      expect(result.current.messages.map((message) => message.content)).toEqual([
        "older turn",
        "Recovered from turn status."
      ]);
    });
  });

  describe("stream continuity regression suite (live-id scoping)", () => {
    // The bug: ActiveTurnSnapshot.messages was used both as visible thread
    // state AND as the canonical id-set of the live turn. After a thread
    // switch / loadHistory, snapshot.messages got merged with older
    // committed history, so the id-set check
    //   "does committed history already contain the active turn's result?"
    //   "does loaded contain an active-snapshot user with assistant after?"
    // became true for stale older turns and tore the live stream down.
    // These tests pin the live-turn id-scoping behaviour so the live bubble
    // survives switch A→B→A, and the loadHistory pollution does not kill
    // the active stream.
    //
    // History fixtures are chatId/cursor-keyed (not mockResolvedValueOnce
    // queues). Under full parallel Vitest load, soft-detach/resume refreshes
    // and late in-flight gets from prior tests can call getChatMessages
    // out of order; Once chains then hand Chat B rows to Chat A (and vice
    // versa). Keyed mocks stay idempotent for duplicate fetches.

    type ContinuityHistoryMessage = {
      id: string;
      chatId: string;
      assistantId: string;
      author: "user" | "assistant";
      content: string;
      attachments: unknown[];
      createdAt: string;
    };
    type ContinuityHistoryPage = {
      nextCursor: string | null;
      messages: ContinuityHistoryMessage[];
    };

    function mockContinuityChatMessages(input: {
      byChatId: Record<string, ContinuityHistoryPage>;
      byChatIdAndCursor?: Record<string, ContinuityHistoryPage>;
    }) {
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, chatId: string, cursor?: string | null) => {
          if (typeof cursor === "string" && cursor.length > 0) {
            const keyed = input.byChatIdAndCursor?.[`${chatId}::${cursor}`];
            if (keyed !== undefined) {
              return keyed;
            }
          }
          return (
            input.byChatId[chatId] ?? {
              nextCursor: null,
              messages: []
            }
          );
        }
      );
    }

    it("loadHistory while still streaming does NOT tear down a live turn whose user id matches an older committed user/assistant pair", async () => {
      let releaseStream: (() => void) | null = null;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "server-user-live", chatId: "chat-1", attachments: [] }
          });
          handlers.onDelta?.({ delta: "Live partial" });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );
      // Server's history endpoint returns OLDER committed history that
      // happens to contain BOTH:
      //   - an older user message (same id space, different content)
      //   - an older committed assistant after that user
      // and ALSO the live turn's user message at the tail with no
      // assistant yet (because the live turn is still streaming on the
      // server). Pre-fix, mergeCommittedHistoryWithActiveTurn would scan
      // the polluted snapshot.messages and conclude "an assistant follows
      // an active user" (the older one!) and replace the live turn.
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        messages: [
          {
            id: "server-user-old",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "older question",
            attachments: [],
            createdAt: "2026-04-25T17:40:35.000Z"
          },
          {
            id: "server-assistant-old",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Older answer.",
            attachments: [],
            createdAt: "2026-04-25T17:41:05.000Z"
          },
          {
            id: "server-user-live",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "live turn question",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          }
        ]
      });

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("live turn question");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });

      // Trigger the loadHistory that simulates a chat switch /
      // history refresh while the stream is still in-flight.
      await act(async () => {
        await result.current.loadHistory("chat-1");
      });

      // Live stream MUST still be in-flight, the live assistant bubble
      // MUST still be present, and the older committed history MUST be
      // visible above it.
      expect(result.current.isStreaming).toBe(true);
      const ids = result.current.messages.map((message) => message.id);
      expect(ids).toContain("server-user-old");
      expect(ids).toContain("server-assistant-old");
      expect(ids).toContain("server-user-live");
      // Live assistant bubble (still optimistic local id) must remain.
      expect(
        result.current.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.status === "streaming" &&
            message.id.startsWith("local-assistant-")
        )
      ).toBe(true);

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("switch A → B → A while a long Chat A turn is streaming preserves the live bubble in Chat A", async () => {
      let releaseStream: (() => void) | null = null;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A", chatId: "chat-A", attachments: [] }
          });
          handlers.onDelta?.({ delta: "Chat A partial " });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );
      // History fetches: chat-B (when switching), then chat-A again
      // (when switching back). chat-A's history at this moment shows the
      // user message we just sent but NO assistant yet (turn still
      // running on the server).
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-B",
              chatId: "chat-B",
              assistantId: "assistant-1",
              author: "user",
              content: "other chat",
              attachments: [],
              createdAt: "2026-04-25T17:50:00.000Z"
            },
            {
              id: "server-assistant-B",
              chatId: "chat-B",
              assistantId: "assistant-1",
              author: "assistant",
              content: "Other answer.",
              attachments: [],
              createdAt: "2026-04-25T17:50:05.000Z"
            }
          ]
        })
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-A",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "long question",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
            }
          ]
        });

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("long question");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
        expect(result.current.chatId).toBe("chat-A");
      });

      // Switch to thread-B and load its history.
      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      expect(result.current.chatId).toBe("chat-B");

      // Switch back to thread-A while stream is still in-flight, then
      // load history for chat-A. Pre-fix this would show only old
      // committed history or wipe the bubble.
      rerender({ threadKey: "thread-A" });
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });

      // The live assistant bubble MUST still be visible. (Content
      // depends on RAF flushing which is mocked in this suite, so we
      // only assert that the streaming placeholder for the live turn
      // survived the switch.)
      const liveAssistant = result.current.messages.find(
        (message) => message.role === "assistant" && message.status === "streaming"
      );
      expect(liveAssistant).toBeDefined();
      expect(result.current.isStreaming).toBe(true);
      // The user message of the live turn must also still be there.
      expect(result.current.messages.some((message) => message.id === "server-user-A")).toBe(true);

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("background-completed turn removes a phantom empty streaming assistant placeholder above the committed answer", async () => {
      // Simulate the residue state: messages contains an OLD streaming
      // assistant placeholder (empty content) AND a NEWER committed
      // assistant below it. The phantom should be hidden from entries.
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] }
          });
          handlers.onCompleted?.({
            transport: {
              userMessage: {
                id: "server-user-1",
                chatId: "chat-1",
                attachments: []
              },
              assistantMessage: {
                id: "server-assistant-1",
                content: "Final answer.",
                attachments: []
              },
              runtime: null
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("ask");
      });

      // The chat entries should NOT contain a stale streaming-empty
      // assistant placeholder. The only assistant entry should be the
      // committed final answer.
      const assistantEntries = result.current.entries.filter(
        (entry) => entry.kind === "message" && entry.message.role === "assistant"
      );
      expect(assistantEntries).toHaveLength(1);
      const assistantEntry = assistantEntries[0];
      if (assistantEntry?.kind !== "message") {
        throw new Error("expected message entry");
      }
      expect(assistantEntry.message.content).toBe("Final answer.");
      expect(assistantEntry.message.status).toBe("committed");
    });

    it("hides a phantom empty streaming assistant when a newer assistant exists below it", async () => {
      // Direct unit-style: render two assistant messages where the older
      // is streaming-empty and the newer is committed. The entries
      // pipeline must drop the older phantom.
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-1" },
            userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] }
          });
          handlers.onCompleted?.({
            transport: {
              userMessage: { id: "server-user-1", chatId: "chat-1", attachments: [] },
              assistantMessage: {
                id: "server-assistant-1",
                content: "Done.",
                attachments: []
              },
              runtime: null
            }
          });
        }
      );
      // History returns an extra phantom streaming-empty assistant
      // injected as a leftover from a prior pod's projection.
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        activeTurn: null,
        messages: [
          {
            id: "server-user-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "ask",
            attachments: [],
            createdAt: "2026-04-25T17:45:35.000Z"
          },
          {
            id: "server-assistant-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Done.",
            attachments: [],
            createdAt: "2026-04-25T17:48:03.000Z"
          }
        ]
      });

      const { result } = renderHook(() => useChat("thread-1"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("ask");
      });
      await act(async () => {
        await result.current.loadHistory("chat-1");
      });

      // No streaming-empty assistant should be present in entries.
      const streamingEmptyAssistantInEntries = result.current.entries.some(
        (entry) =>
          entry.kind === "message" &&
          entry.message.role === "assistant" &&
          entry.message.status === "streaming" &&
          entry.message.content.trim().length === 0
      );
      expect(streamingEmptyAssistantInEntries).toBe(false);
    });

    it("switch A → B → A while streaming preserves OLDER committed history above the live turn (no 2-message flash)", async () => {
      // The user-reported live repro: in chat A there is older committed
      // history (a prior question + answer). User asks a NEW question that
      // triggers a long stream, then switches to chat B and back. Pre-fix,
      // the synchronous prevThreadKeyRef restore set visible state to JUST
      // `liveSnapshot.messages` (only the live user + live assistant 2-msg
      // window), so older history above the live turn briefly disappeared
      // — and any later state mutation (focus, soft-detach reattach,
      // failed loadHistory) left the user staring at a chat where their
      // own bubble + older context vanished.
      let releaseStream: (() => void) | null = null;
      let chatAIncludesLiveUser = false;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A-live", chatId: "chat-A", attachments: [] }
          });
          chatAIncludesLiveUser = true;
          handlers.onDelta?.({ delta: "Streaming long answer..." });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );
      const chatAOlder: ContinuityHistoryMessage[] = [
        {
          id: "server-user-A-old",
          chatId: "chat-A",
          assistantId: "assistant-1",
          author: "user",
          content: "а нужно ли это?",
          attachments: [],
          createdAt: "2026-04-25T17:00:00.000Z"
        },
        {
          id: "server-assistant-A-old",
          chatId: "chat-A",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Не всегда.",
          attachments: [],
          createdAt: "2026-04-25T17:00:05.000Z"
        }
      ];
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, chatId: string) => {
          if (chatId === "chat-B") {
            return {
              nextCursor: null,
              messages: [
                {
                  id: "server-user-B",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "B",
                  attachments: [],
                  createdAt: "2026-04-25T17:05:00.000Z"
                }
              ]
            };
          }
          if (chatId === "chat-A") {
            return {
              nextCursor: null,
              messages: chatAIncludesLiveUser
                ? [
                    ...chatAOlder,
                    {
                      id: "server-user-A-live",
                      chatId: "chat-A",
                      assistantId: "assistant-1",
                      author: "user" as const,
                      content: "Длинный ответ",
                      attachments: [],
                      createdAt: "2026-04-25T17:10:00.000Z"
                    }
                  ]
                : chatAOlder
            };
          }
          return { nextCursor: null, messages: [] };
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      // Load chat-A's older history first.
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      expect(result.current.messages.map((m) => m.id)).toEqual([
        "server-user-A-old",
        "server-assistant-A-old"
      ]);

      // Send the long-stream question.
      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("Длинный ответ");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });
      // Visible after send must include older + live pair.
      expect(result.current.messages.map((m) => m.id)).toEqual([
        "server-user-A-old",
        "server-assistant-A-old",
        "server-user-A-live",
        expect.stringMatching(/^local-assistant-/)
      ]);

      // Switch to thread-B (loads chat-B's history).
      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      expect(result.current.messages.map((m) => m.id)).toEqual(["server-user-B"]);

      // Switch back to thread-A. The synchronous restore in
      // prevThreadKeyRef MUST present the FULL state immediately
      // (older + live pair), not just the 2-msg live window.
      rerender({ threadKey: "thread-A" });
      const afterRestoreIds = result.current.messages.map((m) => m.id);
      expect(afterRestoreIds).toContain("server-user-A-old");
      expect(afterRestoreIds).toContain("server-assistant-A-old");
      expect(afterRestoreIds).toContain("server-user-A-live");
      expect(
        afterRestoreIds.some((id) => typeof id === "string" && id.startsWith("local-assistant-"))
      ).toBe(true);

      // Now run the post-render loadHistory the page effect would
      // dispatch. Older history + live pair MUST persist.
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      const afterReloadIds = result.current.messages.map((m) => m.id);
      expect(afterReloadIds).toContain("server-user-A-old");
      expect(afterReloadIds).toContain("server-assistant-A-old");
      expect(afterReloadIds).toContain("server-user-A-live");
      const liveAssistant = result.current.messages.find(
        (m) => m.role === "assistant" && m.status === "streaming"
      );
      expect(liveAssistant).toBeDefined();
      expect(result.current.isStreaming).toBe(true);

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("double swap A→B→A→B→A while streaming preserves older history AND the live assistant content (no 'Думаю...' regression)", async () => {
      // The user-reported second symptom: on a SECOND swap while the long
      // stream is still in flight, the live assistant content disappears
      // and a phantom 'Думаю...' (empty streaming bubble) appears. This
      // happens when ANY code path replaces the visible state with just
      // [user, liveAssistantMessage] using a fallback empty assistant
      // (e.g. applyTurnStatusState running, or the prevThreadKeyRef
      // synchronous restore not pre-merging cached history).
      let releaseStream: (() => void) | null = null;
      let onDeltaRef: ((payload: { delta: string }) => void) | null = null;
      let chatAIncludesLiveUser = false;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A-live", chatId: "chat-A", attachments: [] }
          });
          chatAIncludesLiveUser = true;
          onDeltaRef = handlers.onDelta ?? null;
          handlers.onDelta?.({ delta: "First chunk. " });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );
      const chatAOlder: ContinuityHistoryMessage[] = [
        {
          id: "server-user-A-old",
          chatId: "chat-A",
          assistantId: "assistant-1",
          author: "user",
          content: "Q1",
          attachments: [],
          createdAt: "2026-04-25T17:00:00.000Z"
        },
        {
          id: "server-assistant-A-old",
          chatId: "chat-A",
          assistantId: "assistant-1",
          author: "assistant",
          content: "A1",
          attachments: [],
          createdAt: "2026-04-25T17:00:05.000Z"
        }
      ];
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, chatId: string) => {
          if (chatId === "chat-B") {
            return {
              nextCursor: null,
              messages: [
                {
                  id: "server-user-B",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "B",
                  attachments: [],
                  createdAt: "2026-04-25T17:05:00.000Z"
                }
              ]
            };
          }
          if (chatId === "chat-A") {
            return {
              nextCursor: null,
              messages: chatAIncludesLiveUser
                ? [
                    ...chatAOlder,
                    {
                      id: "server-user-A-live",
                      chatId: "chat-A",
                      assistantId: "assistant-1",
                      author: "user" as const,
                      content: "Long Q",
                      attachments: [],
                      createdAt: "2026-04-25T17:10:00.000Z"
                    }
                  ]
                : chatAOlder
            };
          }
          return { nextCursor: null, messages: [] };
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("Long Q");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });

      // Swap A→B→A
      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      rerender({ threadKey: "thread-A" });
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      // Confirm older history + live pair are present after first swap-back.
      let ids = result.current.messages.map((m) => m.id);
      expect(ids).toContain("server-user-A-old");
      expect(ids).toContain("server-assistant-A-old");
      expect(ids).toContain("server-user-A-live");

      // Stream another delta to grow the live assistant content.
      await act(async () => {
        onDeltaRef?.({ delta: "Second chunk." });
        await Promise.resolve();
      });

      // Swap A→B→A AGAIN (the founder's "повторный свап").
      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      rerender({ threadKey: "thread-A" });
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });

      // After SECOND swap-back: older history + live pair MUST still be
      // present. The live assistant MUST still be the streaming bubble
      // (not a stale phantom that lost its content).
      ids = result.current.messages.map((m) => m.id);
      expect(ids).toContain("server-user-A-old");
      expect(ids).toContain("server-assistant-A-old");
      expect(ids).toContain("server-user-A-live");
      const liveAssistant = result.current.messages.find(
        (m) => m.role === "assistant" && m.status === "streaming"
      );
      expect(liveAssistant).toBeDefined();
      expect(result.current.isStreaming).toBe(true);
      // At most ONE streaming assistant survives in the entries pipeline
      // (the live one). PRE-FIX a stale `[user, liveAssistantMessage]`
      // collapse could leave a 2nd empty placeholder above the real one.
      const streamingAssistantsInEntries = result.current.entries.filter(
        (entry) =>
          entry.kind === "message" &&
          entry.message.role === "assistant" &&
          entry.message.status === "streaming"
      );
      expect(streamingAssistantsInEntries.length).toBeLessThanOrEqual(1);

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("swap A→B→A does NOT produce a duplicate user bubble when cached history was written between send() and onStarted (optimistic local-user-* leak)", async () => {
      // Founder live-repro: after the previous chat-swap fix landed,
      // a phantom second user bubble appeared next to the real one in
      // the live chat after a swap. Root cause: cached history could
      // be written DURING the optimistic window of `send()` (e.g. a
      // `loadHistory` that ran between send() and onStarted), so the
      // cache snapshot stored the `local-user-*` id; later
      // `onStarted` remapped the snapshot's id to `server-user-*`,
      // and on swap-back the restore merged BOTH the cached
      // `local-user-*` and the snapshot's canonical `server-user-*`
      // side by side — same content, different ids, two bubbles.
      let resolveStartedGate: (() => void) | null = null;
      const startedGate = new Promise<void>((resolve) => {
        resolveStartedGate = resolve;
      });
      let releaseStream: (() => void) | null = null;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          // Hold off on onStarted until the test explicitly releases
          // the gate, so we can simulate a `loadHistory` running
          // BEFORE the optimistic local-user id has been remapped.
          await startedGate;
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A-live", chatId: "chat-A", attachments: [] }
          });
          handlers.onDelta?.({ delta: "Streaming..." });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "Q1",
              attachments: [],
              createdAt: "2026-04-25T17:00:00.000Z"
            },
            {
              id: "server-assistant-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "assistant",
              content: "A1",
              attachments: [],
              createdAt: "2026-04-25T17:00:05.000Z"
            }
          ]
        })
        .mockResolvedValueOnce({
          nextCursor: null,
          activeTurn: null,
          messages: [
            // Server doesn't yet have the live user message persisted
            // because onStarted hasn't fired. The cache write that
            // happens at this loadHistory's tail will therefore
            // include the snapshot's optimistic `local-user-*` id.
            {
              id: "server-user-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "Q1",
              attachments: [],
              createdAt: "2026-04-25T17:00:00.000Z"
            },
            {
              id: "server-assistant-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "assistant",
              content: "A1",
              attachments: [],
              createdAt: "2026-04-25T17:00:05.000Z"
            }
          ]
        })
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-B",
              chatId: "chat-B",
              assistantId: "assistant-1",
              author: "user",
              content: "B",
              attachments: [],
              createdAt: "2026-04-25T17:05:00.000Z"
            }
          ]
        })
        .mockResolvedValueOnce({
          nextCursor: null,
          activeTurn: null,
          messages: [
            {
              id: "server-user-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "Q1",
              attachments: [],
              createdAt: "2026-04-25T17:00:00.000Z"
            },
            {
              id: "server-assistant-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "assistant",
              content: "A1",
              attachments: [],
              createdAt: "2026-04-25T17:00:05.000Z"
            },
            // Live user is now persisted server-side.
            {
              id: "server-user-A-live",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "long Q",
              attachments: [],
              createdAt: "2026-04-25T17:10:00.000Z"
            }
          ]
        });

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("long Q");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });
      // While the optimistic local-user is still in snapshot (gate not
      // released), simulate a `loadHistory` running mid-flight (e.g.
      // page effect re-fired). This will write the cache with the
      // optimistic local-user snapshot included.
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      // NOW release onStarted so the snapshot remaps the user id from
      // the optimistic local id to the canonical server id.
      await act(async () => {
        resolveStartedGate?.();
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => {
        const ids = result.current.messages.map((m) => m.id);
        return expect(ids).toContain("server-user-A-live");
      });

      // Swap A → B → A.
      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      rerender({ threadKey: "thread-A" });
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });

      // The user bubble for the live turn must appear EXACTLY ONCE.
      // Pre-fix the cached `local-user-*` and the snapshot's
      // `server-user-A-live` would both render.
      const userMessages = result.current.messages.filter((m) => m.role === "user");
      const liveUserBubbles = userMessages.filter(
        (m) => m.id === "server-user-A-live" || m.id.startsWith("local-user-")
      );
      expect(liveUserBubbles.length).toBe(1);
      // And it should be the canonical server-mapped id.
      expect(liveUserBubbles[0]?.id).toBe("server-user-A-live");

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("history refresh drops non-live messages that leaked into the active snapshot but disappeared from authoritative history", async () => {
      let releaseStream: (() => void) | null = null;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A-live", chatId: "chat-A", attachments: [] }
          });
          handlers.onDelta?.({ delta: "live partial" });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );

      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "old question",
              attachments: [],
              createdAt: "2026-04-25T17:00:00.000Z"
            }
          ]
        })
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "old question",
              attachments: [],
              createdAt: "2026-04-25T17:00:00.000Z"
            },
            {
              id: "server-user-A-stale",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "stale user that must not survive the next authoritative refresh",
              attachments: [],
              createdAt: "2026-04-25T17:00:05.000Z"
            },
            {
              id: "server-assistant-A-stray",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "assistant",
              content: "stray assistant tail from a different visible window",
              attachments: [],
              createdAt: "2026-04-25T17:00:06.000Z"
            }
          ]
        })
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
            {
              id: "server-user-A-old",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "old question",
              attachments: [],
              createdAt: "2026-04-25T17:00:00.000Z"
            }
          ]
        });

      const { result } = renderHook(() => useChat("thread-A"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-A");
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("live question");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.messages.map((m) => m.id)).toContain("server-user-A-live");
      });

      // First refresh pollutes the active snapshot with non-live messages.
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      expect(result.current.messages.map((m) => m.id)).toContain("server-user-A-stale");
      expect(result.current.messages.map((m) => m.id)).toContain("server-assistant-A-stray");

      // Next authoritative refresh no longer contains those messages. Pre-fix,
      // mergeCommittedHistoryWithActiveTurn kept it from snapshot.messages
      // because it was a non-cached id, so it could later reappear beside the
      // live assistant during chat swaps. It must now be purged.
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      expect(result.current.messages.map((m) => m.id)).not.toContain("server-user-A-stale");
      expect(result.current.messages.map((m) => m.id)).not.toContain("server-assistant-A-stray");
      expect(result.current.messages.map((m) => m.id)).toContain("server-user-A-live");

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("soft-detach reattach (running status) PRESERVES older committed history above the live turn", async () => {
      // Internal-fix regression test: when applyTurnStatusState is
      // invoked with a running status (the path softDetachReconcile +
      // startTurnReattach take after a passive SSE disconnect), it MUST
      // NOT collapse the visible state down to
      // [userMessage, liveAssistantMessage]. Older committed history
      // above the live turn must remain.
      let capturedClientTurnId: string | null = null;
      let streamCallCount = 0;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { clientTurnId?: string },
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          streamCallCount += 1;
          capturedClientTurnId = payload.clientTurnId ?? null;
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A-live", chatId: "chat-A", attachments: [] }
          });
          handlers.onDelta?.({ delta: "Partial." });
          // Simulate passive SSE disconnect (e.g. tab backgrounded /
          // proxy hung up) AFTER onStarted. The hook will mark the
          // turn as soft-detached and start the reattach reconcile.
          throw new Error("Stream closed before terminal event.");
        }
      );
      assistantApiMocks.getChatMessages.mockResolvedValueOnce({
        nextCursor: null,
        messages: [
          {
            id: "server-user-A-old",
            chatId: "chat-A",
            assistantId: "assistant-1",
            author: "user",
            content: "Q1",
            attachments: [],
            createdAt: "2026-04-25T17:00:00.000Z"
          },
          {
            id: "server-assistant-A-old",
            chatId: "chat-A",
            assistantId: "assistant-1",
            author: "assistant",
            content: "A1",
            attachments: [],
            createdAt: "2026-04-25T17:00:05.000Z"
          }
        ]
      });
      // refreshLatestHistory inside softDetachReconcile fetches: server
      // has the live user persisted but assistant is still in flight.
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        messages: [
          {
            id: "server-user-A-old",
            chatId: "chat-A",
            assistantId: "assistant-1",
            author: "user",
            content: "Q1",
            attachments: [],
            createdAt: "2026-04-25T17:00:00.000Z"
          },
          {
            id: "server-assistant-A-old",
            chatId: "chat-A",
            assistantId: "assistant-1",
            author: "assistant",
            content: "A1",
            attachments: [],
            createdAt: "2026-04-25T17:00:05.000Z"
          },
          {
            id: "server-user-A-live",
            chatId: "chat-A",
            assistantId: "assistant-1",
            author: "user",
            content: "Long Q",
            attachments: [],
            createdAt: "2026-04-25T17:10:00.000Z"
          }
        ]
      });
      // Server's GET /turns/{id} returns running status with no fresh
      // assistantMessage payload (still in flight). Reattach stream
      // mock throws so we exercise the status-only path.
      assistantApiMocks.getAssistantWebChatTurnStatus.mockImplementation(async () => ({
        clientTurnId: capturedClientTurnId ?? "unknown",
        status: "running",
        chat: { id: "chat-A" },
        userMessage: {
          id: "server-user-A-live",
          chatId: "chat-A",
          assistantId: "assistant-1",
          author: "user",
          content: "Long Q",
          attachments: [],
          createdAt: "2026-04-25T17:10:00.000Z"
        },
        assistantMessage: null,
        currentActivity: null,
        runtime: null
      }));
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementation(async () => {
        throw new Error("Stream closed before terminal event.");
      });

      const { result } = renderHook(() => useChat("thread-A"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      await act(async () => {
        void result.current.send("Long Q");
        await Promise.resolve();
        await Promise.resolve();
      });
      // The send() promise above is fire-and-forget; let the catch
      // handler run and mark the turn soft-detached.
      await waitFor(() => {
        expect(streamCallCount).toBeGreaterThanOrEqual(1);
      });
      // Pre-condition: visible state contains older + live pair.
      const idsBefore = result.current.messages.map((m) => m.id);
      expect(idsBefore).toContain("server-user-A-old");
      expect(idsBefore).toContain("server-assistant-A-old");
      expect(idsBefore).toContain("server-user-A-live");

      // Drive the soft-detach reconcile loop manually by yielding a few
      // microtasks so refreshLatestHistory + refreshTurnStatus run.
      await act(async () => {
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });

      // POST-FIX: visible state STILL contains older history AND live
      // pair after applyTurnStatusState running fired. PRE-FIX: it
      // would have collapsed to [server-user-A-live, liveAssistant].
      const idsAfter = result.current.messages.map((m) => m.id);
      expect(idsAfter).toContain("server-user-A-old");
      expect(idsAfter).toContain("server-assistant-A-old");
      expect(idsAfter).toContain("server-user-A-live");
      const liveAssistant = result.current.messages.find(
        (m) => m.role === "assistant" && m.status === "streaming"
      );
      expect(liveAssistant).toBeDefined();
    });

    /*
     * Founder live-repro caught via CDP-attached browser:
     *
     *   user:  "Напиши длинный спич для теста еще раз"   ← real send
     *   user:  "когда openai научиться..."               ← PHANTOM
     *   asst:  "Окей, держи ещё один длинный спич..."   ← live answer
     *
     * The phantom user was the FIRST user message of the chat, which
     * had been loaded earlier via `loadOlderMessages` and was visible
     * on screen but is NOT part of the latest paginated `getChatMessages`
     * window (cursor pagination → server only returns the most-recent
     * 20). After a chat-swap it re-appeared right before the live
     * assistant and disappeared on F5 (which rebuilt cache from
     * authoritative paginated server history).
     *
     * Root cause (pt 4 outgoing-sync regression, fixed in pt 5):
     * the swap-OUT outgoing-sync wrote the FULL visible array into
     * `activeTurnSnapshotsRef.current.get(outgoingThreadKey).messages`.
     * That array therefore carried every visible id including the
     * older messages that the paginated cache no longer contains. On
     * swap-back the restore merge —
     * `mergeChatMessagesById(cachedBase, liveSnapshot.messages
     *  .filter((m) => !cachedIds.has(m.id) || liveTurnIds.has(m.id)))` —
     * saw the snapshot ids that were NOT in the paginated cache and
     * APPENDED them at the END of the merged result.
     *
     * The fix is to redirect the outgoing-sync to write into
     * `cachedThreadHistorySnapshotsRef` (the cache map) instead of
     * into the snapshot, so `snapshot.messages` stays minimal (live
     * pair only) and the swap-back filter has nothing stale to
     * resurrect.
     */
    it("swap A→B→A does NOT resurrect an older message at the END of the merged thread when cache is paginated and visible included loadOlderMessages results (pt-3 outgoing-sync regression)", async () => {
      let releaseStream: (() => void) | null = null;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onDelta?: (payload: { delta: string }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-A" },
            userMessage: { id: "server-user-A-live", chatId: "chat-A", attachments: [] }
          });
          handlers.onDelta?.({ delta: "live partial" });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );

      // Initial loadHistory(chat-A): paginated window with a
      // non-null cursor (older messages exist on the server beyond
      // the cap). Returns the LATEST window only.
      mockContinuityChatMessages({
        byChatId: {
          "chat-A": {
            nextCursor: "older-cursor",
            messages: [
              {
                id: "server-user-A-1",
                chatId: "chat-A",
                assistantId: "assistant-1",
                author: "user",
                content: "Q1 (visible)",
                attachments: [],
                createdAt: "2026-04-25T10:00:10.000Z"
              },
              {
                id: "server-asst-A-1",
                chatId: "chat-A",
                assistantId: "assistant-1",
                author: "assistant",
                content: "A1 (visible)",
                attachments: [],
                createdAt: "2026-04-25T10:00:15.000Z"
              }
            ]
          },
          "chat-B": {
            nextCursor: null,
            messages: [
              {
                id: "server-user-B",
                chatId: "chat-B",
                assistantId: "assistant-1",
                author: "user",
                content: "B msg",
                attachments: [],
                createdAt: "2026-04-25T10:01:00.000Z"
              }
            ]
          }
        },
        byChatIdAndCursor: {
          "chat-A::older-cursor": {
            nextCursor: null,
            messages: [
              {
                id: "server-user-A-OFFSCREEN",
                chatId: "chat-A",
                assistantId: "assistant-1",
                author: "user",
                content: "Q0 (older)",
                attachments: [],
                createdAt: "2026-04-25T10:00:00.000Z"
              }
            ]
          }
        }
      });

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );
      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      // Founder scrolls up to see older history. `loadOlderMessages`
      // calls `setMessages` only — it does NOT update cache or
      // snapshot. After this, visible = [server-user-A-OFFSCREEN,
      // server-user-A-1, server-asst-A-1] but cache still = [...
      // latest 2 only].
      await act(async () => {
        await result.current.loadOlderMessages();
      });
      const idsAfterScroll = result.current.messages.map((m) => m.id);
      expect(idsAfterScroll).toEqual([
        "server-user-A-OFFSCREEN",
        "server-user-A-1",
        "server-asst-A-1"
      ]);

      // Send the live turn.
      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("Live Q (very long)");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });
      const idsAfterSend = result.current.messages.map((m) => m.id);
      expect(idsAfterSend[0]).toBe("server-user-A-OFFSCREEN");

      // Swap A → B → A while the long answer is still streaming.
      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      rerender({ threadKey: "thread-A" });

      // POST-FIX: `server-user-A-OFFSCREEN` must remain in its
      // CORRECT position (top of the chat) and must NOT be
      // duplicated AT THE END of the merged window after the live
      // assistant. PRE-FIX it appeared TWICE: once at top
      // (preserved by the swap-out → cache sync, which now
      // includes the loadOlderMessages results), once at the END
      // (because snapshot.A.messages was polluted with full visible
      // by the old outgoing-sync, and the swap-back merge appended
      // the snapshot id that was not in the paginated cache).
      const ids = result.current.messages.map((m) => m.id);
      const offScreenOccurrences = ids.filter((id) => id === "server-user-A-OFFSCREEN").length;
      expect(offScreenOccurrences).toBe(1);
      const liveUserIndex = ids.indexOf("server-user-A-live");
      const offScreenIndex = ids.indexOf("server-user-A-OFFSCREEN");
      // The off-screen user must be ABOVE the live user (top of
      // chat), not below / next to the live assistant.
      expect(offScreenIndex).toBeLessThan(liveUserIndex);

      await act(async () => {
        releaseStream?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("late loadHistory for a left chat does not clobber the visible thread messages or chatId", async () => {
      let releaseChatA: ((page: ContinuityHistoryPage) => void) | null = null;
      const chatAGate = new Promise<ContinuityHistoryPage>((resolve) => {
        releaseChatA = resolve;
      });
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, chatId: string) => {
          if (chatId === "chat-A") {
            return chatAGate;
          }
          if (chatId === "chat-B") {
            return {
              nextCursor: null,
              messages: [
                {
                  id: "server-user-B",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "B only",
                  attachments: [],
                  createdAt: "2026-04-25T17:05:00.000Z"
                }
              ]
            };
          }
          return { nextCursor: null, messages: [] };
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      let loadAPromise: Promise<void> | undefined;
      await act(async () => {
        loadAPromise = result.current.loadHistory("chat-A");
        await Promise.resolve();
      });

      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      expect(result.current.messages.map((m) => m.id)).toEqual(["server-user-B"]);
      expect(result.current.chatId).toBe("chat-B");

      await act(async () => {
        releaseChatA?.({
          nextCursor: null,
          messages: [
            {
              id: "server-user-A-late",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "Must not clobber B",
              attachments: [],
              createdAt: "2026-04-25T17:00:00.000Z"
            }
          ]
        });
        if (loadAPromise !== undefined) {
          await loadAPromise;
        }
      });

      expect(result.current.chatId).toBe("chat-B");
      expect(result.current.messages.map((m) => m.id)).toEqual(["server-user-B"]);
      expect(result.current.messages.map((m) => m.id)).not.toContain("server-user-A-late");
    });

    it("stale in-flight loadOlderMessages for A after switch to B releases loading and does not mutate B (B can paginate)", async () => {
      let releaseOlderA: ((page: ContinuityHistoryPage) => void) | null = null;
      const olderAGate = new Promise<ContinuityHistoryPage>((resolve) => {
        releaseOlderA = resolve;
      });
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, chatId: string, cursor?: string | null) => {
          if (chatId === "chat-A") {
            if (typeof cursor === "string" && cursor === "older-cursor-A") {
              return olderAGate;
            }
            return {
              nextCursor: "older-cursor-A",
              messages: [
                {
                  id: "server-user-A-1",
                  chatId: "chat-A",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "A latest",
                  attachments: [],
                  createdAt: "2026-04-25T10:00:10.000Z"
                }
              ]
            };
          }
          if (chatId === "chat-B") {
            if (typeof cursor === "string" && cursor === "older-cursor-B") {
              return {
                nextCursor: null,
                messages: [
                  {
                    id: "server-user-B-OFFSCREEN",
                    chatId: "chat-B",
                    assistantId: "assistant-1",
                    author: "user",
                    content: "B older",
                    attachments: [],
                    createdAt: "2026-04-25T10:01:00.000Z"
                  }
                ]
              };
            }
            return {
              nextCursor: "older-cursor-B",
              messages: [
                {
                  id: "server-user-B-1",
                  chatId: "chat-B",
                  assistantId: "assistant-1",
                  author: "user",
                  content: "B latest",
                  attachments: [],
                  createdAt: "2026-04-25T10:01:10.000Z"
                }
              ]
            };
          }
          return { nextCursor: null, messages: [] };
        }
      );

      const { result, rerender } = renderHook(
        ({ threadKey }: { threadKey: string }) => useChat(threadKey),
        {
          wrapper: ({ children }) => (
            <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
          ),
          initialProps: { threadKey: "thread-A" }
        }
      );

      await act(async () => {
        await result.current.loadHistory("chat-A");
      });
      expect(result.current.hasOlderMessages).toBe(true);
      expect(result.current.messages.map((m) => m.id)).toEqual(["server-user-A-1"]);

      let olderAPromise: Promise<void> | undefined;
      await act(async () => {
        olderAPromise = result.current.loadOlderMessages();
        await Promise.resolve();
      });
      expect(result.current.olderMessagesLoading).toBe(true);

      rerender({ threadKey: "thread-B" });
      await act(async () => {
        await result.current.loadHistory("chat-B");
      });
      expect(result.current.messages.map((m) => m.id)).toEqual(["server-user-B-1"]);
      expect(result.current.chatId).toBe("chat-B");
      expect(result.current.hasOlderMessages).toBe(true);

      await act(async () => {
        releaseOlderA?.({
          nextCursor: null,
          messages: [
            {
              id: "server-user-A-OFFSCREEN",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "Must not prepend onto B",
              attachments: [],
              createdAt: "2026-04-25T10:00:00.000Z"
            }
          ]
        });
        if (olderAPromise !== undefined) {
          await olderAPromise;
        }
      });

      expect(result.current.olderMessagesLoading).toBe(false);
      expect(result.current.chatId).toBe("chat-B");
      expect(result.current.messages.map((m) => m.id)).toEqual(["server-user-B-1"]);
      expect(result.current.messages.map((m) => m.id)).not.toContain("server-user-A-OFFSCREEN");

      await act(async () => {
        await result.current.loadOlderMessages();
      });
      expect(result.current.olderMessagesLoading).toBe(false);
      expect(result.current.messages.map((m) => m.id)).toEqual([
        "server-user-B-OFFSCREEN",
        "server-user-B-1"
      ]);
      expect(result.current.hasOlderMessages).toBe(false);
    });
  });

  describe("currentEngagement from turn completion", () => {
    it("sets and clears currentEngagement from SSE engagementSummary on the visible thread", async () => {
      assistantApiMocks.streamAssistantWebChatTurn
        .mockImplementationOnce(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onCompleted?: (payload: { transport: unknown }) => void;
            }
          ) => {
            handlers.onCompleted?.({
              transport: {
                assistantMessage: { id: "assistant-engage-1", content: "Engaged." },
                engagementSummary: {
                  skillDisplayName: "Маркетолог",
                  scenarioDisplayName: "Instagram-карусель"
                }
              }
            });
          }
        )
        .mockImplementationOnce(
          async (
            _token: string,
            _payload: unknown,
            handlers: {
              onCompleted?: (payload: { transport: unknown }) => void;
            }
          ) => {
            handlers.onCompleted?.({
              transport: {
                assistantMessage: { id: "assistant-release-1", content: "Released." },
                engagementSummary: null
              }
            });
          }
        );

      const { result } = renderHook(() => useChat("thread-engage"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("engage skill");
      });
      expect(result.current.currentEngagement).toEqual({
        skillDisplayName: "Маркетолог",
        scenarioDisplayName: "Instagram-карусель"
      });

      await act(async () => {
        await result.current.send("release skill");
      });
      expect(result.current.currentEngagement).toBeNull();
    });

    it("does not mutate visible engagement when a non-visible thread completes", async () => {
      let releaseBackground: (() => void) | null = null;
      assistantApiMocks.getChatMessages.mockImplementation(
        async (_token: string, chatId: string) => {
          if (chatId === "chat-visible") {
            return {
              messages: [],
              nextCursor: null,
              activeTurn: null,
              activeMediaJobs: [],
              activeDocumentJobs: [],
              currentEngagement: {
                skillDisplayName: "Visible skill",
                scenarioDisplayName: null
              }
            };
          }
          return {
            messages: [],
            nextCursor: null,
            activeTurn: null,
            activeMediaJobs: [],
            activeDocumentJobs: [],
            currentEngagement: null
          };
        }
      );
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-background" },
            userMessage: { id: "server-user-bg", chatId: "chat-background", attachments: [] }
          });
          await new Promise<void>((resolve) => {
            releaseBackground = () => {
              handlers.onCompleted?.({
                transport: {
                  userMessage: {
                    id: "server-user-bg",
                    chatId: "chat-background",
                    attachments: []
                  },
                  assistantMessage: {
                    id: "server-assistant-bg",
                    content: "Background done.",
                    attachments: []
                  },
                  engagementSummary: {
                    skillDisplayName: "Background skill",
                    scenarioDisplayName: "Should not leak"
                  }
                }
              });
              resolve();
            };
          });
        }
      );

      const { result, rerender } = renderHook(({ threadKey }) => useChat(threadKey), {
        initialProps: { threadKey: "thread-background" },
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("background turn");
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });

      rerender({ threadKey: "thread-visible" });
      await act(async () => {
        await result.current.loadHistory("chat-visible");
      });
      await waitFor(() => {
        expect(result.current.chatId).toBe("chat-visible");
        expect(result.current.currentEngagement).toEqual({
          skillDisplayName: "Visible skill",
          scenarioDisplayName: null
        });
      });

      await act(async () => {
        releaseBackground?.();
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });

      expect(result.current.chatId).toBe("chat-visible");
      expect(result.current.currentEngagement).toEqual({
        skillDisplayName: "Visible skill",
        scenarioDisplayName: null
      });
    });
  });

  describe("chat plan integration", () => {
    it("clears the previous chat plan and skill engagement on a thread switch", async () => {
      const planTodo = {
        id: "todo-reset-1",
        parentId: null,
        content: "Old chat task",
        status: "pending" as const
      };
      assistantApiMocks.getChatMessages.mockResolvedValueOnce({
        messages: [],
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: [],
        currentEngagement: {
          skillDisplayName: "Old skill",
          scenarioDisplayName: "Old scenario"
        }
      });
      assistantApiMocks.getAssistantWebChatPlan.mockResolvedValueOnce({
        requestId: "r-reset",
        chatId: "chat-old",
        todos: [planTodo],
        windowed: false,
        totalCount: 1
      });

      const { result, rerender } = renderHook(({ threadKey }) => useChat(threadKey), {
        initialProps: { threadKey: "thread-old" },
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-old");
      });
      await waitFor(() => {
        expect(result.current.chatPlan).toEqual([planTodo]);
        expect(result.current.currentEngagement).toEqual({
          skillDisplayName: "Old skill",
          scenarioDisplayName: "Old scenario"
        });
      });

      rerender({ threadKey: "thread-new" });

      expect(result.current.chatPlan).toEqual([]);
      expect(result.current.chatPlanTotalCount).toBe(0);
      expect(result.current.chatPlanWindowed).toBe(false);
      expect(result.current.currentEngagement).toBeNull();
    });

    it("ignores a late plan response from the chat that was left", async () => {
      let resolvePlan:
        | ((value: {
            requestId: string;
            chatId: string;
            todos: Array<{
              id: string;
              parentId: null;
              content: string;
              status: "pending";
            }>;
            windowed: boolean;
            totalCount: number;
          }) => void)
        | undefined;
      const latePlan = new Promise<{
        requestId: string;
        chatId: string;
        todos: Array<{
          id: string;
          parentId: null;
          content: string;
          status: "pending";
        }>;
        windowed: boolean;
        totalCount: number;
      }>((resolve) => {
        resolvePlan = resolve;
      });
      assistantApiMocks.getChatMessages.mockResolvedValueOnce({
        messages: [],
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: []
      });
      assistantApiMocks.getAssistantWebChatPlan.mockReturnValueOnce(latePlan);

      const { result, rerender } = renderHook(({ threadKey }) => useChat(threadKey), {
        initialProps: { threadKey: "thread-old" },
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-old");
      });
      rerender({ threadKey: "thread-new" });
      await act(async () => {
        resolvePlan?.({
          requestId: "late",
          chatId: "chat-old",
          todos: [
            {
              id: "late-todo",
              parentId: null,
              content: "Must not leak",
              status: "pending"
            }
          ],
          windowed: false,
          totalCount: 1
        });
        await latePlan;
      });

      expect(result.current.chatPlan).toEqual([]);
      expect(result.current.chatPlanTotalCount).toBe(0);
    });

    it("fetches the plan when loadHistory resolves", async () => {
      const planTodo = {
        id: "todo-lh-1",
        parentId: null,
        content: "Do something",
        status: "pending" as const
      };
      assistantApiMocks.getChatMessages.mockResolvedValueOnce({
        messages: [],
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: []
      });
      assistantApiMocks.getAssistantWebChatPlan.mockResolvedValueOnce({
        requestId: "r1",
        chatId: "chat-plan-lh",
        todos: [planTodo],
        windowed: false,
        totalCount: 1
      });

      const { result } = renderHook(() => useChat("thread-plan-lh"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-plan-lh");
      });

      await waitFor(() => {
        expect(assistantApiMocks.getAssistantWebChatPlan).toHaveBeenCalledWith(
          "token-1",
          "chat-plan-lh"
        );
        expect(result.current.chatPlan).toEqual([planTodo]);
        expect(result.current.chatPlanTotalCount).toBe(1);
      });
    });

    it("calls getAssistantWebChatPlan after SSE todo_write tool event", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementationOnce(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onTool?: (payload: {
              phase: "start" | "end";
              toolName: string;
              toolCallId: string;
              isError: boolean;
            }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onStarted?.({ chat: { id: "chat-tw-1" }, userMessage: { id: "u1" } });
          handlers.onTool?.({
            phase: "start",
            toolName: "todo_write",
            toolCallId: "tc-1",
            isError: false
          });
          handlers.onCompleted?.({ transport: null });
        }
      );

      const { result } = renderHook(() => useChat("thread-tw"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("Hello");
      });

      await waitFor(() => {
        expect(assistantApiMocks.getAssistantWebChatPlan).toHaveBeenCalled();
      });
    });

    it("refetches the plan after a terminal turn (onCompleted)", async () => {
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementationOnce(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onStarted?.({ chat: { id: "chat-term-1" }, userMessage: { id: "u1" } });
          handlers.onCompleted?.({ transport: null });
        }
      );

      const { result } = renderHook(() => useChat("thread-term"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.send("Hello");
      });

      await waitFor(() => {
        expect(assistantApiMocks.getAssistantWebChatPlan).toHaveBeenCalled();
      });
    });

    it("shows rolling shell progress lines from tool_progress SSE", async () => {
      const streamGate: { release: () => void } = {
        release: () => undefined
      };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onTool?: (payload: {
              phase: "start" | "end";
              toolName: string;
              toolCallId: string;
              isError: boolean;
            }) => void;
            onToolProgress?: (payload: {
              toolName: string;
              toolCallId: string;
              kind: "stdout_line" | "stderr_line" | "browser_step";
              line?: string;
              step?: string;
              seq: number;
            }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-shell" },
            userMessage: { id: "user-shell" }
          });
          handlers.onTool?.({
            phase: "start",
            toolName: "shell",
            toolCallId: "tool-shell-1",
            isError: false
          });
          for (const [index, line] of ["line-1", "line-2", "line-3", "line-4"].entries()) {
            handlers.onToolProgress?.({
              toolName: "shell",
              toolCallId: "tool-shell-1",
              kind: "stdout_line",
              line,
              seq: index + 1
            });
            await Promise.resolve();
          }
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
          handlers.onCompleted?.({ transport: null });
        }
      );

      const { result } = renderHook(() => useChat("thread-shell"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("Run pip");
        await Promise.resolve();
      });

      await waitFor(() => {
        const activityEntries = result.current.entries.filter(
          (
            entry
          ): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
            entry.kind === "activity"
        );
        expect(activityEntries).toHaveLength(1);
        expect(activityEntries[0]?.event.shellProgressLines).toEqual([
          "line-2",
          "line-3",
          "line-4"
        ]);
      });

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("merges reattach turn_status activity without clobbering streamed shell progress", async () => {
      window.sessionStorage.setItem("persai.active-web-turn.v1.thread-merge", "turn-merge");
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
        status: "running",
        chat: { id: "chat-merge" },
        userMessage: {
          id: "server-user-merge",
          chatId: "chat-merge",
          assistantId: "assistant-1",
          author: "user",
          content: "install",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        assistantMessage: {
          id: "server-assistant-merge",
          chatId: "chat-merge",
          assistantId: "assistant-1",
          author: "assistant",
          content: "",
          attachments: [],
          createdAt: "2026-04-25T17:45:36.000Z"
        },
        currentActivity: {
          toolName: "shell",
          toolCallId: "tool-shell-2",
          phase: "start",
          isError: false
        },
        runtime: null,
        error: null
      });
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
        async (
          _token: string,
          _clientTurnId: string,
          handlers: {
            onHeadersOk?: () => void;
            onToolProgress?: (payload: {
              toolName: string;
              toolCallId: string;
              kind: "stdout_line" | "stderr_line" | "browser_step";
              line?: string;
              seq: number;
            }) => void;
            onTurnStatus?: (payload: {
              turn: {
                status: string;
                currentActivity: {
                  toolName: string;
                  toolCallId: string;
                  phase: "start" | "end";
                  isError: boolean;
                } | null;
              };
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onToolProgress?.({
            toolName: "shell",
            toolCallId: "tool-shell-2",
            kind: "stdout_line",
            line: "Collecting requests",
            seq: 1
          });
          handlers.onTurnStatus?.({
            turn: {
              status: "running",
              currentActivity: {
                toolName: "shell",
                toolCallId: "tool-shell-2",
                phase: "start",
                isError: false
              }
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-merge"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await waitFor(() => expect(result.current.isStreaming).toBe(true));

      await waitFor(() => {
        const activityEntries = result.current.entries.filter(
          (
            entry
          ): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
            entry.kind === "activity"
        );
        expect(activityEntries).toHaveLength(1);
        expect(activityEntries[0]?.event.shellProgressLines).toEqual(["Collecting requests"]);
        expect(activityEntries[0]?.event.label).toBe("shell_started");
      });
    });

    it("clears shell progress when toolCallId changes across tools", async () => {
      const streamGate: { release: () => void } = {
        release: () => undefined
      };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onTool?: (payload: {
              phase: "start" | "end";
              toolName: string;
              toolCallId: string;
              isError: boolean;
            }) => void;
            onToolProgress?: (payload: {
              toolName: string;
              toolCallId: string;
              kind: "stdout_line" | "stderr_line" | "browser_step";
              line?: string;
              seq: number;
            }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-progress-bleed" },
            userMessage: { id: "user-progress-bleed" }
          });
          handlers.onTool?.({
            phase: "start",
            toolName: "shell",
            toolCallId: "tool-shell-a",
            isError: false
          });
          handlers.onToolProgress?.({
            toolName: "shell",
            toolCallId: "tool-shell-a",
            kind: "stdout_line",
            line: "pip install old",
            seq: 1
          });
          await Promise.resolve();
          handlers.onTool?.({
            phase: "start",
            toolName: "shell",
            toolCallId: "tool-shell-b",
            isError: false
          });
          handlers.onToolProgress?.({
            toolName: "shell",
            toolCallId: "tool-shell-b",
            kind: "stdout_line",
            line: "pip install new",
            seq: 1
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
          handlers.onCompleted?.({ transport: null });
        }
      );

      const { result } = renderHook(() => useChat("thread-progress-bleed"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("run");
        await Promise.resolve();
      });

      await waitFor(() => {
        const activityEntries = result.current.entries.filter(
          (
            entry
          ): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
            entry.kind === "activity"
        );
        expect(activityEntries).toHaveLength(1);
        expect(activityEntries[0]?.event.shellProgressLines).toEqual(["pip install new"]);
        expect(activityEntries[0]?.event.shellProgressLines).not.toContain("pip install old");
      });

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("clears live tool activity on tool-end so status falls back to thinking", async () => {
      const streamGate: { release: () => void } = {
        release: () => undefined
      };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onTool?: (payload: {
              phase: "start" | "end";
              toolName: string;
              toolCallId: string;
              isError: boolean;
              toolInputPreview?: string;
            }) => void;
            onToolProgress?: (payload: {
              toolName: string;
              toolCallId: string;
              kind: "stdout_line" | "stderr_line" | "browser_step";
              line?: string;
              seq: number;
            }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-tool-end-clear" },
            userMessage: { id: "user-tool-end-clear" }
          });
          handlers.onTool?.({
            phase: "start",
            toolName: "shell",
            toolCallId: "tool-shell-end-clear",
            isError: false,
            toolInputPreview: "pip install requests"
          });
          handlers.onToolProgress?.({
            toolName: "shell",
            toolCallId: "tool-shell-end-clear",
            kind: "stdout_line",
            line: "Downloading package",
            seq: 1
          });
          await Promise.resolve();
          handlers.onTool?.({
            phase: "end",
            toolName: "shell",
            toolCallId: "tool-shell-end-clear",
            isError: false
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
          handlers.onCompleted?.({ transport: null });
        }
      );

      const { result } = renderHook(() => useChat("thread-tool-end-clear"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("install");
        await Promise.resolve();
      });

      await waitFor(() => {
        const activityEntries = result.current.entries.filter(
          (
            entry
          ): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
            entry.kind === "activity"
        );
        expect(activityEntries).toHaveLength(0);
        expect(result.current.isStreaming).toBe(true);
      });

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("shows browser toolInputPreview like shell command preview", async () => {
      const streamGate: { release: () => void } = {
        release: () => undefined
      };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onTool?: (payload: {
              phase: "start" | "end";
              toolName: string;
              toolCallId: string;
              isError: boolean;
              toolInputPreview?: string;
            }) => void;
            onToolProgress?: (payload: {
              toolName: string;
              toolCallId: string;
              kind: "stdout_line" | "stderr_line" | "browser_step";
              step?: string;
              seq: number;
            }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-browser-preview" },
            userMessage: { id: "user-browser-preview" }
          });
          handlers.onTool?.({
            phase: "start",
            toolName: "browser",
            toolCallId: "tool-browser-1",
            isError: false,
            toolInputPreview: "open · https://example.com"
          });
          handlers.onToolProgress?.({
            toolName: "browser",
            toolCallId: "tool-browser-1",
            kind: "browser_step",
            step: "navigated",
            seq: 1
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
          handlers.onCompleted?.({ transport: null });
        }
      );

      const { result } = renderHook(() => useChat("thread-browser-preview"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("open site");
        await Promise.resolve();
      });

      await waitFor(() => {
        const activityEntries = result.current.entries.filter(
          (
            entry
          ): entry is Extract<(typeof result.current.entries)[number], { kind: "activity" }> =>
            entry.kind === "activity"
        );
        expect(activityEntries).toHaveLength(1);
        expect(activityEntries[0]?.event.shellCommand).toBe("open · https://example.com");
        expect(activityEntries[0]?.event.shellProgressLines).toEqual(["navigated"]);
      });

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });
    });

    it("surfaces ephemeral thinking preview from SSE without persisting thought", async () => {
      const streamGate: { release: () => void } = {
        release: () => undefined
      };
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onThinking?: (payload: { delta: string; accumulated: string }) => void;
            onCompleted?: (payload: { transport: unknown }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-thinking-preview" },
            userMessage: { id: "user-thinking-preview" }
          });
          handlers.onThinking?.({
            delta: "I should search first",
            accumulated: "I should search first"
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
          handlers.onCompleted?.({ transport: null });
        }
      );

      const { result } = renderHook(() => useChat("thread-thinking-preview"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("think");
        await Promise.resolve();
      });

      await act(async () => {
        for (const callback of Array.from(rafCallbacks.values())) {
          callback(performance.now());
        }
        rafCallbacks.clear();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find((message) => message.role === "assistant");
        expect(assistant).toBeDefined();
        expect(assistant?.thought ?? "").toBe("");
        expect(result.current.liveThinkingPreviewByMessageId[assistant!.id]).toBe(
          "I should search first"
        );
      });

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) {
          await sendPromise;
        }
      });

      await waitFor(() => {
        expect(Object.keys(result.current.liveThinkingPreviewByMessageId)).toHaveLength(0);
      });
    });
  });

  describe("ADR-166 Slice 5: three-image series scenario regressions", () => {
    function mediaAttachment(id: string, filename: string) {
      return {
        id,
        attachmentType: "image" as const,
        originalFilename: filename,
        mimeType: "image/png",
        sizeBytes: 64,
        processingStatus: "ready" as const,
        createdAt: "2026-07-27T18:00:00.000Z"
      };
    }

    function openMediaJob(id: string) {
      return {
        id,
        kind: "image" as const,
        operation: "image_generate",
        status: "running" as const,
        createdAt: "2026-07-27T18:00:00.000Z",
        startedAt: "2026-07-27T18:00:01.000Z",
        updatedAt: "2026-07-27T18:00:01.000Z"
      };
    }

    it("three deferred media complete out of order: one bubble, three attachments, Working 3→2→1→0, no discovery", async () => {
      const attA = mediaAttachment("att-series-a", "a.png");
      const attB = mediaAttachment("att-series-b", "b.png");
      const attC = mediaAttachment("att-series-c", "c.png");
      const jobA = openMediaJob("job-series-a");
      const jobB = openMediaJob("job-series-b");
      const jobC = openMediaJob("job-series-c");
      const workingCounts: number[] = [];
      type SeriesHandlers = {
        onHeadersOk?: () => void;
        onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
        onDelta?: (payload: { delta: string }) => void;
        onMedia?: (payload: {
          assistantMessageId: string;
          attachments: Array<ReturnType<typeof mediaAttachment>>;
        }) => void;
        onAsyncJobsOpen?: (payload: {
          activeMediaJobs: Array<ReturnType<typeof openMediaJob>>;
          activeDocumentJobs: unknown[];
          activeSandboxJobs: unknown[];
        }) => void;
      };
      let resolveHandlers: (handlers: SeriesHandlers) => void = () => undefined;
      const handlersReady = new Promise<SeriesHandlers>((resolve) => {
        resolveHandlers = resolve;
      });
      let resolveStreamEnd: () => void = () => undefined;
      const streamEnded = new Promise<void>((resolve) => {
        resolveStreamEnd = resolve;
      });

      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        messages: [
          {
            id: "older-user-s5",
            chatId: "chat-s5-series",
            assistantId: "assistant-1",
            author: "user",
            content: "prior question",
            attachments: [],
            createdAt: "2026-07-27T17:00:00.000Z"
          },
          {
            id: "older-assistant-s5",
            chatId: "chat-s5-series",
            assistantId: "assistant-1",
            author: "assistant",
            content: "prior answer",
            attachments: [],
            createdAt: "2026-07-27T17:00:05.000Z"
          }
        ]
      });

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (_token: string, _payload: unknown, handlers: SeriesHandlers) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-s5-series" },
            userMessage: { id: "user-s5-series", chatId: "chat-s5-series", attachments: [] }
          });
          handlers.onDelta?.({ delta: "Generating your images" });
          resolveHandlers(handlers);
          await streamEnded;
        }
      );

      const { result } = renderHook(() => useChat("thread-s5-series"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await act(async () => {
        await result.current.loadHistory("chat-s5-series");
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("three images please");
        await Promise.resolve();
      });

      const handlers = await handlersReady;

      await act(async () => {
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobA, jobB, jobC],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      await waitFor(() => expect(result.current.activeMediaJobs).toHaveLength(3));
      workingCounts.push(result.current.activeMediaJobs.length);

      // Out of enqueue order: C, then A, then B — one live bubble identity.
      await act(async () => {
        handlers.onMedia?.({
          assistantMessageId: "assistant-s5-series",
          attachments: [attC]
        });
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobA, jobB],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      await waitFor(() => expect(result.current.activeMediaJobs).toHaveLength(2));
      workingCounts.push(result.current.activeMediaJobs.length);

      await act(async () => {
        handlers.onMedia?.({
          assistantMessageId: "assistant-s5-series",
          attachments: [attA]
        });
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobB],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      await waitFor(() => expect(result.current.activeMediaJobs).toHaveLength(1));
      workingCounts.push(result.current.activeMediaJobs.length);

      await act(async () => {
        handlers.onMedia?.({
          assistantMessageId: "assistant-s5-series",
          attachments: [attB]
        });
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      await waitFor(() => expect(result.current.activeMediaJobs).toHaveLength(0));
      workingCounts.push(result.current.activeMediaJobs.length);

      expect(workingCounts).toEqual([3, 2, 1, 0]);
      const assistant = result.current.messages.find(
        (message) => message.id === "assistant-s5-series"
      );
      expect(assistant?.status).toBe("streaming");
      expect(assistant?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
        "att-series-a",
        "att-series-b",
        "att-series-c"
      ]);
      const ids = result.current.messages.map((message) => message.id);
      expect(ids.filter((id) => id === "older-user-s5")).toHaveLength(1);
      expect(ids.filter((id) => id === "older-assistant-s5")).toHaveLength(1);
      expect(ids.filter((id) => id === "user-s5-series")).toHaveLength(1);
      expect(ids.filter((id) => id === "assistant-s5-series")).toHaveLength(1);
      expect(
        result.current.messages.filter((message) => message.role === "assistant")
      ).toHaveLength(2);
      // Discovery SSE may be connected for the chat, but open-turn inline present
      // must not invent a second catch-up assistant bubble / async-cont overlay.
      expect(
        result.current.messages.some(
          (message) =>
            message.role === "assistant" &&
            (message.id.startsWith("local-assistant-async-cont:") ||
              message.id.includes("async-cont"))
        )
      ).toBe(false);
      expect(
        result.current.messages.filter((message) => message.id === "assistant-s5-series")
      ).toHaveLength(1);

      resolveStreamEnd();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("three deferred media complete in enqueue order onto the same live bubble", async () => {
      const attA = mediaAttachment("att-order-a", "a.png");
      const attB = mediaAttachment("att-order-b", "b.png");
      const attC = mediaAttachment("att-order-c", "c.png");
      type Handlers = {
        onHeadersOk?: () => void;
        onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
        onMedia?: (payload: {
          assistantMessageId: string;
          attachments: Array<ReturnType<typeof mediaAttachment>>;
        }) => void;
      };
      let resolveHandlers: (handlers: Handlers) => void = () => undefined;
      const handlersReady = new Promise<Handlers>((resolve) => {
        resolveHandlers = resolve;
      });
      let resolveStreamEnd: () => void = () => undefined;
      const streamEnded = new Promise<void>((resolve) => {
        resolveStreamEnd = resolve;
      });

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (_token: string, _payload: unknown, handlers: Handlers) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-s5-order" },
            userMessage: { id: "user-s5-order", chatId: "chat-s5-order", attachments: [] }
          });
          resolveHandlers(handlers);
          await streamEnded;
        }
      );

      const { result } = renderHook(() => useChat("thread-s5-order"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("three images please");
        await Promise.resolve();
      });
      const handlers = await handlersReady;

      for (const att of [attA, attB, attC]) {
        await act(async () => {
          handlers.onMedia?.({
            assistantMessageId: "assistant-s5-order",
            attachments: [att]
          });
        });
      }

      await waitFor(() => {
        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-s5-order"
        );
        expect(assistant?.attachments?.map((attachment) => attachment.id)).toEqual([
          "att-order-a",
          "att-order-b",
          "att-order-c"
        ]);
      });
      expect(
        result.current.messages.filter((message) => message.role === "assistant")
      ).toHaveLength(1);

      resolveStreamEnd();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("history refresh after first media early-bind preserves live overlay and does not reinsert prior rows", async () => {
      const attFirst = mediaAttachment("att-s5-early", "early.png");
      const attHistory = mediaAttachment("att-s5-history", "history.png");
      const streamGate: { release: () => void } = { release: () => undefined };
      const remainingJobs = [openMediaJob("job-s5-2"), openMediaJob("job-s5-3")];
      const liveHistory = {
        nextCursor: null as string | null,
        // Durable Working projection restores the same open-job snapshot after refresh.
        activeMediaJobs: remainingJobs,
        activeDocumentJobs: [] as [],
        activeSandboxJobs: [] as [],
        messages: [
          {
            id: "older-user-s5-hist",
            chatId: "chat-s5-hist",
            assistantId: "assistant-1",
            author: "user" as const,
            content: "prior",
            attachments: [] as [],
            createdAt: "2026-07-27T17:10:00.000Z"
          },
          {
            id: "older-assistant-s5-hist",
            chatId: "chat-s5-hist",
            assistantId: "assistant-1",
            author: "assistant" as const,
            content: "prior answer",
            attachments: [] as [],
            createdAt: "2026-07-27T17:10:05.000Z"
          },
          {
            id: "user-s5-hist",
            chatId: "chat-s5-hist",
            assistantId: "assistant-1",
            author: "user" as const,
            content: "three images please",
            attachments: [] as [],
            createdAt: "2026-07-27T18:10:00.000Z"
          },
          {
            id: "assistant-s5-hist",
            chatId: "chat-s5-hist",
            assistantId: "assistant-1",
            author: "assistant" as const,
            content: "Working on images",
            attachments: [attHistory],
            createdAt: "2026-07-27T18:10:00.100Z"
          }
        ]
      };
      assistantApiMocks.getChatMessages.mockResolvedValue(liveHistory);
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<ReturnType<typeof mediaAttachment>>;
            }) => void;
            onAsyncJobsOpen?: (payload: {
              activeMediaJobs: Array<ReturnType<typeof openMediaJob>>;
              activeDocumentJobs: unknown[];
              activeSandboxJobs: unknown[];
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-s5-hist" },
            userMessage: { id: "user-s5-hist", chatId: "chat-s5-hist", attachments: [] }
          });
          handlers.onAsyncJobsOpen?.({
            activeMediaJobs: [
              openMediaJob("job-s5-1"),
              openMediaJob("job-s5-2"),
              openMediaJob("job-s5-3")
            ],
            activeDocumentJobs: [],
            activeSandboxJobs: []
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-s5-hist",
            attachments: [attFirst]
          });
          handlers.onAsyncJobsOpen?.({
            activeMediaJobs: remainingJobs,
            activeDocumentJobs: [],
            activeSandboxJobs: []
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-s5-hist"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("three images please");
        await Promise.resolve();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-s5-hist"
        );
        expect(assistant?.attachments?.some((attachment) => attachment.id === "att-s5-early")).toBe(
          true
        );
        expect(result.current.activeMediaJobs).toHaveLength(2);
      });

      await act(async () => {
        await result.current.loadHistory("chat-s5-hist");
      });

      const ids = result.current.messages.map((message) => message.id);
      expect(ids.filter((id) => id === "older-user-s5-hist")).toHaveLength(1);
      expect(ids.filter((id) => id === "older-assistant-s5-hist")).toHaveLength(1);
      expect(ids.filter((id) => id === "user-s5-hist")).toHaveLength(1);
      expect(ids.filter((id) => id === "assistant-s5-hist")).toHaveLength(1);
      const assistant = result.current.messages.find(
        (message) => message.id === "assistant-s5-hist"
      );
      expect(assistant?.status).toBe("streaming");
      expect(assistant?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
        "att-s5-early",
        "att-s5-history"
      ]);
      expect(result.current.activeMediaJobs.map((job) => job.id).sort()).toEqual([
        "job-s5-2",
        "job-s5-3"
      ]);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("primary / reattach / F5-equivalent history share one set-like attachment merge", async () => {
      const attPrimary = mediaAttachment("att-parity-primary", "primary.png");
      const attReattach = mediaAttachment("att-parity-reattach", "reattach.png");
      const attHistory = mediaAttachment("att-parity-history", "history.png");
      const streamGate: { release: () => void } = { release: () => undefined };

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<ReturnType<typeof mediaAttachment>>;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-s5-parity" },
            userMessage: { id: "user-s5-parity", chatId: "chat-s5-parity", attachments: [] }
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-s5-parity",
            attachments: [attPrimary]
          });
          await new Promise<void>((resolve) => {
            streamGate.release = resolve;
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-s5-parity"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("draw series", undefined, {
          clientTurnId: "client-turn-s5-parity"
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(
          result.current.messages.find((message) => message.id === "assistant-s5-parity")
            ?.attachments?.[0]?.id
        ).toBe("att-parity-primary");
      });

      // Reattach path on a sibling thread with overlapping + new attachment ids.
      window.sessionStorage.setItem(
        "persai.active-web-turn.v1.thread-s5-parity-reattach",
        "client-turn-s5-parity-reattach"
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
        status: "running",
        chat: { id: "chat-s5-parity-reattach" },
        userMessage: {
          id: "user-s5-parity-reattach",
          chatId: "chat-s5-parity-reattach",
          assistantId: "assistant-1",
          author: "user",
          content: "draw series",
          attachments: [],
          createdAt: "2026-07-27T18:20:00.000Z"
        },
        assistantMessage: {
          id: "assistant-s5-parity-reattach",
          chatId: "chat-s5-parity-reattach",
          assistantId: "assistant-1",
          author: "assistant",
          content: "",
          attachments: [attPrimary],
          createdAt: "2026-07-27T18:20:01.000Z"
        },
        currentActivity: null,
        runtime: null,
        error: null
      });
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
        async (
          _token: string,
          _clientTurnId: string,
          handlers: {
            onHeadersOk?: () => void;
            onTurnStatus?: (payload: { turn: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<ReturnType<typeof mediaAttachment>>;
            }) => void;
          }
        ) => {
          handlers.onHeadersOk?.();
          handlers.onTurnStatus?.({
            turn: {
              status: "running",
              chat: { id: "chat-s5-parity-reattach" },
              userMessage: {
                id: "user-s5-parity-reattach",
                chatId: "chat-s5-parity-reattach",
                assistantId: "assistant-1",
                author: "user",
                content: "draw series",
                attachments: [],
                createdAt: "2026-07-27T18:20:00.000Z"
              },
              assistantMessage: {
                id: "assistant-s5-parity-reattach",
                chatId: "chat-s5-parity-reattach",
                assistantId: "assistant-1",
                author: "assistant",
                content: "",
                attachments: [attPrimary],
                createdAt: "2026-07-27T18:20:01.000Z"
              },
              currentActivity: null,
              runtime: null,
              error: null
            }
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-s5-parity-reattach",
            attachments: [attPrimary, attReattach]
          });
        }
      );

      const { result: reattachResult } = renderHook(() => useChat("thread-s5-parity-reattach"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      await waitFor(() => {
        const assistant = reattachResult.current.messages.find(
          (message) => message.id === "assistant-s5-parity-reattach"
        );
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
          "att-parity-primary",
          "att-parity-reattach"
        ]);
      });

      // F5-equivalent: same-id history refresh contributes a third attachment without
      // demoting live overlay or duplicating primary/reattach ids.
      assistantApiMocks.getChatMessages.mockResolvedValue({
        nextCursor: null,
        messages: [
          {
            id: "user-s5-parity-reattach",
            chatId: "chat-s5-parity-reattach",
            assistantId: "assistant-1",
            author: "user",
            content: "draw series",
            attachments: [],
            createdAt: "2026-07-27T18:20:00.000Z"
          },
          {
            id: "assistant-s5-parity-reattach",
            chatId: "chat-s5-parity-reattach",
            assistantId: "assistant-1",
            author: "assistant",
            content: "",
            attachments: [attPrimary, attHistory],
            createdAt: "2026-07-27T18:20:01.000Z"
          }
        ]
      });

      await act(async () => {
        await reattachResult.current.loadHistory("chat-s5-parity-reattach");
      });

      const afterF5 = reattachResult.current.messages.find(
        (message) => message.id === "assistant-s5-parity-reattach"
      );
      expect(afterF5?.status).toBe("streaming");
      expect(afterF5?.attachments?.map((attachment) => attachment.id).sort()).toEqual([
        "att-parity-history",
        "att-parity-primary",
        "att-parity-reattach"
      ]);

      streamGate.release();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("Working clears to 0 from authoritative last-job failure snapshot", async () => {
      const attOk = mediaAttachment("att-s5-fail-ok", "ok.png");
      const jobA = openMediaJob("job-s5-fail-a");
      const jobB = openMediaJob("job-s5-fail-b");
      type FailHandlers = {
        onHeadersOk?: () => void;
        onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
        onMedia?: (payload: {
          assistantMessageId: string;
          attachments: Array<ReturnType<typeof mediaAttachment>>;
        }) => void;
        onAsyncJobsOpen?: (payload: {
          activeMediaJobs: Array<ReturnType<typeof openMediaJob>>;
          activeDocumentJobs: unknown[];
          activeSandboxJobs: unknown[];
        }) => void;
      };
      let resolveHandlers: (handlers: FailHandlers) => void = () => undefined;
      const handlersReady = new Promise<FailHandlers>((resolve) => {
        resolveHandlers = resolve;
      });
      let resolveStreamEnd: () => void = () => undefined;
      const streamEnded = new Promise<void>((resolve) => {
        resolveStreamEnd = resolve;
      });

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (_token: string, _payload: unknown, handlers: FailHandlers) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-s5-fail" },
            userMessage: { id: "user-s5-fail", chatId: "chat-s5-fail", attachments: [] }
          });
          resolveHandlers(handlers);
          await streamEnded;
        }
      );

      const { result } = renderHook(() => useChat("thread-s5-fail"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("two images");
        await Promise.resolve();
      });
      const handlers = await handlersReady;

      await act(async () => {
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobA, jobB],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      expect(result.current.activeMediaJobs).toHaveLength(2);

      await act(async () => {
        handlers.onMedia?.({
          assistantMessageId: "assistant-s5-fail",
          attachments: [attOk]
        });
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobB],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      expect(result.current.activeMediaJobs).toHaveLength(1);

      await act(async () => {
        // Last job failed/cancelled — authoritative empty snapshot, not inferred from text.
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      expect(result.current.activeMediaJobs).toEqual([]);
      const assistant = result.current.messages.find(
        (message) => message.id === "assistant-s5-fail"
      );
      expect(assistant?.attachments?.map((attachment) => attachment.id)).toEqual([
        "att-s5-fail-ok"
      ]);
      expect(assistant?.status).toBe("streaming");

      resolveStreamEnd();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("terminal async_jobs_open tombstones prevent same-thread stale Working resurrection", async () => {
      const jobA = openMediaJob("job-s5-tombstone-a");
      const jobB = openMediaJob("job-s5-tombstone-b");
      type TombstoneHandlers = {
        onHeadersOk?: () => void;
        onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
        onAsyncJobsOpen?: (payload: {
          activeMediaJobs: Array<ReturnType<typeof openMediaJob>>;
          activeDocumentJobs: unknown[];
          activeSandboxJobs: unknown[];
          terminalJob?: { kind: "media" | "document"; id: string };
        }) => void;
      };
      let resolveHandlers: (handlers: TombstoneHandlers) => void = () => undefined;
      const handlersReady = new Promise<TombstoneHandlers>((resolve) => {
        resolveHandlers = resolve;
      });
      let resolveStreamEnd: () => void = () => undefined;
      const streamEnded = new Promise<void>((resolve) => {
        resolveStreamEnd = resolve;
      });

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (_token: string, _payload: unknown, handlers: TombstoneHandlers) => {
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-s5-tombstone" },
            userMessage: { id: "user-s5-tombstone", chatId: "chat-s5-tombstone", attachments: [] }
          });
          resolveHandlers(handlers);
          await streamEnded;
        }
      );

      const { result } = renderHook(() => useChat("thread-s5-tombstone"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("two images");
        await Promise.resolve();
      });
      const handlers = await handlersReady;

      await act(async () => {
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobA, jobB],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      expect(result.current.activeMediaJobs.map((job) => job.id).sort()).toEqual([
        "job-s5-tombstone-a",
        "job-s5-tombstone-b"
      ]);

      await act(async () => {
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobB],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          terminalJob: { kind: "media", id: "job-s5-tombstone-a" }
        });
      });
      expect(result.current.activeMediaJobs.map((job) => job.id)).toEqual(["job-s5-tombstone-b"]);

      await act(async () => {
        handlers.onAsyncJobsOpen?.({
          activeMediaJobs: [jobA, jobB],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      expect(result.current.activeMediaJobs.map((job) => job.id)).toEqual(["job-s5-tombstone-b"]);

      resolveStreamEnd();
      await act(async () => {
        if (sendPromise !== undefined) await sendPromise;
      });
    });

    it("terminal async_jobs_open tombstones stay thread-scoped across thread switches", async () => {
      const releaseByThread = new Map<string, () => void>();
      const handlersByThread = new Map<
        string,
        {
          onHeadersOk?: () => void;
          onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
          onAsyncJobsOpen?: (payload: {
            activeMediaJobs: Array<ReturnType<typeof openMediaJob>>;
            activeDocumentJobs: unknown[];
            activeSandboxJobs: unknown[];
            terminalJob?: { kind: "media" | "document"; id: string };
          }) => void;
        }
      >();

      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          payload: { surfaceThreadKey?: string },
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onAsyncJobsOpen?: (payload: {
              activeMediaJobs: Array<ReturnType<typeof openMediaJob>>;
              activeDocumentJobs: unknown[];
              activeSandboxJobs: unknown[];
              terminalJob?: { kind: "media" | "document"; id: string };
            }) => void;
          }
        ) => {
          const sendThreadKey = payload.surfaceThreadKey ?? "unknown-thread";
          const chatId = sendThreadKey === "thread-s5-A" ? "chat-s5-A" : "chat-s5-B";
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: chatId },
            userMessage: { id: `user-${sendThreadKey}`, chatId, attachments: [] }
          });
          handlersByThread.set(sendThreadKey, handlers);
          await new Promise<void>((resolve) => {
            releaseByThread.set(sendThreadKey, resolve);
          });
        }
      );

      const { result, rerender } = renderHook(({ threadKey }) => useChat(threadKey), {
        initialProps: { threadKey: "thread-s5-A" },
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendAPromise: Promise<void> | undefined;
      await act(async () => {
        sendAPromise = result.current.send("thread A");
        await Promise.resolve();
      });
      const handlersA = handlersByThread.get("thread-s5-A");
      expect(handlersA).toBeDefined();
      await act(async () => {
        handlersA?.onAsyncJobsOpen?.({
          activeMediaJobs: [openMediaJob("job-shared")],
          activeDocumentJobs: [],
          activeSandboxJobs: [],
          terminalJob: { kind: "media", id: "job-shared" }
        });
      });
      expect(result.current.activeMediaJobs).toEqual([]);

      rerender({ threadKey: "thread-s5-B" });

      let sendBPromise: Promise<void> | undefined;
      await act(async () => {
        sendBPromise = result.current.send("thread B");
        await Promise.resolve();
      });
      const handlersB = handlersByThread.get("thread-s5-B");
      expect(handlersB).toBeDefined();
      await act(async () => {
        handlersB?.onAsyncJobsOpen?.({
          activeMediaJobs: [openMediaJob("job-shared")],
          activeDocumentJobs: [],
          activeSandboxJobs: []
        });
      });
      expect(result.current.activeMediaJobs.map((job) => job.id)).toEqual(["job-shared"]);

      releaseByThread.get("thread-s5-A")?.();
      releaseByThread.get("thread-s5-B")?.();
      await act(async () => {
        await Promise.all([sendAPromise, sendBPromise].filter(Boolean) as Promise<void>[]);
      });
    });

    it("Stop after one delivered attachment keeps the interrupted bubble and clears Stop latch", async () => {
      const attOne = mediaAttachment("att-s5-stop-1", "one.png");
      let observedSignal: AbortSignal | undefined;
      assistantApiMocks.streamAssistantWebChatTurn.mockImplementation(
        async (
          _token: string,
          _payload: unknown,
          handlers: {
            onHeadersOk?: () => void;
            onStarted?: (payload: { chat: unknown; userMessage: unknown }) => void;
            onMedia?: (payload: {
              assistantMessageId: string;
              attachments: Array<ReturnType<typeof mediaAttachment>>;
            }) => void;
            onAsyncJobsOpen?: (payload: {
              activeMediaJobs: Array<ReturnType<typeof openMediaJob>>;
              activeDocumentJobs: unknown[];
              activeSandboxJobs: unknown[];
            }) => void;
            onInterrupted?: (payload: { transport: unknown }) => void;
          },
          signal?: AbortSignal
        ) => {
          observedSignal = signal;
          handlers.onHeadersOk?.();
          handlers.onStarted?.({
            chat: { id: "chat-s5-stop" },
            userMessage: { id: "user-s5-stop", chatId: "chat-s5-stop", attachments: [] }
          });
          handlers.onMedia?.({
            assistantMessageId: "assistant-s5-stop",
            attachments: [attOne]
          });
          handlers.onAsyncJobsOpen?.({
            activeMediaJobs: [openMediaJob("job-s5-stop-2"), openMediaJob("job-s5-stop-3")],
            activeDocumentJobs: [],
            activeSandboxJobs: []
          });
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              handlers.onInterrupted?.({
                transport: {
                  assistantMessage: {
                    id: "assistant-s5-stop",
                    content: "",
                    stopReason: "user_stopped"
                  }
                }
              });
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-s5-stop"), {
        wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
      });

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.send("three please");
        await Promise.resolve();
      });

      await waitFor(() => {
        const assistant = result.current.messages.find(
          (message) => message.id === "assistant-s5-stop"
        );
        expect(
          assistant?.attachments?.some((attachment) => attachment.id === "att-s5-stop-1")
        ).toBe(true);
        expect(result.current.activeMediaJobs).toHaveLength(2);
      });

      act(() => {
        result.current.stop();
      });

      await act(async () => {
        if (sendPromise !== undefined) await sendPromise.catch(() => undefined);
      });

      expect(observedSignal?.aborted).toBe(true);
      const assistant = result.current.messages.find(
        (message) => message.id === "assistant-s5-stop"
      );
      expect(assistant?.attachments?.map((attachment) => attachment.id)).toEqual(["att-s5-stop-1"]);
      expect(assistant?.stopReason).toBe("user_stopped");
      expect(assistant?.status).toBe("partial");
      expect(assistantApiMocks.stopAssistantWebChatTurn).toHaveBeenCalled();
    });
  });
});
