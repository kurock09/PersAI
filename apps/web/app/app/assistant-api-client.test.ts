import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactChat,
  getChatCompactionState,
  getAdminRuntimeProviderSettings,
  postAdminPlatformRollout,
  postAdminPlatformRolloutRollback,
  postAssistantTelegramDisconnect,
  toWebChatUxIssue,
  putAdminRuntimeProviderSettings,
  streamAssistantWebChatTurn
} from "./assistant-api-client";

const contractMocks = vi.hoisted(() => {
  return {
    postAdminStepUpChallenge: vi.fn(),
    getAdminRuntimeProviderSettings: vi.fn(),
    getAssistantWebChatCompaction: vi.fn(),
    postAdminPlatformRollout: vi.fn(),
    postAdminPlatformRolloutRollback: vi.fn(),
    postAssistantWebChatCompact: vi.fn(),
    putAdminRuntimeProviderSettings: vi.fn(),
    postAssistantTelegramRevoke: vi.fn()
  };
});

vi.mock("@persai/contracts", async () => {
  const actual = await vi.importActual<typeof import("@persai/contracts")>("@persai/contracts");
  return {
    ...actual,
    postAdminStepUpChallenge: contractMocks.postAdminStepUpChallenge,
    getAdminRuntimeProviderSettings: contractMocks.getAdminRuntimeProviderSettings,
    getAssistantWebChatCompaction: contractMocks.getAssistantWebChatCompaction,
    postAdminPlatformRollout: contractMocks.postAdminPlatformRollout,
    postAdminPlatformRolloutRollback: contractMocks.postAdminPlatformRolloutRollback,
    postAssistantWebChatCompact: contractMocks.postAssistantWebChatCompact,
    putAdminRuntimeProviderSettings: contractMocks.putAdminRuntimeProviderSettings,
    postAssistantTelegramRevoke: contractMocks.postAssistantTelegramRevoke
  };
});

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

describe("admin rollout client", () => {
  it("loads global runtime provider settings", async () => {
    contractMocks.getAdminRuntimeProviderSettings.mockResolvedValue({
      status: 200,
      data: {
        settings: {
          schema: "persai.adminRuntimeProviderSettings.v1",
          mode: "global_settings",
          primary: {
            provider: "openai",
            model: "gpt-5.4"
          },
          fallback: {
            provider: "anthropic",
            model: "claude-sonnet-4-5"
          },
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: ["claude-sonnet-4-5"]
          },
          providerKeys: {
            openai: {
              configured: true,
              lastFour: "1234",
              updatedAt: "2026-03-25T17:29:05.781Z"
            },
            anthropic: {
              configured: false,
              lastFour: null,
              updatedAt: null
            }
          },
          notes: []
        }
      }
    });

    await expect(getAdminRuntimeProviderSettings("token-1")).resolves.toMatchObject({
      mode: "global_settings",
      primary: {
        provider: "openai",
        model: "gpt-5.4"
      }
    });
  });

  it("updates global runtime provider settings with step-up", async () => {
    contractMocks.postAdminStepUpChallenge.mockResolvedValue({
      status: 200,
      data: {
        challenge: {
          token: "step-up-token"
        }
      }
    });
    contractMocks.putAdminRuntimeProviderSettings.mockResolvedValue({
      status: 200,
      data: {
        settings: {
          schema: "persai.adminRuntimeProviderSettings.v1",
          mode: "global_settings",
          primary: {
            provider: "openai",
            model: "gpt-5.4"
          },
          fallback: null,
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: []
          },
          providerKeys: {
            openai: {
              configured: true,
              lastFour: "1234",
              updatedAt: "2026-03-25T17:29:05.781Z"
            },
            anthropic: {
              configured: false,
              lastFour: null,
              updatedAt: null
            }
          },
          notes: []
        },
        configGeneration: 2
      }
    });

    await expect(
      putAdminRuntimeProviderSettings("token-1", {
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        },
        fallback: null,
        availableModelsByProvider: {
          openai: ["gpt-5.4"],
          anthropic: []
        },
        providerKeys: {
          openai: "sk-openai-new"
        }
      })
    ).resolves.toMatchObject({
      configGeneration: 2
    });
  });

  it("accepts 201 Created for platform rollout apply", async () => {
    contractMocks.postAdminStepUpChallenge.mockResolvedValue({
      status: 200,
      data: {
        challenge: {
          token: "step-up-token"
        }
      }
    });
    contractMocks.postAdminPlatformRollout.mockResolvedValue({
      status: 201,
      data: {
        rollout: {
          id: "rollout-1",
          status: "applied",
          rolloutPercent: 25,
          targetPatch: {},
          totalAssistants: 1,
          targetedAssistants: 1,
          applySucceededCount: 1,
          applyDegradedCount: 0,
          applyFailedCount: 0,
          rolledBackAt: null,
          createdAt: "2026-03-25T17:29:05.781Z",
          updatedAt: "2026-03-25T17:29:05.781Z"
        }
      }
    });

    await expect(
      postAdminPlatformRollout("token-1", {
        rolloutPercent: 25,
        targetPatch: {}
      })
    ).resolves.toMatchObject({
      id: "rollout-1",
      rolloutPercent: 25
    });
  });

  it("accepts 201 Created for platform rollout rollback", async () => {
    contractMocks.postAdminStepUpChallenge.mockResolvedValue({
      status: 200,
      data: {
        challenge: {
          token: "step-up-token"
        }
      }
    });
    contractMocks.postAdminPlatformRolloutRollback.mockResolvedValue({
      status: 201,
      data: {
        rollout: {
          id: "rollout-1",
          status: "rolled_back",
          rolloutPercent: 25,
          targetPatch: {},
          totalAssistants: 1,
          targetedAssistants: 1,
          applySucceededCount: 1,
          applyDegradedCount: 0,
          applyFailedCount: 0,
          rolledBackAt: "2026-03-25T17:30:00.000Z",
          createdAt: "2026-03-25T17:29:05.781Z",
          updatedAt: "2026-03-25T17:30:00.000Z"
        }
      }
    });

    await expect(postAdminPlatformRolloutRollback("token-1", "rollout-1")).resolves.toMatchObject({
      id: "rollout-1",
      status: "rolled_back"
    });
  });

  it("accepts 201 Created for telegram disconnect", async () => {
    contractMocks.postAssistantTelegramRevoke.mockResolvedValue({
      status: 201,
      data: {
        integration: {
          connectionStatus: "not_connected",
          capabilityAllowed: true
        }
      }
    });

    await expect(
      postAssistantTelegramDisconnect("token-1", { reason: "User disconnected from UI" })
    ).resolves.toMatchObject({
      connectionStatus: "not_connected"
    });
  });
});

describe("chat compaction client", () => {
  it("loads compaction state through the generated contract", async () => {
    contractMocks.getAssistantWebChatCompaction.mockResolvedValue({
      status: 200,
      data: {
        state: {
          available: true,
          suggested: true,
          suggestionReason: "token_threshold",
          messageCount: 24,
          assistantMessageCount: 12,
          currentTokens: 18250,
          sessionKey: "agent:persai:a:web:c:t",
          compactionCount: 0,
          lastCompactedAt: null,
          reserveTokens: 24000,
          keepRecentTokens: 16000
        }
      }
    });

    await expect(getChatCompactionState("token-1", "chat-1")).resolves.toMatchObject({
      available: true,
      suggested: true,
      suggestionReason: "token_threshold"
    });
    expect(contractMocks.getAssistantWebChatCompaction).toHaveBeenCalledWith("chat-1", {
      headers: { Authorization: "Bearer token-1" }
    });
  });

  it("runs manual compaction through the generated contract", async () => {
    contractMocks.postAssistantWebChatCompact.mockResolvedValue({
      status: 200,
      data: {
        state: {
          available: true,
          suggested: false,
          suggestionReason: null,
          messageCount: 24,
          assistantMessageCount: 12,
          currentTokens: 9900,
          sessionKey: "agent:persai:a:web:c:t",
          compactionCount: 1,
          lastCompactedAt: "2026-04-09T12:00:00.000Z",
          reserveTokens: 24000,
          keepRecentTokens: 16000
        },
        result: {
          compacted: true,
          reason: null,
          tokensBefore: 18250,
          tokensAfter: 9900
        }
      }
    });

    await expect(compactChat("token-1", "chat-1", "keep project decisions")).resolves.toEqual({
      state: expect.objectContaining({
        suggested: false,
        compactionCount: 1
      }),
      result: {
        compacted: true,
        reason: null,
        tokensBefore: 18250,
        tokensAfter: 9900
      }
    });
    expect(contractMocks.postAssistantWebChatCompact).toHaveBeenCalledWith(
      "chat-1",
      { instructions: "keep project decisions" },
      {
        headers: { Authorization: "Bearer token-1" }
      }
    );
  });
});

describe("streamAssistantWebChatTurn", () => {
  it("sends clientTurnId in the streaming request body", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
        ])
      ) as typeof fetch;

    await streamAssistantWebChatTurn(
      "token-1",
      { surfaceThreadKey: "thread-1", message: "Hello", clientTurnId: "turn-1" },
      {}
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/assistant/chat/web/stream"),
      expect.objectContaining({
        body: JSON.stringify({
          surfaceThreadKey: "thread-1",
          message: "Hello",
          clientTurnId: "turn-1"
        })
      })
    );
  });

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

  it("forwards compaction lifecycle events from the stream", async () => {
    const onCompaction = vi.fn();
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: compaction\ndata: ${JSON.stringify({ phase: "start", completed: false, willRetry: false })}\n\n`,
          `event: compaction\ndata: ${JSON.stringify({ phase: "end", completed: true, willRetry: false })}\n\n`,
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
        ])
      ) as typeof fetch;

    await streamAssistantWebChatTurn(
      "token-1",
      { surfaceThreadKey: "thread-1", message: "Hello" },
      { onCompaction }
    );

    expect(onCompaction).toHaveBeenNthCalledWith(1, {
      phase: "start",
      completed: false,
      willRetry: false
    });
    expect(onCompaction).toHaveBeenNthCalledWith(2, {
      phase: "end",
      completed: true,
      willRetry: false
    });
  });

  it("forwards tool lifecycle events from the stream", async () => {
    const onTool = vi.fn();
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: tool\ndata: ${JSON.stringify({ phase: "start", toolName: "summarize_context", toolCallId: "tool-1", isError: false })}\n\n`,
          `event: tool\ndata: ${JSON.stringify({ phase: "end", toolName: "summarize_context", toolCallId: "tool-1", isError: false })}\n\n`,
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
        ])
      ) as typeof fetch;

    await streamAssistantWebChatTurn(
      "token-1",
      { surfaceThreadKey: "thread-1", message: "Hello" },
      { onTool }
    );

    expect(onTool).toHaveBeenNthCalledWith(1, {
      phase: "start",
      toolName: "summarize_context",
      toolCallId: "tool-1",
      isError: false
    });
    expect(onTool).toHaveBeenNthCalledWith(2, {
      phase: "end",
      toolName: "summarize_context",
      toolCallId: "tool-1",
      isError: false
    });
  });

  it("preserves delta-before-tool ordering within a single SSE chunk", async () => {
    const order: string[] = [];
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          [
            `event: delta\ndata: ${JSON.stringify({ delta: "Preface ", accumulated: "Preface " })}\n\n`,
            `event: tool\ndata: ${JSON.stringify({ phase: "start", toolName: "summarize_context", toolCallId: "tool-1", isError: false })}\n\n`,
            `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
          ].join("")
        ])
      ) as typeof fetch;

    await streamAssistantWebChatTurn(
      "token-1",
      { surfaceThreadKey: "thread-1", message: "Hello" },
      {
        onDelta: ({ delta }) => {
          order.push(`delta:${delta}`);
        },
        onTool: ({ phase, toolName }) => {
          order.push(`tool:${phase}:${toolName}`);
        }
      }
    );

    expect(order).toEqual(["delta:Preface ", "tool:start:summarize_context"]);
  });
});

describe("toWebChatUxIssue", () => {
  it("maps tool daily limit errors to quota-style guidance", () => {
    expect(
      toWebChatUxIssue({
        code: "tool_daily_limit_reached",
        message: "Tool limit exhausted."
      })
    ).toEqual({
      classId: "quota_limit_reached",
      message: "A daily tool usage limit has been reached.",
      guidance: "Try again later or use a request that does not need the exhausted tool."
    });
  });

  it("maps token budget exhausted to billing-cycle guidance", () => {
    expect(
      toWebChatUxIssue({
        code: "token_budget_exhausted",
        message: "Monthly token budget has been exhausted."
      })
    ).toEqual({
      classId: "quota_limit_reached",
      message: "Monthly token budget has been exhausted.",
      guidance:
        "Wait for the next billing cycle or upgrade the plan to continue using the assistant."
    });
  });

  it("maps quota hard-stop to fallback-aware guidance", () => {
    expect(
      toWebChatUxIssue({
        code: "quota_limit_reached",
        message: "Quota exhausted."
      })
    ).toEqual({
      classId: "quota_limit_reached",
      message: "This turn cannot continue on the current plan limits.",
      guidance:
        "No safe fallback route is available for this request right now. Wait for quota refresh, simplify the request, or upgrade the plan."
    });
  });

  it("maps media storage quota errors to storage-specific guidance", () => {
    expect(toWebChatUxIssue(new Error("Media storage quota exceeded for this workspace."))).toEqual(
      {
        classId: "media_storage_full",
        message: "Media storage limit reached.",
        guidance: "Delete old chats or files to free up space, then try uploading again."
      }
    );
  });

  it("maps oversized file payload errors to input validation guidance", () => {
    expect(
      toWebChatUxIssue({
        code: "native_runtime_request_invalid",
        message: "Current-turn file payload is too large for direct model input."
      })
    ).toEqual({
      classId: "input_validation",
      message: "One or more attached files are too large for direct model input.",
      guidance: "Remove some files, split them across messages, or send a smaller file."
    });
  });
});
