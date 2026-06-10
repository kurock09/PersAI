import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { AssistantLiveVoiceRelayGateway } from "../src/modules/workspace-management/interface/ws/assistant-live-voice-relay.gateway";

const RELAY_PATH = "/api/v1/assistant/live-voice/relay";
const EARLY_FRAME = JSON.stringify({
  type: "conversation_initiation_metadata",
  conversation_initiation_metadata_event: { conversation_id: "conv-test" }
});

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function run(): Promise<void> {
  // Upstream stand-in for ElevenLabs convai: emits `conversation_initiation_metadata`
  // immediately on connection (mirrors the real ~2ms-after-open behaviour),
  // before the client sends anything.
  const upstreamServer = createServer();
  const upstreamWss = new WebSocketServer({ server: upstreamServer });
  upstreamWss.on("connection", (socket) => {
    socket.send(EARLY_FRAME);
  });
  const upstreamPort = await listen(upstreamServer);

  const gateway = new AssistantLiveVoiceRelayGateway(
    {
      async verify(ticket: string) {
        return ticket === "good-ticket" ? { sessionId: "session-1", userId: "user-1" } : null;
      }
    } as never,
    {
      assistantLiveVoiceSession: {
        async findUnique() {
          return {
            id: "session-1",
            userId: "user-1",
            status: "active",
            elevenlabsAgentId: "agent-1"
          };
        }
      }
    } as never,
    {
      async issueCredential() {
        return {
          transportProtocol: "websocket" as const,
          signedUrl: `ws://127.0.0.1:${String(upstreamPort)}`
        };
      }
    } as never
  );

  const apiServer = createServer();
  gateway.attachTo(apiServer);
  const apiPort = await listen(apiServer);

  // The early upstream frame must reach the client even though it arrives
  // before the client websocket handshake completes (regression: it was
  // previously dropped, so the SDK never established the session).
  const received = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("client did not receive early frame")), 5000);
    const client = new WebSocket(
      `ws://127.0.0.1:${String(apiPort)}${RELAY_PATH}?ticket=good-ticket`
    );
    client.on("message", (data) => {
      clearTimeout(timeout);
      const text = data.toString();
      client.close();
      resolve(text);
    });
    client.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  assert.equal(received, EARLY_FRAME);

  // Rejected ticket must not upgrade.
  const rejected = await new Promise<boolean>((resolve) => {
    const client = new WebSocket(
      `ws://127.0.0.1:${String(apiPort)}${RELAY_PATH}?ticket=bad-ticket`
    );
    client.on("open", () => {
      client.close();
      resolve(false);
    });
    client.on("error", () => resolve(true));
    client.on("unexpected-response", () => resolve(true));
  });
  assert.equal(rejected, true);

  gateway.onApplicationShutdown();
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  upstreamWss.close();
  await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));

  console.log("assistant-live-voice-relay.gateway: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
