import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { SendNativeTelegramTurnService } from "../src/modules/workspace-management/application/send-native-telegram-turn.service";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";

const ORIGINAL_ENV = process.env;

function setApiEnv(overrides?: Record<string, string | undefined>): void {
  process.env = {
    ...ORIGINAL_ENV,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public",
    CLERK_SECRET_KEY: "clerk-secret",
    PERSAI_INTERNAL_API_TOKEN: "persai-internal-token",
    PERSAI_WEB_CHAT_SYNC_RUNTIME_MODE: "native",
    PERSAI_WEB_CHAT_STREAM_RUNTIME_MODE: "native",
    PERSAI_RUNTIME_BASE_URL: "http://runtime.local",
    PERSAI_RUNTIME_TURN_TIMEOUT_MS: "9000",
    PERSAI_RUNTIME_STREAM_TIMEOUT_MS: "9000",
    ...overrides
  };
}

function createMaterializedSpec() {
  return {
    id: "spec-1",
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    sourceAction: "publish",
    algorithmVersion: 72,
    materializedAtConfigGeneration: 1,
    layers: {},
    runtimeBundle: {},
    openclawBootstrap: {},
    openclawWorkspace: {},
    layersDocument: "{}",
    runtimeBundleDocument: "{}",
    runtimeBundleHash: "bundle-hash-1",
    openclawBootstrapDocument: "{}",
    openclawWorkspaceDocument: "{}",
    contentHash: "content-hash-1",
    createdAt: new Date("2026-04-11T12:59:00.000Z")
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("SendNativeTelegramTurnService", () => {
  test("builds a native Telegram runtime request with direct conversation identity", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      capturedBody = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : null;
      return new Response(
        JSON.stringify({
          requestId: "runtime-request-1",
          sessionId: "runtime-session-1",
          assistantText: "telegram hello",
          artifacts: [
            {
              artifactId: "artifact-1",
              kind: "audio",
              objectKey: "assistant-media/assistants/assistant-1/runtime-output/reply.ogg",
              mimeType: "audio/ogg",
              filename: "reply.ogg",
              sizeBytes: 256,
              voiceNote: true
            }
          ],
          respondedAt: "2026-04-12T10:00:00.000Z",
          usage: null
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new SendNativeTelegramTurnService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      const result = await service.execute({
        assistantId: "assistant-1",
        publishedVersionId: "version-1",
        runtimeTier: "paid_shared_restricted",
        workspaceId: "workspace-1",
        threadId: "telegram-chat-1",
        externalUserKey: "telegram-user-1",
        mode: "direct",
        userMessageId: "message-1",
        userMessage: "hello native telegram",
        attachments: [],
        userTimezone: "UTC",
        currentTimeIso: "2026-04-12T10:00:00.000Z"
      });

      assert.equal(capturedBody?.idempotencyKey, "message-1");
      assert.deepEqual(capturedBody?.message, {
        text: "hello native telegram",
        attachments: [],
        locale: null,
        timezone: "UTC",
        receivedAt: "2026-04-12T10:00:00.000Z"
      });
      assert.deepEqual(capturedBody?.conversation, {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        channel: "telegram",
        externalThreadKey: "telegram-chat-1",
        externalUserKey: "telegram-user-1",
        mode: "direct"
      });
      assert.equal(result.assistantMessage, "telegram hello");
      assert.deepEqual(result.media, [
        {
          source: "persai_object_storage",
          objectKey: "assistant-media/assistants/assistant-1/runtime-output/reply.ogg",
          type: "audio",
          mimeType: "audio/ogg",
          filename: "reply.ogg",
          sizeBytes: 256,
          audioAsVoice: true
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("builds a native Telegram runtime request with group conversation identity", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      capturedBody = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : null;
      return new Response(
        JSON.stringify({
          requestId: "runtime-request-2",
          sessionId: "runtime-session-2",
          assistantText: "group hello",
          artifacts: [],
          respondedAt: "2026-04-12T10:00:01.000Z",
          usage: null
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new SendNativeTelegramTurnService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      await service.execute({
        assistantId: "assistant-1",
        publishedVersionId: "version-1",
        runtimeTier: "paid_shared_restricted",
        workspaceId: "workspace-1",
        threadId: "-10012345",
        externalUserKey: null,
        mode: "group",
        userMessageId: "message-2",
        userMessage: "@bot hi",
        attachments: []
      });

      assert.deepEqual(capturedBody?.conversation, {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        channel: "telegram",
        externalThreadKey: "-10012345",
        externalUserKey: null,
        mode: "group"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("surfaces native runtime conflicts as inbound conflicts", async () => {
    setApiEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          statusCode: 409,
          message: 'Turn "request-1" is already in flight.',
          error: "Conflict"
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const service = new SendNativeTelegramTurnService({
        findByPublishedVersionId: async () => createMaterializedSpec()
      } as AssistantMaterializedSpecRepository);

      await assert.rejects(
        () =>
          service.execute({
            assistantId: "assistant-1",
            publishedVersionId: "version-1",
            runtimeTier: "paid_shared_restricted",
            workspaceId: "workspace-1",
            threadId: "telegram-chat-1",
            externalUserKey: "telegram-user-1",
            mode: "direct",
            userMessageId: "message-1",
            userMessage: "hello native telegram",
            attachments: []
          }),
        (error) => {
          const row = error as { errorObject?: { code?: string } };
          return row.errorObject?.code === "native_runtime_conflict";
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails clearly when the runtime base url is missing", async () => {
    setApiEnv({ PERSAI_RUNTIME_BASE_URL: "" });
    const service = new SendNativeTelegramTurnService({
      findByPublishedVersionId: async () => {
        throw new Error("repository should not be called");
      }
    } as AssistantMaterializedSpecRepository);

    await assert.rejects(
      () =>
        service.execute({
          assistantId: "assistant-1",
          publishedVersionId: "version-1",
          runtimeTier: "paid_shared_restricted",
          workspaceId: "workspace-1",
          threadId: "telegram-chat-1",
          externalUserKey: "telegram-user-1",
          mode: "direct",
          userMessageId: "message-1",
          userMessage: "hello native telegram",
          attachments: []
        }),
      (error) =>
        error instanceof AssistantRuntimeError &&
        error.code === "runtime_degraded" &&
        error.message.includes("PERSAI_RUNTIME_BASE_URL")
    );
  });
});
