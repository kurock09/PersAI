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

  beforeEach(() => {
    window.sessionStorage.clear();
    clerkMocks.getToken.mockResolvedValue("token-1");
    assistantApiMocks.compactChat.mockReset();
    assistantApiMocks.getAssistantWebChatTurnStatus.mockReset();
    assistantApiMocks.getChatCompactionState.mockReset();
    assistantApiMocks.getChatMessages.mockReset();
    assistantApiMocks.getAssistantWebChatPlan.mockReset();
    assistantApiMocks.reattachAssistantWebChatTurnStream.mockReset();
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rafCallbacks.clear();
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

  it("preserves working notes when completed transport carries workingNotes field", async () => {
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
              workingNotes: ["Проверяю сайт."],
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
    expect(assistantEntry?.message.workingNotes).toEqual(["Проверяю сайт."]);
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

  it("ignores stale running activeTurn when committed history already has the final assistant", async () => {
    window.sessionStorage.setItem("persai.active-web-turn.v1.thread-1", "turn-stale");
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      messages: [
        {
          id: "server-user-active",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "draw",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        {
          id: "server-final-assistant",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "Done",
          attachments: [],
          createdAt: "2026-04-25T17:45:40.000Z"
        }
      ],
      activeTurn: {
        clientTurnId: "turn-stale",
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
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "server-user-active",
      "server-final-assistant"
    ]);
    expect(window.sessionStorage.getItem("persai.active-web-turn.v1.thread-1")).toBeNull();
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
    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
      nextCursor: null,
      messages: [
        {
          id: "older-user-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "older question",
          attachments: [],
          createdAt: "2026-04-25T17:40:35.000Z"
        }
      ]
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "older-user-1",
      "server-user-1",
      "local-assistant-turn-1"
    ]);
    expect(result.current.entries.some((entry) => entry.kind === "activity")).toBe(false);
  });

  it("loadHistory removes a restored live assistant when committed history has the final turn", async () => {
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
  });

  it("loadHistory keeps the live cursor when history has active user but only an older assistant", async () => {
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
        id: "server-user-active",
        chatId: "chat-1",
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
          id: "server-user-active",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "user",
          content: "continue",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        }
      ]
    });

    const { result } = renderHook(() => useChat("thread-1"), {
      wrapper: ({ children }) => <StreamingThreadsProvider>{children}</StreamingThreadsProvider>
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-active",
        "local-assistant-turn-1"
      ]);
    });

    await act(async () => {
      await result.current.loadHistory("chat-1");
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages.map((message) => message.id)).toEqual([
      "server-user-old",
      "server-assistant-old",
      "server-user-active",
      "local-assistant-turn-1"
    ]);
    expect(result.current.entries).toContainEqual(
      expect.objectContaining({
        kind: "activity",
        event: expect.objectContaining({ label: "Reading the page" })
      })
    );
    expect(window.sessionStorage.getItem("persai.active-web-turn.v1.thread-1")).toBe("turn-1");
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
    assistantApiMocks.getChatMessages
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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

    assistantApiMocks.getChatMessages.mockResolvedValueOnce({
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
    });

    await act(async () => {
      await result.current.loadHistory("chat-a");
    });
    expect(assistantApiMocks.getChatMessages).toHaveBeenCalledTimes(3);
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

    it("retryPendingSend re-dispatches the same payload and clears the slot on success", async () => {
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
          // First call fails before headers, second succeeds.
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

      expect(callCount).toBe(2);
      expect(result.current.pendingSendStatus).toBeNull();
      const userMsg = result.current.messages.find((m) => m.role === "user");
      expect(userMsg?.status).toBe("committed");
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
      assistantApiMocks.streamAssistantWebChatTurn.mockRejectedValueOnce(
        new TypeError("fetch failed")
      );
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
          lastMessageAt: "2026-04-14T10:00:02.000Z",
          createdAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:00:02.000Z"
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
        assistantMessage: {
          id: "server-assistant-1",
          chatId: "chat-1",
          assistantId: "assistant-1",
          author: "assistant",
          content: "already saved",
          attachments: [],
          createdAt: "2026-04-14T10:00:01.000Z"
        },
        followUpAssistantMessage: {
          id: "follow-up-1",
          chatId: "chat-1",
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
      });
      assistantApiMocks.getChatMessages.mockResolvedValueOnce({
        nextCursor: null,
        activeMediaJobs: [],
        messages: [
          {
            id: "server-user-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "user",
            content: "retry me",
            attachments: [],
            createdAt: "2026-04-14T10:00:00.000Z"
          },
          {
            id: "server-assistant-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content: "already saved",
            attachments: [],
            createdAt: "2026-04-14T10:00:01.000Z"
          },
          {
            id: "follow-up-1",
            chatId: "chat-1",
            assistantId: "assistant-1",
            author: "assistant",
            content: "Please start a new chat.",
            attachments: [],
            createdAt: "2026-04-14T10:00:02.000Z"
          }
        ]
      });
      assistantApiMocks.getChatCompactionState.mockResolvedValueOnce(createCompactionState());

      const { result } = renderHook(() => useChat("thread-1"));

      await act(async () => {
        await result.current.send("retry me");
      });
      expect(result.current.pendingSendStatus).toBe("send_failed_unconfirmed");

      await act(async () => {
        await result.current.retryPendingSend();
      });

      expect(assistantApiMocks.streamAssistantWebChatTurn).toHaveBeenCalledTimes(1);
      expect(assistantApiMocks.getChatMessages).toHaveBeenCalledWith(
        "token-1",
        "chat-1",
        undefined,
        20
      );
      expect(assistantApiMocks.getChatCompactionState).toHaveBeenCalledWith("token-1", "chat-1");
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-1",
        "server-assistant-1",
        "follow-up-1"
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

        let retryPromise: Promise<void> | undefined;
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
        expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalledTimes(2);
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
      act(() => {
        restored = result.current.cancelPendingSend();
      });

      expect(restored).toBe("draft text");
      expect(result.current.pendingSendStatus).toBeNull();
      expect(result.current.messages).toHaveLength(0);
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
        })
      ]);

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
        expect(assistantApiMocks.getChatMessages).toHaveBeenNthCalledWith(
          2,
          "token-1",
          "chat-A",
          undefined,
          20
        );
      });

      rerender({ threadKey: "thread-A" });
      expect(result.current.messages.map((message) => message.id)).toEqual([
        "server-user-A",
        "server-assistant-A"
      ]);
    });

    it("refreshes terminal reattach history against the originating chat after switching away", async () => {
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
          await handlers.onCompleted?.();
        }
      );
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
              content: "keep going",
              attachments: [],
              createdAt: "2026-04-25T17:45:35.000Z"
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
        expect(assistantApiMocks.getChatMessages).toHaveBeenNthCalledWith(
          3,
          "token-1",
          "chat-A",
          undefined,
          20
        );
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

    it("keeps a soft-detached long turn alive past the old polling cap and reconciles later", async () => {
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
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
        async (
          _token: string,
          _clientTurnId: string,
          handlers: {
            onReattached?: (payload: { turn: unknown; live: boolean }) => void;
          }
        ) => {
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

      await waitFor(() =>
        expect(assistantApiMocks.reattachAssistantWebChatTurnStream).toHaveBeenCalledTimes(1)
      );
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.messages.map((message) => message.id)).toEqual([
          "server-user-1",
          "server-assistant-1"
        ]);
      });
      expect(assistantApiMocks.stopAssistantWebChatTurn).not.toHaveBeenCalled();
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
      assistantApiMocks.reattachAssistantWebChatTurnStream.mockImplementationOnce(
        async (
          _token: string,
          _clientTurnId: string,
          handlers: {
            onFailed?: (payload: { code?: string; message: string; transport: unknown }) => void;
          }
        ) => {
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
      expect(assistantApiMocks.getChatMessages).toHaveBeenCalledTimes(1);
      expect(assistantApiMocks.getAssistantWebChatTurnStatus).toHaveBeenCalledTimes(1);
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
          handlers.onDelta?.({ delta: "Streaming long answer..." });
          await new Promise<void>((resolve) => {
            releaseStream = () => resolve();
          });
        }
      );
      // Initial chat-A history: an older user/assistant pair above the
      // (about-to-be-sent) live turn.
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
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
          ]
        })
        // chat-B history while we're switched away.
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
        // chat-A re-fetch after switching back: server has the live user
        // message persisted but assistant is still in flight server-side.
        .mockResolvedValueOnce({
          nextCursor: null,
          messages: [
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
            },
            {
              id: "server-user-A-live",
              chatId: "chat-A",
              assistantId: "assistant-1",
              author: "user",
              content: "Длинный ответ",
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
          onDeltaRef = handlers.onDelta ?? null;
          handlers.onDelta?.({ delta: "First chunk. " });
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
      assistantApiMocks.getChatMessages
        .mockResolvedValueOnce({
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
        })
        // loadOlderMessages → returns the off-screen user (older
        // than the latest window).
        .mockResolvedValueOnce({
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
        })
        // Chat B history.
        .mockResolvedValueOnce({
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
      assistantApiMocks.getChatMessages.mockResolvedValueOnce({
        messages: [],
        nextCursor: null,
        activeTurn: null,
        activeMediaJobs: [],
        activeDocumentJobs: [],
        currentEngagement: {
          skillDisplayName: "Visible skill",
          scenarioDisplayName: null
        }
      });
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

    it("does not apply deferred shell finished turn_status while turn is still running", async () => {
      window.sessionStorage.setItem(
        "persai.active-web-turn.v1.thread-defer-finished",
        "turn-defer"
      );
      assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValueOnce({
        status: "running",
        chat: { id: "chat-defer" },
        userMessage: {
          id: "server-user-defer",
          chatId: "chat-defer",
          assistantId: "assistant-1",
          author: "user",
          content: "install",
          attachments: [],
          createdAt: "2026-04-25T17:45:35.000Z"
        },
        assistantMessage: {
          id: "server-assistant-defer",
          chatId: "chat-defer",
          assistantId: "assistant-1",
          author: "assistant",
          content: "",
          attachments: [],
          createdAt: "2026-04-25T17:45:36.000Z"
        },
        currentActivity: {
          toolName: "shell",
          toolCallId: "tool-shell-defer",
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
            toolCallId: "tool-shell-defer",
            kind: "stdout_line",
            line: "Downloading package",
            seq: 1
          });
          handlers.onTurnStatus?.({
            turn: {
              status: "running",
              currentActivity: {
                toolName: "shell",
                toolCallId: "tool-shell-defer",
                phase: "end",
                isError: false
              }
            }
          });
        }
      );

      const { result } = renderHook(() => useChat("thread-defer-finished"), {
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
        expect(activityEntries[0]?.event.label).not.toBe("shell_finished");
        expect(activityEntries[0]?.event.shellProgressLines).toEqual(["Downloading package"]);
      });
    });
  });
});
