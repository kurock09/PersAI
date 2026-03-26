import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAdminRuntimeProviderSettings,
  postAdminPlatformRollout,
  postAdminPlatformRolloutRollback,
  putAdminRuntimeProviderSettings,
  streamAssistantWebChatTurn
} from "./assistant-api-client";

const contractMocks = vi.hoisted(() => {
  return {
    postAdminStepUpChallenge: vi.fn(),
    getAdminRuntimeProviderSettings: vi.fn(),
    postAdminPlatformRollout: vi.fn(),
    postAdminPlatformRolloutRollback: vi.fn(),
    putAdminRuntimeProviderSettings: vi.fn()
  };
});

vi.mock("@persai/contracts", async () => {
  const actual = await vi.importActual<typeof import("@persai/contracts")>("@persai/contracts");
  return {
    ...actual,
    postAdminStepUpChallenge: contractMocks.postAdminStepUpChallenge,
    getAdminRuntimeProviderSettings: contractMocks.getAdminRuntimeProviderSettings,
    postAdminPlatformRollout: contractMocks.postAdminPlatformRollout,
    postAdminPlatformRolloutRollback: contractMocks.postAdminPlatformRolloutRollback,
    putAdminRuntimeProviderSettings: contractMocks.putAdminRuntimeProviderSettings
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
