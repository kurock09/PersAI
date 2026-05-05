import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProviderGatewayToolCall } from "@persai/runtime-contract";
import { RuntimeMediaJobRunService } from "../src/modules/turns/runtime-media-job-run.service";

describe("RuntimeMediaJobRunService", () => {
  test("executes direct media tool requests without a second LLM run", async () => {
    let capturedToolCall: ProviderGatewayToolCall | null = null;
    const service = new RuntimeMediaJobRunService(
      {
        executeToolCall: async (input: Record<string, unknown>) => {
          capturedToolCall = input.toolCall as ProviderGatewayToolCall;
          return {
            payload: {
              toolCode: "image_generate",
              executionMode: "worker",
              provider: "openai",
              model: "gpt-image-1",
              prompt: "draw a sunset",
              revisedPrompt: null,
              requestedCount: 1,
              size: "1024x1024",
              artifacts: [{ artifactId: "artifact-1", kind: "image" }],
              usage: null,
              action: "generated",
              reason: null,
              warning: null
            },
            artifacts: [{ artifactId: "artifact-1", kind: "image" }],
            isError: false
          };
        }
      } as never,
      {} as never,
      {} as never
    );

    const result = await service.run({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeTier: "paid_shared_restricted",
      runtimeBundleDocument: JSON.stringify({
        metadata: {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          publishedVersionId: "version-1"
        },
        runtime: {},
        promptConstructor: {},
        userContext: {
          locale: "en",
          timezone: "UTC"
        }
      }),
      job: {
        id: "job-1",
        surface: "web",
        kind: "image",
        chatId: "chat-1",
        sourceUserMessageId: "user-message-1",
        sourceUserMessageText: "draw a sunset",
        sourceUserMessageCreatedAt: "2026-05-05T09:00:00.000Z"
      },
      attachments: [],
      directToolExecution: {
        toolCode: "image_generate",
        request: {
          toolCode: "image_generate",
          prompt: "draw a sunset",
          count: 1,
          filename: null,
          size: "1024x1024",
          background: "auto"
        }
      }
    });

    assert.equal(result.assistantText, "");
    assert.deepEqual(result.artifacts, [{ artifactId: "artifact-1", kind: "image" }]);
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.toolInvocations[0]?.name, "image_generate");
    assert.ok(capturedToolCall);
    const recordedToolCall = capturedToolCall as ProviderGatewayToolCall;
    assert.equal(recordedToolCall.name, "image_generate");
  });
});
