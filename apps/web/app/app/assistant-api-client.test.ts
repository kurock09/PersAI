import { ContractsApiError } from "@persai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatFileUrl,
  compactChat,
  getAssistantDocumentPptxPrepareUrl,
  listChatWorkspaceFiles,
  getAssistantLifecycleView,
  getAssistantList,
  getAdminSupportAttachmentUrl,
  getChatCompactionState,
  getAdminPlatformRollouts,
  getAdminRuntimeProviderSettings,
  getSupportAttachmentUrl,
  postAssistantCreateLifecycleView,
  postAssistantSwitch,
  postAssistantBillingPaymentIntent,
  postAssistantSupportTicketRead,
  postAssistantMemoryItemCloseOpenLoop,
  postAssistantTelegramDisconnect,
  reattachAssistantWebChatTurnStream,
  REATTACH_STREAM_IDLE_TIMEOUT_MS,
  toWebChatUxIssue,
  putAdminRuntimeProviderSettings,
  stopAssistantWebChatTurn,
  streamAssistantWebChatTurn,
  getWorkspaceVideoPersonas,
  getWorkspaceVoiceCatalog,
  getWorkspaceVideoClonedVoices,
  createWorkspaceVideoClonedVoice,
  createWorkspaceVideoPersona,
  updateWorkspaceVideoPersona,
  deleteWorkspaceVideoPersona,
  archiveWorkspaceVideoClonedVoice,
  setWorkspaceVideoClonedVoiceDefault
} from "./assistant-api-client";

const SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

const contractMocks = vi.hoisted(() => {
  return {
    postAdminStepUpChallenge: vi.fn(),
    getAssistant: vi.fn(),
    getAssistantList: vi.fn(),
    getAdminPlatformRollouts: vi.fn(),
    getAdminRuntimeProviderSettings: vi.fn(),
    getAssistantWebChatCompaction: vi.fn(),
    postAssistantCreate: vi.fn(),
    postAssistantBillingPaymentIntent: vi.fn(),
    postAssistantSwitch: vi.fn(),
    postAssistantMemoryItemCloseOpenLoop: vi.fn(),
    postAssistantWebChatCompact: vi.fn(),
    putAdminRuntimeProviderSettings: vi.fn(),
    postAssistantTelegramRevoke: vi.fn()
  };
});

vi.mock("@persai/contracts", async () => {
  const actual = await vi.importActual<typeof import("@persai/contracts")>("@persai/contracts");
  return {
    ...actual,
    getAssistant: contractMocks.getAssistant,
    getAssistantList: contractMocks.getAssistantList,
    postAdminStepUpChallenge: contractMocks.postAdminStepUpChallenge,
    getAdminPlatformRollouts: contractMocks.getAdminPlatformRollouts,
    getAdminRuntimeProviderSettings: contractMocks.getAdminRuntimeProviderSettings,
    getAssistantWebChatCompaction: contractMocks.getAssistantWebChatCompaction,
    postAssistantCreate: contractMocks.postAssistantCreate,
    postAssistantBillingPaymentIntent: contractMocks.postAssistantBillingPaymentIntent,
    postAssistantSwitch: contractMocks.postAssistantSwitch,
    postAssistantMemoryItemCloseOpenLoop: contractMocks.postAssistantMemoryItemCloseOpenLoop,
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
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
});

describe("admin rollout client", () => {
  it("accepts 201 when creating a billing payment intent", async () => {
    contractMocks.postAssistantBillingPaymentIntent.mockResolvedValue({
      status: 201,
      data: {
        paymentIntent: {
          id: "pi-1"
        }
      }
    });

    await expect(
      postAssistantBillingPaymentIntent("token-1", {
        planCode: "pro",
        paymentMethodClass: "card",
        idempotencyKey: "pricing:pro:card:1",
        returnUrl: "/app/chat"
      })
    ).resolves.toMatchObject({
      id: "pi-1"
    });
  });

  it("loads global runtime provider settings", async () => {
    contractMocks.getAdminRuntimeProviderSettings.mockResolvedValue({
      status: 200,
      data: {
        settings: {
          schema: "persai.adminRuntimeProviderSettings.v2",
          mode: "global_settings",
          primary: {
            provider: "openai",
            model: "gpt-5.4"
          },
          fallback: {
            provider: "anthropic",
            model: "claude-sonnet-4-5"
          },
          routingFastModelKey: "gpt-5.4-mini",
          routerPolicy: {
            enabled: true,
            mode: "shadow",
            classifierFailureFallbackMode: "normal",
            clarifyOnMissingContext: true,
            analyzeUploadsOnB2cUpload: false,
            precheckRuleOverrides: null
          },
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: ["claude-sonnet-4-5"]
          },
          availableModelCatalogByProvider: {
            openai: { chat: ["gpt-5.4"], image: [], video: [] },
            anthropic: { chat: ["claude-sonnet-4-5"], image: [], video: [] }
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
          schema: "persai.adminRuntimeProviderSettings.v2",
          mode: "global_settings",
          primary: {
            provider: "openai",
            model: "gpt-5.4"
          },
          fallback: null,
          routingFastModelKey: "gpt-4.1",
          routerPolicy: {
            enabled: true,
            mode: "shadow",
            classifierFailureFallbackMode: "normal",
            clarifyOnMissingContext: true,
            analyzeUploadsOnB2cUpload: true,
            precheckRuleOverrides: null
          },
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: []
          },
          availableModelCatalogByProvider: {
            openai: { chat: ["gpt-5.4"], image: ["gpt-image-1.5"], video: ["sora-2"] },
            anthropic: { chat: [], image: [], video: [] }
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
        routingFastModelKey: "gpt-4.1",
        routerPolicy: {
          enabled: true,
          mode: "shadow",
          classifierFailureFallbackMode: "normal",
          clarifyOnMissingContext: true,
          analyzeUploadsOnB2cUpload: true,
          precheckRuleOverrides: null
        },
        availableModelsByProvider: {
          openai: ["gpt-5.4"],
          anthropic: [],
          deepseek: []
        },
        availableModelCatalogByProvider: {
          openai: {
            models: [
              {
                model: "gpt-5.4",
                capabilities: ["chat"],
                kind: "cinematic",
                active: true,
                billingMode: "token_metered",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  tokenPricing: {
                    inputPer1M: 0,
                    cacheCreationInputPer1M: 0,
                    cachedInputPer1M: 0,
                    outputPer1M: 0
                  }
                }
              },
              {
                model: "gpt-image-1.5",
                capabilities: ["image"],
                kind: "cinematic",
                active: true,
                billingMode: "fixed_operation",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  fixedOperationPricing: { unitLabel: null, pricePerOperation: 0 }
                }
              },
              {
                model: "sora-2",
                capabilities: ["video"],
                kind: "cinematic",
                active: true,
                billingMode: "fixed_operation",
                effectiveFrom: null,
                effectiveTo: null,
                inputTokenWeight: 1,
                cachedInputTokenWeight: 1,
                outputTokenWeight: 1,
                displayLabel: null,
                notes: null,
                providerPriceMetadata: {
                  currency: "USD",
                  fixedOperationPricing: { unitLabel: null, pricePerOperation: 0 }
                }
              }
            ]
          },
          deepseek: { models: [] },
          anthropic: { models: [] },
          runway: { models: [] },
          kling: { models: [] },
          heygen: { models: [] }
        },
        providerKeys: {
          openai: "sk-openai-new"
        }
      })
    ).resolves.toMatchObject({
      configGeneration: 2
    });
  });

  it("loads materialization rollouts from admin dashboard endpoint", async () => {
    contractMocks.getAdminPlatformRollouts.mockResolvedValue({
      status: 200,
      data: {
        rollouts: [
          {
            id: "rollout-1",
            rolloutType: "manual_reapply",
            targetGeneration: 42,
            totalItems: 3,
            pendingCount: 1,
            runningCount: 1,
            succeededCount: 1,
            degradedCount: 0,
            failedCount: 0,
            skippedCount: 0,
            cancelledCount: 0,
            status: "running",
            startedAt: "2026-03-25T17:30:00.000Z",
            finishedAt: null,
            createdAt: "2026-03-25T17:29:05.781Z",
            updatedAt: "2026-03-25T17:30:00.000Z"
          }
        ]
      }
    });

    await expect(getAdminPlatformRollouts("token-1")).resolves.toMatchObject([
      {
        id: "rollout-1",
        rolloutType: "manual_reapply",
        targetGeneration: 42,
        status: "running"
      }
    ]);
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

describe("memory center close-open-loop client (ADR-074 M3.1)", () => {
  it("treats `closed` as success", async () => {
    contractMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue({
      status: 200,
      data: {
        requestId: null,
        closed: true,
        closedItemId: "loop-1",
        reason: "closed"
      }
    });

    await expect(
      postAssistantMemoryItemCloseOpenLoop("token-1", "loop-1")
    ).resolves.toBeUndefined();
    expect(contractMocks.postAssistantMemoryItemCloseOpenLoop).toHaveBeenCalledWith("loop-1", {
      headers: { Authorization: "Bearer token-1" }
    });
  });

  it("treats `already_closed` as idempotent success", async () => {
    contractMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue({
      status: 200,
      data: {
        requestId: null,
        closed: true,
        closedItemId: "loop-1",
        reason: "already_closed"
      }
    });

    await expect(
      postAssistantMemoryItemCloseOpenLoop("token-1", "loop-1")
    ).resolves.toBeUndefined();
  });

  it("rejects on non-success HTTP status", async () => {
    contractMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue({
      status: 404,
      data: { message: "Memory item not found." }
    });

    await expect(postAssistantMemoryItemCloseOpenLoop("token-1", "loop-missing")).rejects.toThrow();
  });

  // ADR-074 Slice M3.3 — the Memory Center "Mark as closed" hotfix
  // depends on these errors actually surfacing through the API client so
  // the frontend can render the inline error instead of swallowing it.
  it("propagates 400 (kind != open_loop) so the UI can render an inline error", async () => {
    contractMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue({
      status: 400,
      data: { message: "Memory item is not an open_loop." }
    });

    await expect(postAssistantMemoryItemCloseOpenLoop("token-1", "loop-fact")).rejects.toThrow();
  });

  it("propagates 409 (envelope conflict) so the UI can render an inline error", async () => {
    contractMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue({
      status: 409,
      data: { message: "Capability not allowed by current envelope." }
    });

    await expect(postAssistantMemoryItemCloseOpenLoop("token-1", "loop-1")).rejects.toThrow();
  });

  it("rejects on a malformed body that is missing `closed`", async () => {
    contractMocks.postAssistantMemoryItemCloseOpenLoop.mockResolvedValue({
      status: 200,
      data: { requestId: null }
    });

    await expect(postAssistantMemoryItemCloseOpenLoop("token-1", "loop-1")).rejects.toThrow();
  });
});

describe("assistant files client", () => {
  it("returns the path-based chat file url by default", () => {
    expect(
      buildChatFileUrl({
        chatId: "chat-1",
        storagePath: `${SESSION_ROOT}/photo.jpg`
      })
    ).toBe(
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fphoto.jpg"
    );
  });

  it("adds explicit chat file download mode when requested", () => {
    expect(
      buildChatFileUrl({
        chatId: "chat-1",
        storagePath: `${SESSION_ROOT}/photo.jpg`,
        download: true
      })
    ).toBe(
      "/api/v1/assistant/chats/web/chat-1/files?path=%2Fworkspace%2Fassistants%2Fassistant-1%2Fsessions%2Fruntime-session-1%2Fphoto.jpg&download=1"
    );
  });

  it("builds a version-aware original presentation download url", () => {
    expect(getAssistantDocumentPptxPrepareUrl("doc-1", { versionId: "version-1" })).toBe(
      "/api/assistant-document/doc-1/prepare-pptx?versionId=version-1"
    );
  });

  it("builds cookie-auth support attachment urls through the web BFF routes", () => {
    expect(getSupportAttachmentUrl("attachment-1")).toBe("/api/support-attachment/attachment-1");
    expect(getAdminSupportAttachmentUrl("attachment-2")).toBe(
      "/api/admin-support-attachment/attachment-2"
    );
  });

  it("marks support tickets read through the dedicated cookie-auth BFF route in the browser", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ticket: {
            id: "ticket-1",
            shortId: "TICKET01",
            status: "answered",
            subject: null,
            preview: "Preview",
            createdAt: "2026-05-22T08:00:00.000Z",
            updatedAt: "2026-05-22T08:01:00.000Z",
            answeredAt: "2026-05-22T08:01:00.000Z",
            closedAt: null,
            hasUnread: false,
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            userId: "user-1",
            userEmail: "user@example.com",
            assistantDisplayName: "PersAI",
            messages: []
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    await expect(postAssistantSupportTicketRead("token-1", "ticket-1")).resolves.toMatchObject({
      id: "ticket-1",
      hasUnread: false
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/support-ticket/ticket-1/read", {
      method: "POST",
      credentials: "include",
      headers: {
        "x-persai-session-token": "token-1"
      }
    });
  });

  it("loads assistant-scoped workspace files with type and limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          files: [
            {
              storagePath: `${SESSION_ROOT}/spec.pdf`,
              thumbnailStoragePath: null,
              posterStoragePath: null,
              originalFilename: "spec.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              attachmentType: "document",
              createdAt: "2026-05-02T00:00:00.000Z",
              chatId: "chat-1",
              messageId: "msg-1"
            }
          ],
          nextCursor: null
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    global.fetch = fetchMock;

    await expect(
      listChatWorkspaceFiles("token-1", {
        chatId: "chat-1",
        scope: "assistant",
        type: "document",
        limit: 20
      })
    ).resolves.toEqual({
      files: [
        {
          storagePath: `${SESSION_ROOT}/spec.pdf`,
          thumbnailStoragePath: null,
          posterStoragePath: null,
          originalFilename: "spec.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          attachmentType: "document",
          createdAt: "2026-05-02T00:00:00.000Z",
          chatId: "chat-1",
          messageId: "msg-1"
        }
      ],
      nextCursor: null
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/assistant/chats/web/chat-1/workspace-files?scope=assistant&type=document&limit=20",
      {
        headers: { Authorization: "Bearer token-1" }
      }
    );
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
          exhaustedAtPlanLimit: false,
          recentAutoCompactionStreak: 0,
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
          exhaustedAtPlanLimit: false,
          recentAutoCompactionStreak: 0,
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

  it("ignores localhost NEXT_PUBLIC_API_BASE_URL in the browser and falls back to same-origin api", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001/api/v1";
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
        ])
      ) as typeof fetch;

    await streamAssistantWebChatTurn(
      "token-1",
      { surfaceThreadKey: "thread-1", message: "Hello" },
      {}
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/assistant/chat/web/stream",
      expect.objectContaining({
        method: "POST"
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

  it("dispatches pending_browser_login mid-stream without waiting for completed", async () => {
    const onPendingBrowserLogin = vi.fn();
    const pendingBrowserLogin = {
      profileId: "profile-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      liveUrl: "https://browserless.example/live/bitrix",
      loginUrl: "https://example.bitrix24.ru/login"
    };
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: started\ndata: ${JSON.stringify({ chat: { id: "chat-1" }, userMessage: { id: "msg-1" } })}\n\n`,
          `event: pending_browser_login\ndata: ${JSON.stringify({ pendingBrowserLogin })}\n\n`,
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
        ])
      ) as typeof fetch;

    await streamAssistantWebChatTurn(
      "token-1",
      { surfaceThreadKey: "thread-1", message: "Hello" },
      { onPendingBrowserLogin }
    );

    expect(onPendingBrowserLogin).toHaveBeenCalledWith({ pendingBrowserLogin });
  });

  it("ignores keepalive comment blocks while waiting for the terminal event", async () => {
    const onCompleted = vi.fn();
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: started\ndata: ${JSON.stringify({ chat: { id: "chat-1" }, userMessage: { id: "msg-1" } })}\n\n`,
          `: keepalive\n\n`,
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
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

  it("preserves Skill metadata on activity stream events", async () => {
    const onActivity = vi.fn();
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: activity\ndata: ${JSON.stringify({ source: "skill", phase: "start", resultCount: 0, skillName: "Диетолог", skillIconEmoji: "🥦" })}\n\n`,
          `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}\n\n`
        ])
      ) as typeof fetch;

    await streamAssistantWebChatTurn(
      "token-1",
      { surfaceThreadKey: "thread-1", message: "Hello" },
      { onActivity }
    );

    expect(onActivity).toHaveBeenCalledWith({
      source: "skill",
      phase: "start",
      resultCount: 0,
      skillName: "Диетолог",
      skillIconEmoji: "🥦"
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

// ADR-109 Slice 10c — Fix #1: URL double-prefix regression guard
// getApiBaseUrl() already returns /api/v1 (or http://localhost:3001/api/v1 for SSR).
// Slice 9 methods must NOT add /api/v1 again.
describe("video-persona client URL shape (Slice 9 double-prefix fix)", () => {
  const WORKSPACE_ID = "ws-test-123";
  const PERSONA_ID = "persona-abc";
  const CLONED_VOICE_ID = "clone-abc";

  function stubOkFetch(body: unknown): void {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
      status: 200
    }) as typeof fetch;
  }

  function stubOkFetchNoBody(): void {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204
    }) as typeof fetch;
  }

  it("getWorkspaceVideoPersonas does not double-prefix api/v1 and targets /workspaces/:id/video-personas", async () => {
    stubOkFetch({ personas: [] });
    await getWorkspaceVideoPersonas("tok", WORKSPACE_ID);
    const url = ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(`/workspaces/${WORKSPACE_ID}/video-personas`);
  });

  it("getWorkspaceVoiceCatalog does not double-prefix api/v1 and targets /workspaces/:id/video-personas/voice-catalog", async () => {
    stubOkFetch({ provider: "heygen", voices: [] });
    await getWorkspaceVoiceCatalog("tok", WORKSPACE_ID);
    const url = ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(`/workspaces/${WORKSPACE_ID}/video-personas/voice-catalog`);
  });

  it("createWorkspaceVideoPersona does not double-prefix api/v1 and targets /workspaces/:id/video-personas", async () => {
    stubOkFetch({ persona: { id: PERSONA_ID }, walletBalanceVc: 100, storageWarning: null });
    const fakeFile = new File(["portrait"], "portrait.jpg", { type: "image/jpeg" });
    await createWorkspaceVideoPersona("tok", WORKSPACE_ID, {
      displayName: "Alice",
      videoFormat: "1:1",
      heygenVoiceId: "voice-1",
      portrait: fakeFile
    });
    const url = ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(`/workspaces/${WORKSPACE_ID}/video-personas`);
  });

  it("deleteWorkspaceVideoPersona does not double-prefix api/v1 and targets /workspaces/:id/video-personas/:personaId", async () => {
    stubOkFetchNoBody();
    await deleteWorkspaceVideoPersona("tok", WORKSPACE_ID, PERSONA_ID);
    const url = ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(`/workspaces/${WORKSPACE_ID}/video-personas/${PERSONA_ID}`);
  });

  it("getWorkspaceVideoClonedVoices does not double-prefix api/v1 and targets /workspaces/:id/video-cloned-voices", async () => {
    stubOkFetch({ clonedVoices: [], limit: 5, creationVcoinCost: 50 });
    await getWorkspaceVideoClonedVoices("tok", WORKSPACE_ID);
    const url = ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(`/workspaces/${WORKSPACE_ID}/video-cloned-voices`);
  });

  it("createWorkspaceVideoClonedVoice uploads to /workspaces/:id/video-cloned-voices without double-prefix", async () => {
    const originalXhr = global.XMLHttpRequest;
    const xhrState: {
      url: string | null;
      body: FormData | null;
      authHeader: string | null;
    } = {
      url: null,
      body: null,
      authHeader: null
    };

    class MockXmlHttpRequest {
      upload = { addEventListener: vi.fn() };
      status = 200;
      statusText = "OK";
      responseText = JSON.stringify({
        clonedVoice: { id: CLONED_VOICE_ID, displayName: "Brand Voice", status: "ready" },
        walletBalanceVc: 75
      });
      private listeners = new Map<string, Array<() => void>>();

      open(_method: string, url: string) {
        xhrState.url = url;
      }

      setRequestHeader(name: string, value: string) {
        if (name.toLowerCase() === "authorization") {
          xhrState.authHeader = value;
        }
      }

      addEventListener(event: string, listener: () => void) {
        const current = this.listeners.get(event) ?? [];
        current.push(listener);
        this.listeners.set(event, current);
      }

      getAllResponseHeaders() {
        return "content-type: application/json\r\n";
      }

      abort() {}

      send(body: FormData) {
        xhrState.body = body;
        for (const listener of this.listeners.get("load") ?? []) {
          listener();
        }
      }
    }

    // @ts-expect-error test stub
    global.XMLHttpRequest = MockXmlHttpRequest;

    try {
      const audioFile = new File(["voice"], "voice.webm", { type: "audio/webm" });
      await createWorkspaceVideoClonedVoice("tok", WORKSPACE_ID, {
        displayName: "Brand Voice",
        audio: audioFile,
        languageHint: "en",
        removeBackgroundNoise: true
      });
    } finally {
      global.XMLHttpRequest = originalXhr;
    }

    expect(xhrState.url).not.toContain("api/v1/api/v1");
    expect(xhrState.url).toContain(`/workspaces/${WORKSPACE_ID}/video-cloned-voices`);
    expect(xhrState.authHeader).toBe("Bearer tok");
    expect(xhrState.body?.get("displayName")).toBe("Brand Voice");
    expect(xhrState.body?.get("languageHint")).toBe("en");
    expect(xhrState.body?.get("removeBackgroundNoise")).toBe("true");
    expect(xhrState.body?.get("audio")).toBeInstanceOf(File);
  });

  it("archiveWorkspaceVideoClonedVoice does not double-prefix api/v1 and targets /workspaces/:id/video-cloned-voices/:clonedVoiceId", async () => {
    stubOkFetchNoBody();
    await archiveWorkspaceVideoClonedVoice("tok", WORKSPACE_ID, CLONED_VOICE_ID);
    const url = ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(`/workspaces/${WORKSPACE_ID}/video-cloned-voices/${CLONED_VOICE_ID}`);
  });

  it("setWorkspaceVideoClonedVoiceDefault does not double-prefix api/v1 and targets /workspaces/:id/video-cloned-voices/:clonedVoiceId/default", async () => {
    stubOkFetch({ clonedVoice: { id: CLONED_VOICE_ID } });
    await setWorkspaceVideoClonedVoiceDefault("tok", WORKSPACE_ID, CLONED_VOICE_ID);
    const url = ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(
      `/workspaces/${WORKSPACE_ID}/video-cloned-voices/${CLONED_VOICE_ID}/default`
    );
  });
});

describe("video persona cloned voice forwarding", () => {
  const WORKSPACE_ID = "ws-forward-123";
  const PERSONA_ID = "persona-forward-123";

  it("createWorkspaceVideoPersona forwards clonedVoiceId alongside heygenVoiceId", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        persona: {
          id: PERSONA_ID,
          clonedVoiceId: "clone-1",
          clonedVoiceDisplayName: "Brand Voice"
        },
        walletBalanceVc: 90,
        storageWarning: null
      })
    }) as typeof fetch;

    const fakeFile = new File(["portrait"], "portrait.jpg", { type: "image/jpeg" });
    await createWorkspaceVideoPersona("tok", WORKSPACE_ID, {
      displayName: "Alice",
      videoFormat: "9:16",
      heygenVoiceId: "voice-1",
      clonedVoiceId: "clone-1",
      portrait: fakeFile
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: FormData }
    ];
    expect(init.body.get("displayName")).toBe("Alice");
    expect(init.body.get("heygenVoiceId")).toBe("voice-1");
    expect(init.body.get("clonedVoiceId")).toBe("clone-1");
  });

  it("updateWorkspaceVideoPersona forwards clonedVoiceId without double-prefix", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        persona: {
          id: PERSONA_ID,
          clonedVoiceId: "clone-2",
          clonedVoiceDisplayName: "Founder Voice"
        }
      })
    }) as typeof fetch;

    await updateWorkspaceVideoPersona("tok", WORKSPACE_ID, PERSONA_ID, {
      displayName: "Alice",
      heygenVoiceId: "voice-1",
      clonedVoiceId: "clone-2"
    });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string }
    ];
    expect(url).not.toContain("api/v1/api/v1");
    expect(url).toContain(`/workspaces/${WORKSPACE_ID}/video-personas/${PERSONA_ID}`);
    expect(JSON.parse(init.body)).toEqual({
      displayName: "Alice",
      heygenVoiceId: "voice-1",
      clonedVoiceId: "clone-2"
    });
  });
});

describe("reattachAssistantWebChatTurnStream", () => {
  it("flushes the trailing SSE block when the connection closes without a final blank line", async () => {
    // Pre-fix the reattach reader exited the read loop on `done=true`
    // without flushing the in-buffer last block, so a server-sent
    // `completed` frame that arrived without a trailing `\n\n` was
    // silently dropped — leaving the client perpetually in
    // "Stream closed before terminal event" retry loops.
    const onCompleted = vi.fn();
    global.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        `event: turn_status\ndata: ${JSON.stringify({ turn: { status: "running", chat: null, userMessage: null, assistantMessage: null, currentActivity: null, runtime: null, error: null } })}\n\n`,
        // Last frame deliberately has NO trailing `\n\n`
        `event: completed\ndata: ${JSON.stringify({ transport: { mode: "sse" } })}`
      ])
    ) as typeof fetch;

    await expect(
      reattachAssistantWebChatTurnStream("token-1", "turn-1", { onCompleted })
    ).resolves.toBeUndefined();

    expect(onCompleted).toHaveBeenCalledWith({ transport: { mode: "sse" } });
  });

  it("rejects when the reattach stream closes with no terminal event at all", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          `event: turn_status\ndata: ${JSON.stringify({ turn: { status: "running", chat: null, userMessage: null, assistantMessage: null, currentActivity: null, runtime: null, error: null } })}\n\n`
        ])
      ) as typeof fetch;

    await expect(reattachAssistantWebChatTurnStream("token-1", "turn-1", {})).rejects.toThrow(
      /Stream closed before terminal event/
    );
  });

  it("rejects when the reattach stream stays open without a terminal event", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: turn_status\ndata: ${JSON.stringify({ turn: { status: "running", chat: null, userMessage: null, assistantMessage: null, currentActivity: null, runtime: null, error: null } })}\n\n`
          )
        );
      }
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    ) as typeof fetch;

    try {
      const reattachExpectation = expect(
        reattachAssistantWebChatTurnStream("token-1", "turn-1", {})
      ).rejects.toThrow(/Reattach stream stalled/);
      await vi.advanceTimersByTimeAsync(REATTACH_STREAM_IDLE_TIMEOUT_MS + 1);
      await reattachExpectation;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("assistant lifecycle client", () => {
  it("falls back to /assistant/list when GET /assistant returns 404", async () => {
    contractMocks.getAssistant.mockResolvedValue({
      status: 404,
      data: { error: { code: "not_found", message: "Missing." } }
    });
    contractMocks.getAssistantList.mockResolvedValue({
      status: 200,
      data: {
        assistants: [
          {
            id: "assistant-1",
            displayName: "Alpha",
            avatarEmoji: null,
            avatarUrl: null,
            createdAt: "2026-05-26T14:00:00.000Z",
            updatedAt: "2026-05-26T14:00:00.000Z"
          }
        ],
        activeAssistantId: null,
        assistantLimit: { usedAssistants: 0, maxAssistants: 3 }
      }
    });

    await expect(getAssistantLifecycleView("token-1")).resolves.toEqual({
      assistant: null,
      assistants: [
        {
          id: "assistant-1",
          displayName: "Alpha",
          avatarEmoji: null,
          avatarUrl: null,
          createdAt: "2026-05-26T14:00:00.000Z",
          updatedAt: "2026-05-26T14:00:00.000Z"
        }
      ],
      activeAssistantId: null,
      assistantLimit: { usedAssistants: 0, maxAssistants: 3 }
    });
  });

  it("lists assistants from the generated contract client", async () => {
    contractMocks.getAssistantList.mockResolvedValue({
      status: 200,
      data: {
        assistants: [],
        activeAssistantId: "assistant-2",
        assistantLimit: { usedAssistants: 2, maxAssistants: 3 }
      }
    });

    await expect(getAssistantList("token-1")).resolves.toEqual({
      assistants: [],
      activeAssistantId: "assistant-2",
      assistantLimit: { usedAssistants: 2, maxAssistants: 3 }
    });
  });

  it("returns active/list metadata from the create assistant contract", async () => {
    contractMocks.postAssistantCreate.mockResolvedValue({
      status: 200,
      data: {
        assistant: {
          id: "assistant-3",
          userId: "user-1",
          workspaceId: "ws-1",
          draft: {
            displayName: "Gamma",
            instructions: null,
            traits: null,
            avatarEmoji: null,
            avatarUrl: null,
            assistantGender: null,
            voiceProfile: {
              schema: "persai.runtimeAssistantVoiceProfile.v1",
              voiceId: null,
              stylePrompt: null,
              speakingRate: null
            },
            archetypeKey: null,
            updatedAt: null
          },
          latestPublishedVersion: null,
          runtimeApply: {
            status: "not_requested",
            targetPublishedVersionId: null,
            appliedPublishedVersionId: null,
            requestedAt: null,
            startedAt: null,
            finishedAt: null,
            error: null
          },
          governance: {
            capabilityEnvelope: null,
            secretRefs: null,
            policyEnvelope: null,
            runtimeTierOverride: null,
            memoryControl: null,
            tasksControl: null,
            assistantPlanOverrideCode: null,
            quotaPlanCode: null,
            quotaHook: null,
            auditHook: null,
            platformManagedUpdatedAt: null
          },
          materialization: {
            latestSpecId: null,
            publishedVersionId: null,
            sourceAction: null,
            algorithmVersion: null,
            contentHash: null,
            generatedAt: null,
            runtimeAssignment: null,
            assistantConfigDocument: null,
            assistantWorkspaceDocument: null
          },
          createdAt: "2026-05-26T14:00:00.000Z",
          updatedAt: "2026-05-26T14:00:00.000Z"
        },
        assistants: [],
        activeAssistantId: "assistant-3",
        assistantLimit: { usedAssistants: 3, maxAssistants: 3 }
      }
    });

    await expect(postAssistantCreateLifecycleView("token-1")).resolves.toMatchObject({
      assistant: { id: "assistant-3" },
      activeAssistantId: "assistant-3",
      assistantLimit: { usedAssistants: 3, maxAssistants: 3 }
    });
  });

  it("switches active assistant through the generated contract client", async () => {
    contractMocks.postAssistantSwitch.mockResolvedValue({
      status: 200,
      data: {
        assistant: {
          id: "assistant-2",
          userId: "user-1",
          workspaceId: "ws-1",
          draft: {
            displayName: "Beta",
            instructions: null,
            traits: null,
            avatarEmoji: null,
            avatarUrl: null,
            assistantGender: null,
            voiceProfile: {
              schema: "persai.runtimeAssistantVoiceProfile.v1",
              voiceId: null,
              stylePrompt: null,
              speakingRate: null
            },
            archetypeKey: null,
            updatedAt: null
          },
          latestPublishedVersion: null,
          runtimeApply: {
            status: "not_requested",
            targetPublishedVersionId: null,
            appliedPublishedVersionId: null,
            requestedAt: null,
            startedAt: null,
            finishedAt: null,
            error: null
          },
          governance: {
            capabilityEnvelope: null,
            secretRefs: null,
            policyEnvelope: null,
            runtimeTierOverride: null,
            memoryControl: null,
            tasksControl: null,
            assistantPlanOverrideCode: null,
            quotaPlanCode: null,
            quotaHook: null,
            auditHook: null,
            platformManagedUpdatedAt: null
          },
          materialization: {
            latestSpecId: null,
            publishedVersionId: null,
            sourceAction: null,
            algorithmVersion: null,
            contentHash: null,
            generatedAt: null,
            runtimeAssignment: null,
            assistantConfigDocument: null,
            assistantWorkspaceDocument: null
          },
          createdAt: "2026-05-26T14:00:00.000Z",
          updatedAt: "2026-05-26T14:00:00.000Z"
        },
        assistants: [],
        activeAssistantId: "assistant-2",
        assistantLimit: { usedAssistants: 2, maxAssistants: 3 }
      }
    });

    await expect(postAssistantSwitch("token-1", "assistant-2")).resolves.toMatchObject({
      assistant: { id: "assistant-2" },
      activeAssistantId: "assistant-2"
    });
    expect(contractMocks.postAssistantSwitch).toHaveBeenCalledWith(
      { assistantId: "assistant-2" },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token-1" })
      })
    );
  });
});

describe("stopAssistantWebChatTurn (FIX 1 / Slice 1.2)", () => {
  it("POSTs the clientTurnId to /assistant/chat/web/stop with the bearer token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
      text: async () => ""
    } as Response) as typeof fetch;

    await stopAssistantWebChatTurn("token-1", "turn-42");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/assistant/chat/web/stop"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({ clientTurnId: "turn-42" })
      })
    );
  });

  it("resolves cleanly on a 204 No Content response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
      text: async () => ""
    } as Response) as typeof fetch;

    await expect(stopAssistantWebChatTurn("token-1", "turn-42")).resolves.toBeUndefined();
  });

  it("throws ContractsApiError on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "unauthorized" } }),
      text: async () => ""
    } as Response) as typeof fetch;

    await expect(stopAssistantWebChatTurn("token-1", "turn-42")).rejects.toThrow(
      /Stop request failed with status 401/
    );
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
      message: "Tool limit exhausted.",
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
      message: "Quota exhausted.",
      guidance:
        "No safe fallback route is available for this request right now. Wait for quota refresh, simplify the request, or upgrade the plan."
    });
  });

  it("prefers structured guidance from ContractsApiError payloads", () => {
    expect(
      toWebChatUxIssue(
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
      )
    ).toEqual({
      classId: "quota_limit_reached",
      message: "Browser is exhausted for the current daily limit.",
      guidance: "Try a request that does not need Browser until the daily limit resets."
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

  it("maps empty voice transcription to a dedicated retryable issue", () => {
    expect(toWebChatUxIssue(new Error("Voice transcription returned empty text."))).toEqual({
      classId: "voice_transcription_empty",
      message: "No speech was detected in your recording.",
      guidance:
        "Check that the correct microphone is selected in your browser settings and that it is not muted."
    });
  });

  it("maps explicit empty voice transcription codes to the localized retry issue", () => {
    expect(
      toWebChatUxIssue({
        code: "voice_transcription_empty",
        message: "Voice transcription failed."
      })
    ).toEqual({
      classId: "voice_transcription_empty",
      message: "No speech was detected in your recording.",
      guidance:
        "Check that the correct microphone is selected in your browser settings and that it is not muted."
    });
  });

  it("maps provider-shaped voice transcription failures before generic provider issues", () => {
    expect(
      toWebChatUxIssue({
        code: "provider_timeout",
        message: "Voice transcription provider did not respond."
      })
    ).toEqual({
      classId: "voice_transcription_empty",
      message: "No speech was detected in your recording.",
      guidance:
        "Check that the correct microphone is selected in your browser settings and that it is not muted."
    });
  });

  it("maps monthly media quota errors to billing-period guidance", () => {
    expect(
      toWebChatUxIssue({
        code: "monthly_media_quota_exceeded",
        message: "Monthly media quota reached."
      })
    ).toEqual({
      classId: "quota_limit_reached",
      message: "Monthly media quota reached.",
      guidance:
        "Wait for the next billing cycle, upgrade the plan, or use a request that does not need media generation."
    });
  });

  it("does not present rate limiting as a quota banner", () => {
    expect(
      toWebChatUxIssue({
        code: "rate_limited",
        message: "Requests are temporarily limited right now."
      })
    ).toEqual({
      classId: "channel_failure",
      message: "Requests are temporarily limited right now.",
      guidance: "Wait a moment, then retry the same thread."
    });
  });

  it("maps safety restrictions separately from rate limiting", () => {
    expect(
      toWebChatUxIssue({
        code: "safety_restricted",
        message:
          "This message could not be processed because inbound access is restricted by platform safety policy.",
        details: { reasonCode: "violence_extremism" }
      })
    ).toEqual({
      classId: "safety_restricted",
      message: "",
      guidance: "",
      data: { reasonCode: "violence_extremism" }
    });
  });

  it("maps assistant activating to a dedicated activation issue", () => {
    expect(
      toWebChatUxIssue({
        code: "assistant_activating",
        message: "Assistant settings are still activating."
      })
    ).toEqual({
      classId: "assistant_activating",
      message: "Your assistant settings are still activating.",
      guidance: "Wait a moment, then retry in the same thread."
    });
  });

  it("maps assistant activation failure to admin rollout guidance", () => {
    expect(
      toWebChatUxIssue({
        code: "assistant_activation_failed",
        message: "Assistant settings activation failed."
      })
    ).toEqual({
      classId: "assistant_activation_failed",
      message: "Assistant settings activation failed.",
      guidance: "Retry the rollout in Admin > Rollouts, then try again."
    });
  });
});

describe("getAssistantWebChatPlan", () => {
  beforeEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("returns the plan response on success", async () => {
    const { getAssistantWebChatPlan } = await import("./assistant-api-client");
    const planBody = {
      requestId: "r1",
      chatId: "chat-abc",
      todos: [
        {
          id: "t1",
          parentId: null,
          content: "Do a thing",
          status: "pending"
        }
      ],
      windowed: false,
      totalCount: 1
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => planBody
    } as unknown as Response);

    const result = await getAssistantWebChatPlan("token-123", "chat-abc");
    expect(result).toEqual(planBody);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/assistant/chats/web/chat-abc/plan"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token-123" })
      })
    );
  });

  it("throws on non-2xx response", async () => {
    const { getAssistantWebChatPlan } = await import("./assistant-api-client");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    } as unknown as Response);

    await expect(getAssistantWebChatPlan("token-123", "chat-404")).rejects.toThrow(
      "Failed to load chat plan (404)."
    );
  });

  it("throws when token is null", async () => {
    const { getAssistantWebChatPlan } = await import("./assistant-api-client");
    await expect(getAssistantWebChatPlan(null, "chat-abc")).rejects.toThrow("Not authenticated.");
  });
});

describe("clearAssistantWebChatPlan", () => {
  beforeEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("resolves on 204 success", async () => {
    const { clearAssistantWebChatPlan } = await import("./assistant-api-client");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204
    } as unknown as Response);

    await expect(clearAssistantWebChatPlan("token-123", "chat-abc")).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/assistant/chats/web/chat-abc/plan"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("throws on 500 error", async () => {
    const { clearAssistantWebChatPlan } = await import("./assistant-api-client");
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    } as unknown as Response);

    await expect(clearAssistantWebChatPlan("token-123", "chat-abc")).rejects.toThrow(
      "Failed to clear chat plan (500)."
    );
  });

  it("throws when token is null", async () => {
    const { clearAssistantWebChatPlan } = await import("./assistant-api-client");
    await expect(clearAssistantWebChatPlan(null, "chat-abc")).rejects.toThrow("Not authenticated.");
  });
});
