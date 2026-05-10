import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { RuntimeImageGenerateToolService } from "../src/modules/turns/runtime-image-generate-tool.service";

async function run(): Promise<void> {
  const service = new RuntimeImageGenerateToolService(
    {} as never,
    {
      async enqueueDeferredMediaJob() {
        return {
          accepted: false,
          code: "monthly_media_quota_exceeded",
          message: "Image generation is exhausted for the current monthly period.",
          guidance:
            'Use a request that does not need media generation. You can also buy "Starter media pack" for $10 on /app/packages.'
        };
      }
    } as never,
    {} as never,
    {} as never
  );

  const result = await service.executeToolCall({
    bundle: {
      metadata: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1"
      },
      governance: {
        toolPolicies: [
          {
            toolCode: "image_generate",
            visibleToModel: true,
            enabled: true,
            usageRule: "allowed",
            executionMode: "worker"
          }
        ],
        toolCredentialRefs: {
          image_generate: {
            configured: true,
            providerId: "openai",
            modelKey: "gpt-image-1",
            secretRef: {
              source: "persai",
              provider: "persai-runtime",
              id: "tool/image_generate/api-key"
            }
          }
        }
      },
      runtime: {
        workerTools: {
          tools: [
            {
              toolCode: "image_generate",
              timeoutMs: 300_000
            }
          ]
        }
      }
    } as unknown as AssistantRuntimeBundle,
    toolCall: {
      id: "call-1",
      name: "image_generate",
      arguments: {
        prompt: "Draw a serene poster",
        count: 1
      }
    } as never,
    sessionId: "session-1",
    requestId: "request-1",
    deferToAsyncMediaJob: {
      sourceUserMessageId: "message-1",
      sourceUserMessageText: "Draw a serene poster"
    }
  });

  assert.equal(result.isError, false);
  assert.equal(result.payload.action, "skipped");
  assert.equal(result.payload.reason, "monthly_media_quota_exceeded");
  assert.equal(
    result.payload.guidance,
    'Use a request that does not need media generation. You can also buy "Starter media pack" for $10 on /app/packages.'
  );
}

void run();
