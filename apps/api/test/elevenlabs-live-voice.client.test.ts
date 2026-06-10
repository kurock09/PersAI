import assert from "node:assert/strict";
import { ElevenlabsLiveVoiceClient } from "../src/modules/workspace-management/application/elevenlabs/elevenlabs-live-voice.client";

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;

  try {
    {
      let requestedUrl = "";
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({ token: "conv-token-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }) as typeof fetch;

      const client = new ElevenlabsLiveVoiceClient({
        async resolveSecretValueByProviderKey(providerKey: string) {
          assert.equal(providerKey, "tool_tts_elevenlabs");
          return "eleven-secret";
        }
      } as never);

      const result = await client.issueCredential({
        agentId: "agent-123",
        transportProtocol: "webrtc"
      });
      assert.deepEqual(result, {
        transportProtocol: "webrtc",
        conversationToken: "conv-token-1"
      });
      assert.ok(requestedUrl.includes("/v1/convai/conversation/token"));
      assert.ok(requestedUrl.includes("agent_id=agent-123"));
    }

    {
      let requestedUrl = "";
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            signed_url:
              "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent-456&token=abc"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }) as typeof fetch;

      const client = new ElevenlabsLiveVoiceClient({
        async resolveSecretValueByProviderKey() {
          return "eleven-secret";
        }
      } as never);

      const result = await client.issueCredential({
        agentId: "agent-456",
        transportProtocol: "websocket"
      });
      assert.deepEqual(result, {
        transportProtocol: "websocket",
        signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent-456&token=abc"
      });
      assert.ok(requestedUrl.includes("/v1/convai/conversation/get-signed-url"));
    }

    {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })) as typeof fetch;

      const client = new ElevenlabsLiveVoiceClient({
        async resolveSecretValueByProviderKey() {
          return "eleven-secret";
        }
      } as never);

      await assert.rejects(
        () =>
          client.issueCredential({
            agentId: "agent-789",
            transportProtocol: "webrtc"
          }),
        /did not include a token/
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("elevenlabs-live-voice.client: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
