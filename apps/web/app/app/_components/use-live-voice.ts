"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiStructuredError } from "../assistant-api-client";
import {
  buildLiveVoiceRelayUrl,
  startLiveVoiceSession,
  stopLiveVoiceSession
} from "../assistant-api-client";
import { requestAudioFocus } from "../../lib/audio-focus";
import {
  deriveLiveVoiceTransport,
  isLiveVoiceUnavailableCode,
  type LiveVoiceError,
  type LiveVoiceStatus,
  type LiveVoiceTransport
} from "./live-voice-types";

const AUDIO_FOCUS_OWNER_ID = "live-voice";
const CONNECT_TIMEOUT_MS = 8_000;

type ConversationStatus = "connected" | "connecting" | "disconnected";
type ConversationMode = "speaking" | "listening";
type ConversationHandle = {
  endSession: () => Promise<void>;
};
type ConversationConstructor = {
  startSession: (options: Record<string, unknown>) => Promise<ConversationHandle>;
};
type ConversationModule = {
  Conversation: ConversationConstructor;
};

type UseLiveVoiceParams = {
  chatId: string;
  getToken: () => Promise<string | null>;
};

type UseLiveVoiceResult = {
  status: LiveVoiceStatus;
  transport: LiveVoiceTransport | null;
  error: LiveVoiceError | null;
  conversationId: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isActive: boolean;
};

type ConnectionSucceeded = {
  conversation: ConversationHandle;
  transport: LiveVoiceTransport;
  sessionId: string;
};

type StartAttemptInput = {
  startSessionState: Awaited<ReturnType<typeof startLiveVoiceSession>>;
  token: string;
};

function createLiveVoiceError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): LiveVoiceError {
  if (error instanceof ApiStructuredError) {
    return {
      code: error.code,
      message: error.message
    };
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return {
      code: fallbackCode,
      message: error.message
    };
  }
  return {
    code: fallbackCode,
    message: fallbackMessage
  };
}

async function importConversationModule(): Promise<ConversationConstructor> {
  const module = (await import("@elevenlabs/client")) as ConversationModule;
  return module.Conversation;
}

async function ensureMicrophoneAccess(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function useLiveVoice(params: UseLiveVoiceParams): UseLiveVoiceResult {
  const { chatId, getToken } = params;

  const [status, setStatus] = useState<LiveVoiceStatus>("idle");
  const [transport, setTransport] = useState<LiveVoiceTransport | null>(null);
  const [error, setError] = useState<LiveVoiceError | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const conversationRef = useRef<ConversationHandle | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const focusReleaseRef = useRef<(() => void) | null>(null);
  const isStoppingRef = useRef(false);
  const startRunIdRef = useRef(0);
  const mountedRef = useRef(true);
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const resetClientState = useCallback(() => {
    conversationRef.current = null;
    sessionIdRef.current = null;
    conversationIdRef.current = null;
    setConversationId(null);
    setTransport(null);
    setError(null);
  }, []);

  const releaseFocus = useCallback(() => {
    focusReleaseRef.current?.();
    focusReleaseRef.current = null;
  }, []);

  const stopInternal = useCallback(
    async (reason?: { failureCode?: string; failureMessage?: string }) => {
      const token = await getTokenRef.current().catch(() => null);
      const conversation = conversationRef.current;
      const sessionId = sessionIdRef.current;

      isStoppingRef.current = true;
      setStatus("stopping");

      try {
        if (conversation) {
          await conversation.endSession();
        }
      } catch {
        // Local session teardown is best-effort; backend stop still runs below.
      }

      if (token && sessionId) {
        try {
          await stopLiveVoiceSession(token, sessionId, reason);
        } catch {
          // Backend stop is best-effort during local teardown.
        }
      }

      releaseFocus();
      resetClientState();
      setStatus("idle");
      isStoppingRef.current = false;
    },
    [releaseFocus, resetClientState]
  );

  const connectWithTimeout = useCallback(
    async (
      conversationCtor: ConversationConstructor,
      options: Record<string, unknown>,
      resolvedTransport: LiveVoiceTransport,
      sessionId: string,
      runId: number
    ): Promise<ConnectionSucceeded> => {
      return await new Promise<ConnectionSucceeded>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error("Live voice connection timed out."));
        }, CONNECT_TIMEOUT_MS);

        const clear = () => {
          window.clearTimeout(timeoutId);
        };

        let conversationHandle: ConversationHandle | null = null;
        let settled = false;

        const resolveConnected = () => {
          if (settled || !conversationHandle) {
            return;
          }
          settled = true;
          clear();
          resolve({
            conversation: conversationHandle,
            transport: resolvedTransport,
            sessionId
          });
        };

        const rejectOnce = (reason: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clear();
          reject(reason);
        };

        const wrappedOptions: Record<string, unknown> = {
          ...options,
          onConnect: (payload: { conversationId?: string }) => {
            if (runId !== startRunIdRef.current) {
              return;
            }
            const nextConversationId =
              typeof payload?.conversationId === "string" ? payload.conversationId : null;
            conversationIdRef.current = nextConversationId;
            setConversationId(nextConversationId);
            setStatus("listening");
            if (typeof options.onConnect === "function") {
              (options.onConnect as (payload: { conversationId?: string }) => void)(payload);
            }
            resolveConnected();
          },
          onDisconnect: () => {
            if (runId !== startRunIdRef.current) {
              return;
            }
            if (typeof options.onDisconnect === "function") {
              (options.onDisconnect as () => void)();
            }
            if (!isStoppingRef.current) {
              releaseFocus();
              resetClientState();
              setStatus("idle");
            }
          },
          onError: (message: string) => {
            if (runId !== startRunIdRef.current) {
              return;
            }
            if (typeof options.onError === "function") {
              (options.onError as (message: string) => void)(message);
            }
            if (conversationRef.current) {
              setStatus("recovering");
              setError({
                code: "live_voice_runtime_error",
                message
              });
            } else {
              setStatus("error");
              setError({
                code: "live_voice_runtime_error",
                message
              });
            }
          },
          onStatusChange: (payload: { status: ConversationStatus }) => {
            if (runId !== startRunIdRef.current) {
              return;
            }
            if (typeof options.onStatusChange === "function") {
              (options.onStatusChange as (payload: { status: ConversationStatus }) => void)(
                payload
              );
            }
            if (payload.status === "connecting") {
              setStatus("connecting");
              return;
            }
            if (payload.status === "connected") {
              setStatus("listening");
              resolveConnected();
              return;
            }
            if (payload.status === "disconnected" && !isStoppingRef.current) {
              releaseFocus();
              resetClientState();
              setStatus("idle");
            }
          },
          onModeChange: (payload: { mode: ConversationMode }) => {
            if (runId !== startRunIdRef.current) {
              return;
            }
            if (typeof options.onModeChange === "function") {
              (options.onModeChange as (payload: { mode: ConversationMode }) => void)(payload);
            }
            if (payload.mode === "speaking") {
              setStatus("speaking");
              return;
            }
            if (payload.mode === "listening") {
              setStatus("listening");
            }
          }
        };

        void conversationCtor
          .startSession(wrappedOptions)
          .then((conversation) => {
            conversationHandle = conversation;
          })
          .catch((error: unknown) => {
            rejectOnce(error);
          });
      });
    },
    [releaseFocus, resetClientState]
  );

  const startAttempt = useCallback(
    async (
      conversationCtor: ConversationConstructor,
      input: StartAttemptInput,
      runId: number
    ): Promise<ConnectionSucceeded> => {
      const { startSessionState } = input;
      const { clientConfig, transport: serverTransport, session } = startSessionState;
      const baseOptions = {
        overrides: {
          agent: {
            language: clientConfig.overrides.language
          },
          tts: {
            voiceId: clientConfig.overrides.voiceId
          }
        },
        customLlmExtraBody: clientConfig.customLlmExtraBody
      };

      if (clientConfig.preferRelay) {
        if (!clientConfig.relay) {
          throw new ApiStructuredError(
            "Live voice relay transport is configured but unavailable.",
            "live_voice_relay_unavailable"
          );
        }
        const relayUrl = buildLiveVoiceRelayUrl(clientConfig.relay.path, clientConfig.relay.ticket);
        return connectWithTimeout(
          conversationCtor,
          {
            ...baseOptions,
            signedUrl: relayUrl,
            connectionType: "websocket"
          },
          "relay-websocket",
          session.id,
          runId
        );
      }

      const directTransport = deriveLiveVoiceTransport(serverTransport, clientConfig, false);
      const directOptions =
        clientConfig.connectionType === "webrtc"
          ? serverTransport.credential.conversationToken
            ? {
                ...baseOptions,
                conversationToken: serverTransport.credential.conversationToken,
                connectionType: "webrtc"
              }
            : null
          : serverTransport.credential.signedUrl
            ? {
                ...baseOptions,
                signedUrl: serverTransport.credential.signedUrl,
                connectionType: "websocket"
              }
            : null;

      if (directOptions && directTransport) {
        try {
          return await connectWithTimeout(
            conversationCtor,
            directOptions,
            directTransport,
            session.id,
            runId
          );
        } catch (error) {
          if (!clientConfig.relay) {
            throw error;
          }
        }
      }

      if (!clientConfig.relay) {
        throw new Error("Live voice direct transport failed and relay fallback is unavailable.");
      }

      const relayUrl = buildLiveVoiceRelayUrl(clientConfig.relay.path, clientConfig.relay.ticket);
      return connectWithTimeout(
        conversationCtor,
        {
          ...baseOptions,
          signedUrl: relayUrl,
          connectionType: "websocket"
        },
        "relay-websocket",
        session.id,
        runId
      );
    },
    [connectWithTimeout]
  );

  const start = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    const token = await getToken();
    if (!token) {
      const nextError = {
        code: "auth_session_missing",
        message: "Live voice requires an active session."
      };
      setError(nextError);
      setStatus("error");
      return;
    }

    await stopInternal().catch(() => undefined);

    const runId = startRunIdRef.current + 1;
    startRunIdRef.current = runId;

    setError(null);
    setConversationId(null);
    setTransport(null);
    setStatus("connecting");

    focusReleaseRef.current = requestAudioFocus(AUDIO_FOCUS_OWNER_ID, () => undefined);

    let startState: Awaited<ReturnType<typeof startLiveVoiceSession>> | null = null;
    try {
      startState = await startLiveVoiceSession(token, chatId);
    } catch (error) {
      const nextError = createLiveVoiceError(
        error,
        "live_voice_start_failed",
        "Failed to start live voice."
      );
      setError(nextError);
      setStatus(isLiveVoiceUnavailableCode(nextError.code) ? "unavailable" : "error");
      releaseFocus();
      return;
    }

    try {
      await ensureMicrophoneAccess();
    } catch (error) {
      const nextError = createLiveVoiceError(
        error,
        "live_voice_microphone_denied",
        "Microphone access is required for live voice."
      );
      setError(nextError);
      setStatus("error");
      if (startState) {
        try {
          await stopLiveVoiceSession(token, startState.session.id, {
            failureCode: nextError.code,
            failureMessage: nextError.message
          });
        } catch {
          // Best-effort cleanup only.
        }
      }
      releaseFocus();
      return;
    }

    try {
      const conversationCtor = await importConversationModule();
      const connected = await startAttempt(
        conversationCtor,
        {
          startSessionState: startState,
          token
        },
        runId
      );
      if (runId !== startRunIdRef.current || !mountedRef.current) {
        await connected.conversation.endSession().catch(() => undefined);
        return;
      }
      conversationRef.current = connected.conversation;
      sessionIdRef.current = connected.sessionId;
      setTransport(connected.transport);
      setError(null);
      if (status === "connecting") {
        setStatus("listening");
      }
    } catch (error) {
      const nextError = createLiveVoiceError(
        error,
        "live_voice_connection_failed",
        "Failed to connect live voice."
      );
      setError(nextError);
      setStatus(isLiveVoiceUnavailableCode(nextError.code) ? "unavailable" : "error");
      if (startState) {
        try {
          await stopLiveVoiceSession(token, startState.session.id, {
            failureCode: nextError.code,
            failureMessage: nextError.message
          });
        } catch {
          // Best-effort cleanup only.
        }
      }
      releaseFocus();
    }
  }, [chatId, getToken, releaseFocus, startAttempt, status, stopInternal]);

  const stop = useCallback(async () => {
    await stopInternal();
  }, [stopInternal]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      void stopInternal();
    };
  }, [chatId]);

  return {
    status,
    transport,
    error,
    conversationId,
    start,
    stop,
    isActive:
      status === "connecting" ||
      status === "listening" ||
      status === "speaking" ||
      status === "working" ||
      status === "recovering" ||
      status === "stopping"
  };
}
