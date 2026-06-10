"use client";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiStructuredError } from "../assistant-api-client";
import { requestAudioFocus } from "../../lib/audio-focus";
import { useLiveVoice } from "./use-live-voice";

const conversationMocks = vi.hoisted(() => {
  let latestOptions: Record<string, unknown> | null = null;

  const endSession = vi.fn(async () => undefined);
  const startSession = vi.fn(async (options: Record<string, unknown>) => {
    latestOptions = options;
    return {
      endSession
    };
  });

  return {
    endSession,
    startSession,
    getLatestOptions: () => latestOptions
  };
});

const apiClientMocks = vi.hoisted(() => ({
  buildLiveVoiceRelayUrl: vi.fn(
    (path: string, ticket: string) => `wss://relay.test${path}?ticket=${ticket}`
  ),
  startLiveVoiceSession: vi.fn(),
  stopLiveVoiceSession: vi.fn()
}));

const audioFocusMocks = vi.hoisted(() => ({
  requestAudioFocus: vi.fn(() => vi.fn())
}));

vi.mock("@elevenlabs/client", () => ({
  Conversation: {
    startSession: conversationMocks.startSession
  }
}));

vi.mock("../assistant-api-client", async () => {
  const actual =
    await vi.importActual<typeof import("../assistant-api-client")>("../assistant-api-client");
  return {
    ...actual,
    buildLiveVoiceRelayUrl: apiClientMocks.buildLiveVoiceRelayUrl,
    startLiveVoiceSession: apiClientMocks.startLiveVoiceSession,
    stopLiveVoiceSession: apiClientMocks.stopLiveVoiceSession
  };
});

vi.mock("../../lib/audio-focus", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/audio-focus")>("../../lib/audio-focus");
  return {
    ...actual,
    requestAudioFocus: audioFocusMocks.requestAudioFocus
  };
});

function createStartResponse(overrides?: {
  preferRelay?: boolean;
  relay?: { path: string; ticket: string; expiresAt: string } | undefined;
  connectionType?: "webrtc" | "websocket";
  conversationToken?: string | undefined;
  signedUrl?: string | undefined;
}) {
  return {
    session: {
      id: "session-1",
      chatId: "chat-1",
      status: "active",
      selectedVoiceId: "voice-123",
      transportProtocol: overrides?.connectionType ?? "webrtc",
      transportRoute: overrides?.preferRelay ? "relay" : "direct",
      startedAt: "2026-06-10T12:00:00.000Z"
    },
    transport: {
      protocol: overrides?.connectionType ?? "webrtc",
      route: overrides?.preferRelay ? "relay" : "direct",
      credential: {
        ...(overrides?.conversationToken ? { conversationToken: overrides.conversationToken } : {}),
        ...(overrides?.signedUrl ? { signedUrl: overrides.signedUrl } : {})
      }
    },
    clientConfig: {
      agentId: "agent-1",
      connectionType: overrides?.connectionType ?? "webrtc",
      overrides: {
        voiceId: "voice-123",
        language: "en"
      },
      customLlmExtraBody: {
        persaiLiveVoiceSessionId: "session-1"
      },
      preferRelay: overrides?.preferRelay ?? false,
      ...(overrides?.relay ? { relay: overrides.relay } : {})
    }
  };
}

describe("useLiveVoice", () => {
  let mediaTrackStop: ReturnType<typeof vi.fn>;
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let releaseFocus: ReturnType<typeof vi.fn>;
  let originalActEnvironment: unknown;

  beforeEach(() => {
    originalActEnvironment = (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: unknown }
    ).IS_REACT_ACT_ENVIRONMENT;
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    mediaTrackStop = vi.fn();
    getUserMediaMock = vi.fn(async () => ({
      getTracks: () => [{ stop: mediaTrackStop }]
    }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: getUserMediaMock
      }
    });

    releaseFocus = vi.fn();
    apiClientMocks.buildLiveVoiceRelayUrl.mockClear();
    apiClientMocks.startLiveVoiceSession.mockReset();
    apiClientMocks.stopLiveVoiceSession.mockReset();
    apiClientMocks.stopLiveVoiceSession.mockResolvedValue({
      id: "session-1",
      chatId: "chat-1",
      status: "stopped",
      selectedVoiceId: "voice-123",
      transportProtocol: "webrtc",
      transportRoute: "direct",
      startedAt: "2026-06-10T12:00:00.000Z",
      stoppedAt: "2026-06-10T12:01:00.000Z"
    });
    audioFocusMocks.requestAudioFocus.mockReset();
    audioFocusMocks.requestAudioFocus.mockImplementation(() => releaseFocus);
    conversationMocks.endSession.mockClear();
    conversationMocks.startSession.mockReset();
    conversationMocks.startSession.mockImplementation(async () => {
      return {
        endSession: conversationMocks.endSession
      };
    });
  });

  afterEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: unknown;
      }
    ).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    vi.restoreAllMocks();
  });

  it("starts a direct WebRTC session with the correct options", async () => {
    apiClientMocks.startLiveVoiceSession.mockResolvedValue(
      createStartResponse({
        connectionType: "webrtc",
        conversationToken: "conv-token-1"
      })
    );

    const { result } = renderHook(() =>
      useLiveVoice({
        chatId: "chat-1",
        getToken: async () => "token-1"
      })
    );

    await act(async () => {
      const startPromise = result.current.start();
      await waitFor(() => {
        expect(conversationMocks.startSession).toHaveBeenCalledTimes(1);
      });
      const options = conversationMocks.startSession.mock.calls[0]?.[0] as {
        onConnect?: (payload: { conversationId?: string }) => void;
        onStatusChange?: (payload: { status: "connected" | "connecting" | "disconnected" }) => void;
      };
      options.onConnect?.({ conversationId: "conversation-1" });
      options.onStatusChange?.({ status: "connected" });
      await startPromise;
    });

    expect(requestAudioFocus).toHaveBeenCalledWith("live-voice", expect.any(Function));
    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(mediaTrackStop).toHaveBeenCalled();
    expect(conversationMocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationToken: "conv-token-1",
        connectionType: "webrtc",
        overrides: {
          agent: { language: "en" },
          tts: { voiceId: "voice-123" }
        },
        customLlmExtraBody: {
          persaiLiveVoiceSessionId: "session-1"
        }
      })
    );
    await waitFor(() => {
      expect(result.current.transport).toBe("direct-webrtc");
      expect(result.current.status).toBe("listening");
      expect(result.current.conversationId).toBe("conversation-1");
    });
  });

  it("uses relay websocket when relay is preferred", async () => {
    apiClientMocks.startLiveVoiceSession.mockResolvedValue(
      createStartResponse({
        preferRelay: true,
        connectionType: "websocket",
        relay: {
          path: "/api/v1/assistant/live-voice/relay",
          ticket: "relay-ticket-1",
          expiresAt: "2026-06-10T12:05:00.000Z"
        }
      })
    );

    const { result } = renderHook(() =>
      useLiveVoice({
        chatId: "chat-1",
        getToken: async () => "token-1"
      })
    );

    await act(async () => {
      const startPromise = result.current.start();
      await waitFor(() => {
        expect(conversationMocks.startSession).toHaveBeenCalledTimes(1);
      });
      const options = conversationMocks.startSession.mock.calls[0]?.[0] as {
        onConnect?: (payload: { conversationId?: string }) => void;
        onStatusChange?: (payload: { status: "connected" | "connecting" | "disconnected" }) => void;
      };
      options.onConnect?.({ conversationId: "conversation-relay" });
      options.onStatusChange?.({ status: "connected" });
      await startPromise;
    });

    expect(apiClientMocks.buildLiveVoiceRelayUrl).toHaveBeenCalledWith(
      "/api/v1/assistant/live-voice/relay",
      "relay-ticket-1"
    );
    expect(conversationMocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: "wss://relay.test/api/v1/assistant/live-voice/relay?ticket=relay-ticket-1",
        connectionType: "websocket"
      })
    );
    expect(conversationMocks.startSession.mock.calls[0]?.[0]).not.toHaveProperty(
      "conversationToken"
    );
    await waitFor(() => {
      expect(result.current.transport).toBe("relay-websocket");
      expect(result.current.status).toBe("listening");
    });
  });

  it("falls back to relay when direct connection fails", async () => {
    apiClientMocks.startLiveVoiceSession.mockResolvedValue(
      createStartResponse({
        connectionType: "webrtc",
        conversationToken: "conv-token-1",
        relay: {
          path: "/api/v1/assistant/live-voice/relay",
          ticket: "relay-ticket-1",
          expiresAt: "2026-06-10T12:05:00.000Z"
        }
      })
    );
    conversationMocks.startSession
      .mockRejectedValueOnce(new Error("direct failed"))
      .mockResolvedValueOnce({
        endSession: conversationMocks.endSession
      });

    const { result } = renderHook(() =>
      useLiveVoice({
        chatId: "chat-1",
        getToken: async () => "token-1"
      })
    );

    await act(async () => {
      const startPromise = result.current.start();
      await waitFor(() => {
        expect(conversationMocks.startSession).toHaveBeenCalledTimes(2);
      });
      const relayOptions = conversationMocks.startSession.mock.calls[1]?.[0] as {
        onConnect?: (payload: { conversationId?: string }) => void;
        onStatusChange?: (payload: { status: "connected" | "connecting" | "disconnected" }) => void;
      };
      relayOptions.onConnect?.({ conversationId: "conversation-relay" });
      relayOptions.onStatusChange?.({ status: "connected" });
      await startPromise;
    });

    expect(conversationMocks.startSession.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        conversationToken: "conv-token-1",
        connectionType: "webrtc"
      })
    );
    expect(conversationMocks.startSession.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        signedUrl: "wss://relay.test/api/v1/assistant/live-voice/relay?ticket=relay-ticket-1",
        connectionType: "websocket"
      })
    );
    await waitFor(() => {
      expect(result.current.transport).toBe("relay-websocket");
      expect(result.current.status).toBe("listening");
    });
  });

  it("reports an error when microphone access is denied without attempting relay fallback", async () => {
    apiClientMocks.startLiveVoiceSession.mockResolvedValue(
      createStartResponse({
        connectionType: "webrtc",
        conversationToken: "conv-token-1",
        relay: {
          path: "/api/v1/assistant/live-voice/relay",
          ticket: "relay-ticket-1",
          expiresAt: "2026-06-10T12:05:00.000Z"
        }
      })
    );
    getUserMediaMock.mockRejectedValueOnce(new Error("Permission denied"));

    const { result } = renderHook(() =>
      useLiveVoice({
        chatId: "chat-1",
        getToken: async () => "token-1"
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(conversationMocks.startSession).not.toHaveBeenCalled();
    expect(apiClientMocks.buildLiveVoiceRelayUrl).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({
        code: "live_voice_microphone_denied",
        message: "Permission denied"
      });
    });
  });

  it("maps live voice unavailable backend failures to unavailable state", async () => {
    apiClientMocks.startLiveVoiceSession.mockRejectedValue(
      new ApiStructuredError(
        "Live voice relay transport is configured but its signing secret is not set.",
        "live_voice_relay_secret_unavailable"
      )
    );

    const { result } = renderHook(() =>
      useLiveVoice({
        chatId: "chat-1",
        getToken: async () => "token-1"
      })
    );

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("unavailable");
      expect(result.current.error).toEqual({
        code: "live_voice_relay_secret_unavailable",
        message: "Live voice relay transport is configured but its signing secret is not set."
      });
    });
  });

  it("stops the session, notifies backend, releases focus, and returns to idle", async () => {
    apiClientMocks.startLiveVoiceSession.mockResolvedValue(
      createStartResponse({
        connectionType: "webrtc",
        conversationToken: "conv-token-1"
      })
    );

    const { result } = renderHook(() =>
      useLiveVoice({
        chatId: "chat-1",
        getToken: async () => "token-1"
      })
    );

    await act(async () => {
      const startPromise = result.current.start();
      await waitFor(() => {
        expect(conversationMocks.startSession).toHaveBeenCalledTimes(1);
      });
      const options = conversationMocks.startSession.mock.calls[0]?.[0] as {
        onConnect?: (payload: { conversationId?: string }) => void;
        onStatusChange?: (payload: { status: "connected" | "connecting" | "disconnected" }) => void;
      };
      options.onConnect?.({ conversationId: "conversation-1" });
      options.onStatusChange?.({ status: "connected" });
      await startPromise;
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(conversationMocks.endSession).toHaveBeenCalledTimes(1);
    expect(apiClientMocks.stopLiveVoiceSession).toHaveBeenCalledWith(
      "token-1",
      "session-1",
      undefined
    );
    expect(releaseFocus).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.status).toBe("idle");
      expect(result.current.transport).toBeNull();
      expect(result.current.conversationId).toBeNull();
    });
  });
});
