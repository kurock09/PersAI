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
  uploadAssistantKnowledgeSource: vi.fn(),
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
    uploadAssistantKnowledgeSource: assistantApiMocks.uploadAssistantKnowledgeSource,
    streamAssistantWebChatTurn: assistantApiMocks.streamAssistantWebChatTurn
  };
});

describe("useChat", () => {
  const rafCallbacks = new Map<number, FrameRequestCallback>();
  let nextRafId = 1;

  function createCompactionState(
    overrides?: Partial<{
      available: boolean;
      suggested: boolean;
      suggestionReason: "token_threshold" | "history_threshold" | null;
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
    clerkMocks.getToken.mockResolvedValue("token-1");
    assistantApiMocks.compactChat.mockReset();
    assistantApiMocks.getChatCompactionState.mockReset();
    assistantApiMocks.getChatMessages.mockReset();
    assistantApiMocks.stageWebChatAttachment.mockReset();
    assistantApiMocks.uploadAssistantKnowledgeSource.mockReset();
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

    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]?.event.label).toBe("Image ready");
    expect(activityEntries[0]?.event.emphasis).toBe("strong");
  });

  it("shows the live status badge only for the latest assistant reply", async () => {
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

    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]?.event.label).toBe("Response generated");
    expect(activityEntries[0]?.event.afterMessageId).toBe("assistant-msg-2");
  });

  it("appends the shadow routing label for owner or admin viewers", async () => {
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

    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]?.event.label).toBe("Response generated");
    expect(activityEntries[0]?.event.shadowRoutingLabel).toBe("premium (llm)");
  });

  it("keeps active-mode routing labels out of the shadow badge metadata", async () => {
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

    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]?.event.label).toBe("Response generated");
    expect(activityEntries[0]?.event.shadowRoutingLabel).toBeUndefined();
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
      file
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
});
