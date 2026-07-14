import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssistantPublishBody } from "../src/server.js";

void test("assistant_publish preserves the canonical current role with a concurrency token", async () => {
  const requests: Array<{ method: string; path: string }> = [];
  const body = await resolveAssistantPublishBody({
    async requestJson(request) {
      requests.push({ method: request.method, path: request.path });
      if (request.path === "/api/v1/assistant") {
        return { assistant: { id: "00000000-0000-4000-8000-000000000147" } };
      }
      return { role: { key: "persai_default" } };
    }
  } as never);

  assert.deepEqual(requests, [
    { method: "GET", path: "/api/v1/assistant" },
    {
      method: "GET",
      path: "/api/v1/assistant/00000000-0000-4000-8000-000000000147/role"
    }
  ]);
  assert.deepEqual(body, {
    assistantId: "00000000-0000-4000-8000-000000000147",
    expectedRoleKey: "persai_default",
    roleKey: "persai_default"
  });
});

void test("assistant_publish fails closed when canonical assistant or role identity is missing", async () => {
  await assert.rejects(
    () =>
      resolveAssistantPublishBody({
        async requestJson() {
          return { assistant: null };
        }
      } as never),
    /Active assistant id is unavailable/
  );

  await assert.rejects(
    () =>
      resolveAssistantPublishBody({
        async requestJson(request) {
          return request.path === "/api/v1/assistant"
            ? { assistant: { id: "assistant-1" } }
            : { role: null };
        }
      } as never),
    /Active assistant role is unavailable/
  );
});
