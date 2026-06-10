import assert from "node:assert/strict";
import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AssistantLiveVoiceSessionService } from "../src/modules/workspace-management/application/assistant-live-voice-session.service";

function createService(options?: {
  chat?: Record<string, unknown> | null;
  liveVoice?: {
    enabled: boolean;
    agentId: string | null;
    transportProtocol: "webrtc" | "websocket";
    transportRoute: "direct" | "relay";
  };
  existingSession?: Record<string, unknown> | null;
  issueCredentialResult?: Record<string, unknown>;
  locale?: "en" | "ru";
  relayTicket?: { ticket: string; expiresAt: string };
  relayIssueError?: Error;
}) {
  const createdRows: Array<Record<string, unknown>> = [];
  const updatedRows: Array<Record<string, unknown>> = [];
  const supersededCalls: Array<Record<string, unknown>> = [];
  const issueCredentialCalls: Array<Record<string, unknown>> = [];
  const relayIssueCalls: Array<Record<string, unknown>> = [];
  const service = new AssistantLiveVoiceSessionService(
    {
      assistantLiveVoiceSession: {
        async findFirst(input: Record<string, unknown>) {
          const where = (input.where ?? {}) as Record<string, unknown>;
          if (typeof where.id === "string") {
            return options?.existingSession ?? null;
          }
          return options?.existingSession ?? null;
        },
        async create(input: Record<string, unknown>) {
          const data = input.data as Record<string, unknown>;
          const row = {
            id: "session-1",
            chatId: data.chatId,
            status: "active",
            elevenlabsVoiceId: data.elevenlabsVoiceId,
            transportProtocol: data.transportProtocol,
            transportRoute: data.transportRoute,
            localDurationMs: null,
            failureCode: null,
            failureMessage: null,
            startedAt: new Date("2026-06-09T21:00:00.000Z"),
            stoppedAt: null
          };
          createdRows.push(row);
          return row;
        },
        async updateMany(input: Record<string, unknown>) {
          supersededCalls.push(input);
          const hasActive =
            options?.existingSession != null &&
            (options.existingSession as Record<string, unknown>).status === "active";
          return { count: hasActive ? 1 : 0 };
        },
        async update(input: Record<string, unknown>) {
          const data = input.data as Record<string, unknown>;
          const row = {
            id: "session-1",
            chatId: "chat-1",
            status: data.status,
            elevenlabsVoiceId: "voice-eleven-1",
            transportProtocol: "webrtc",
            transportRoute: "relay",
            localDurationMs: data.localDurationMs,
            failureCode: data.failureCode,
            failureMessage: data.failureMessage,
            startedAt: new Date(Date.now() - 1500),
            stoppedAt: data.stoppedAt
          };
          updatedRows.push(row);
          return row;
        }
      },
      assistantChat: {
        async findUnique() {
          return (
            options?.chat ?? {
              id: "chat-1",
              assistantId: "assistant-1",
              workspaceId: "workspace-1",
              userId: "user-1"
            }
          );
        }
      }
    } as never,
    {
      async execute() {
        return {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          assistant: {
            draftVoiceProfile: {
              schema: "persai.assistantVoiceProfile.v1",
              defaultLocale: "ru",
              deliveryKind: "voice_note",
              elevenlabs: { voiceId: "voice-eleven-1" },
              yandex: { voice: null, role: null },
              openai: { voice: null }
            }
          }
        };
      }
    } as never,
    {
      async execute() {
        return {
          liveVoice: options?.liveVoice ?? {
            enabled: true,
            agentId: "agent-1",
            transportProtocol: "webrtc",
            transportRoute: "relay"
          }
        };
      }
    } as never,
    {
      async issueCredential() {
        issueCredentialCalls.push({});
        return (
          options?.issueCredentialResult ?? {
            transportProtocol: "webrtc",
            conversationToken: "conversation-token-1"
          }
        );
      }
    } as never,
    {
      async forUserInWorkspace() {
        return options?.locale ?? "ru";
      }
    } as never,
    {
      async issue(input: Record<string, unknown>) {
        relayIssueCalls.push(input);
        if (options?.relayIssueError) {
          throw options.relayIssueError;
        }
        return (
          options?.relayTicket ?? {
            ticket: "relay-ticket-1",
            expiresAt: "2026-06-10T12:02:00.000Z"
          }
        );
      }
    } as never
  );

  return {
    service,
    createdRows,
    updatedRows,
    supersededCalls,
    issueCredentialCalls,
    relayIssueCalls
  };
}

async function run(): Promise<void> {
  {
    const { service, createdRows, relayIssueCalls } = createService({
      liveVoice: {
        enabled: true,
        agentId: "agent-1",
        transportProtocol: "webrtc",
        transportRoute: "direct"
      }
    });
    const started = await service.startSession({ userId: "user-1", chatId: "chat-1" });
    assert.equal(started.session.id, "session-1");
    assert.equal(started.session.selectedVoiceId, "voice-eleven-1");
    assert.equal(started.transport.route, "direct");
    assert.equal(started.transport.protocol, "webrtc");
    assert.equal(started.transport.credential.conversationToken, "conversation-token-1");
    assert.equal(started.clientConfig.agentId, "agent-1");
    assert.equal(started.clientConfig.connectionType, "webrtc");
    assert.equal(started.clientConfig.overrides.voiceId, "voice-eleven-1");
    assert.equal(started.clientConfig.overrides.language, "ru");
    assert.equal(started.clientConfig.preferRelay, false);
    assert.deepEqual(started.clientConfig.relay, {
      path: "/api/v1/assistant/live-voice/relay",
      ticket: "relay-ticket-1",
      expiresAt: "2026-06-10T12:02:00.000Z"
    });
    assert.equal(
      started.clientConfig.customLlmExtraBody.persaiLiveVoiceSessionId,
      started.session.id
    );
    assert.equal(createdRows.length, 1);
    assert.deepEqual(relayIssueCalls, [{ sessionId: "session-1", userId: "user-1" }]);
  }

  {
    const { service, issueCredentialCalls, relayIssueCalls } = createService({
      liveVoice: {
        enabled: true,
        agentId: "agent-1",
        transportProtocol: "webrtc",
        transportRoute: "direct"
      },
      relayIssueError: new Error("relay secret missing")
    });
    const started = await service.startSession({ userId: "user-1", chatId: "chat-1" });
    assert.equal(started.transport.route, "direct");
    assert.equal(started.transport.protocol, "webrtc");
    assert.equal(started.transport.credential.conversationToken, "conversation-token-1");
    assert.equal(started.clientConfig.preferRelay, false);
    assert.equal(started.clientConfig.relay, undefined);
    assert.equal(issueCredentialCalls.length, 1);
    assert.deepEqual(relayIssueCalls, [{ sessionId: "session-1", userId: "user-1" }]);
  }

  {
    const { service } = createService({
      locale: "en",
      liveVoice: {
        enabled: true,
        agentId: "agent-1",
        transportProtocol: "websocket",
        transportRoute: "direct"
      },
      issueCredentialResult: {
        transportProtocol: "websocket",
        signedUrl: "wss://elevenlabs.example/session"
      }
    });
    const started = await service.startSession({ userId: "user-1", chatId: "chat-1" });
    assert.equal(started.transport.protocol, "websocket");
    assert.equal(started.transport.credential.signedUrl, "wss://elevenlabs.example/session");
    assert.equal(started.clientConfig.connectionType, "websocket");
    assert.equal(started.clientConfig.overrides.language, "en");
  }

  {
    // A stale active session must be superseded (not block the next start).
    const { service, createdRows, supersededCalls } = createService({
      liveVoice: {
        enabled: true,
        agentId: "agent-1",
        transportProtocol: "websocket",
        transportRoute: "direct"
      },
      issueCredentialResult: {
        transportProtocol: "websocket",
        signedUrl: "wss://elevenlabs.example/session"
      },
      existingSession: {
        id: "session-1",
        chatId: "chat-1",
        status: "active",
        elevenlabsVoiceId: "voice-eleven-1",
        transportProtocol: "webrtc",
        transportRoute: "direct",
        localDurationMs: null,
        failureCode: null,
        failureMessage: null,
        startedAt: new Date(),
        stoppedAt: null
      }
    });
    const started = await service.startSession({ userId: "user-1", chatId: "chat-1" });
    assert.equal(started.session.status, "active");
    assert.equal(createdRows.length, 1);
    assert.equal(supersededCalls.length, 1);
    const supersedeData = (supersededCalls[0]?.data ?? {}) as Record<string, unknown>;
    assert.equal(supersedeData.status, "stopped");
    assert.equal(supersedeData.failureCode, "live_voice_superseded");
  }

  {
    const { service } = createService({
      liveVoice: {
        enabled: false,
        agentId: null,
        transportProtocol: "webrtc",
        transportRoute: "direct"
      }
    });
    await assert.rejects(
      () => service.startSession({ userId: "user-1", chatId: "chat-1" }),
      (error: unknown) => error instanceof ServiceUnavailableException
    );
  }

  {
    const { service, issueCredentialCalls } = createService({
      liveVoice: {
        enabled: true,
        agentId: "agent-1",
        transportProtocol: "webrtc",
        transportRoute: "relay"
      }
    });
    const started = await service.startSession({ userId: "user-1", chatId: "chat-1" });
    assert.equal(started.transport.route, "relay");
    assert.deepEqual(started.transport.credential, {});
    assert.equal(started.clientConfig.preferRelay, true);
    assert.equal(started.clientConfig.connectionType, "websocket");
    assert.equal(started.clientConfig.relay.ticket, "relay-ticket-1");
    assert.equal(issueCredentialCalls.length, 0);
  }

  {
    const { service } = createService({
      liveVoice: {
        enabled: true,
        agentId: "agent-1",
        transportProtocol: "websocket",
        transportRoute: "relay"
      },
      relayIssueError: new Error("relay secret missing")
    });
    await assert.rejects(
      () => service.startSession({ userId: "user-1", chatId: "chat-1" }),
      (error: unknown) => {
        if (!(error instanceof ServiceUnavailableException)) {
          return false;
        }
        const response = error.getResponse();
        return (
          typeof response === "object" &&
          response !== null &&
          "code" in response &&
          response.code === "live_voice_relay_secret_unavailable"
        );
      }
    );
  }

  {
    const { service } = createService({
      existingSession: {
        id: "session-1",
        chatId: "chat-1",
        status: "active",
        elevenlabsVoiceId: "voice-eleven-1",
        transportProtocol: "webrtc",
        transportRoute: "relay",
        localDurationMs: null,
        failureCode: null,
        failureMessage: null,
        startedAt: new Date(Date.now() - 2500),
        stoppedAt: null
      }
    });
    const stopped = await service.stopSession({ userId: "user-1", sessionId: "session-1" });
    assert.equal(stopped.status, "stopped");
    assert.ok((stopped.localDurationMs ?? 0) >= 0);
  }

  {
    const { service } = createService({
      existingSession: {
        id: "session-1",
        chatId: "chat-1",
        status: "active",
        elevenlabsVoiceId: "voice-eleven-1",
        transportProtocol: "webrtc",
        transportRoute: "relay",
        localDurationMs: null,
        failureCode: null,
        failureMessage: null,
        startedAt: new Date(Date.now() - 2500),
        stoppedAt: null
      }
    });
    const failed = await service.stopSession({
      userId: "user-1",
      sessionId: "session-1",
      failureCode: "provider_disconnect",
      failureMessage: "Upstream websocket dropped."
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureCode, "provider_disconnect");
  }

  {
    const { service } = createService({ existingSession: null });
    await assert.rejects(
      () => service.getStatus({ userId: "user-1", sessionId: "missing" }),
      (error: unknown) => error instanceof NotFoundException
    );
  }

  console.log("assistant-live-voice-session.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
