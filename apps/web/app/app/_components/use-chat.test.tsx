import { act, renderHook, waitFor } from "@testing-library/react";
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
  stageWebChatAttachment: vi.fn(),
  uploadAssistantKnowledgeSource: vi.fn(),
  streamAssistantWebChatTurn: vi.fn(),
  stopAssistantWebChatTurn: vi.fn()
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
    stageWebChatAttachment: assistantApiMocks.stageWebChatAttachment,
    uploadAssistantKnowledgeSource: assistantApiMocks.uploadAssistantKnowledgeSource,
    streamAssistantWebChatTurn: assistantApiMocks.streamAssistantWebChatTurn,
    stopAssistantWebChatTurn: assistantApiMocks.stopAssistantWebChatTurn
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
    assistantApiMocks.getAssistantWebChatTurnStatus.mockReset();
    assistantApiMocks.getChatCompactionState.mockReset();
    assistantApiMocks.getChatMessages.mockReset();
    assistantApiMocks.stageWebChatAttachment.mockReset();
    assistantApiMocks.uploadAssistantKnowledgeSource.mockReset();
    assistantApiMocks.streamAssistantWebChatTurn.mockReset();
    assistantApiMocks.stopAssistantWebChatTurn.mockReset();
    assistantApiMocks.getAssistantWebChatTurnStatus.mockResolvedValue({
      status: "unknown",
      chat: null,
      userMessage: null,
      assistantMessage: null,
      runtime: null,
      error: null
    });
    assistantApiMocks.stopAssistantWebChatTurn.mockResolvedValue(undefined);
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

    const assistantEntry = result.current.entries.find(
      (entry): entry is Extract<(typeof result.current.entries)[number], { kind: "message" }> =>
        entry.kind === "message" && entry.message.role === "assistant"
    );

    expect(assistantEntry?.message.content).toBe("Hello, full final answer");
    expect(assistantEntry?.message.status).toBe("committed");
    expect(assistantEntry?.message.id).toBe("assistant-msg-1");
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

    await act(async () => {
      await result.current.loadHistory("chat-a");
    });
    expect(assistantApiMocks.getChatMessages).toHaveBeenCalledTimes(2);
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
            event: expect.objectContaining({ label: "Generating image" })
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
          event: expect.objectContaining({ label: "Generating image" })
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
    it("stop() POSTs the in-flight clientTurnId before aborting the local controller", async () => {
      let observedSignal: AbortSignal | undefined;
      let observedClientTurnId: string | undefined;
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

      await act(async () => {
        result.current.stop();
        if (sendPromise !== undefined) {
          await sendPromise.catch(() => undefined);
        }
      });

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
      // Local controller must still be aborted — this is what flips the
      // user-facing UI state regardless of whether the POST succeeded.
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
      // The POST is best-effort: a network failure here just means the
      // runtime keeps generating server-side, which is no worse than the
      // soft-detach path. The user-visible UI guarantee — composer
      // unfreezes, isStreaming flips off — must hold regardless.
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

        await vi.waitFor(() => expect(assistantApiMocks.getChatMessages).toHaveBeenCalledTimes(2));
        expect(result.current.isStreaming).toBe(true);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
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
  });
});
