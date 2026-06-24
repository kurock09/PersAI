import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  RuntimeAttachmentRef
} from "@persai/runtime-contract";
import { RuntimeImageGenerateToolService } from "../src/modules/turns/runtime-image-generate-tool.service";
import { ProviderGatewaySafetyRejectedError } from "../src/modules/turns/provider-gateway.client.service";
import { createFakeSandboxClientForOutboundWrite } from "./helpers/runtime-outbound-test-doubles";

function createBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      assistantHandle: "test-assistant",
      siblingAssistantHandles: []
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
      },
      runtimeProviderRouting: {
        modelSlots: {
          systemTool: {
            providerKey: "openai",
            modelKey: "gpt-5.4-mini"
          }
        }
      }
    }
  } as unknown as unknown as AssistantRuntimeBundle;
}

describe("RuntimeImageGenerateToolService", () => {
  test("preserves deferred quota guidance", async () => {
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
      {} as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
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
  });

  test("returns pending_delivery with count metadata when async media job is accepted", async () => {
    const service = new RuntimeImageGenerateToolService(
      {} as never,
      {
        async enqueueDeferredMediaJob() {
          return {
            accepted: true,
            jobId: "media-job-1",
            kind: "image"
          };
        }
      } as never,
      {} as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-1",
        name: "image_generate",
        arguments: {
          prompt: "Draw a serene poster",
          count: 3
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
    assert.equal(result.payload.action, "pending_delivery");
    assert.equal(result.payload.canSendFileNow, false);
    assert.equal(result.payload.jobId, "media-job-1");
    assert.equal(result.payload.requestedCount, 3);
    assert.equal(result.payload.expectedResultCount, 3);
    assert.equal(typeof result.payload.messageToUser, "string");
    assert.equal(result.artifacts.length, 0);
  });

  test("retries once with a safer paraphrase after provider safety rejection", async () => {
    const imageCalls: ProviderGatewayImageGenerateRequest[] = [];
    const rewriteCalls: ProviderGatewayTextGenerateRequest[] = [];
    let imageCallCount = 0;
    const providerGatewayClient = {
      async generateImage(
        input: ProviderGatewayImageGenerateRequest
      ): Promise<ProviderGatewayImageGenerateResult> {
        imageCalls.push(input);
        imageCallCount += 1;
        if (imageCallCount === 1) {
          throw new ProviderGatewaySafetyRejectedError({
            status: 400,
            code: "image_provider_safety_rejected",
            message:
              "OpenAI image generate request was rejected by the provider safety system (request id req_first_safety).",
            providerStatus: {
              provider: "openai",
              requestId: "req_first_safety"
            }
          });
        }
        return {
          provider: "openai",
          model: "gpt-image-1",
          prompt: input.prompt,
          size: input.size,
          images: [
            {
              bytesBase64: Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
              ]).toString("base64"),
              mimeType: "image/png",
              revisedPrompt: null
            }
          ],
          respondedAt: "2026-05-25T12:00:00.000Z",
          usage: null,
          billingFacts: null,
          warning: null
        };
      },
      async generateText(
        input: ProviderGatewayTextGenerateRequest
      ): Promise<ProviderGatewayTextGenerateResult> {
        rewriteCalls.push(input);
        return {
          provider: "openai",
          model: "gpt-5.4-mini",
          text: JSON.stringify({
            safePrompt:
              "Create a heroic caped comic-book portrait inspired by the user, with a generic superhero look and no copyrighted character names."
          }),
          respondedAt: "2026-05-25T12:00:01.000Z",
          usage: null,
          stopReason: "completed",
          toolCalls: []
        };
      }
    };
    const service = new RuntimeImageGenerateToolService(
      providerGatewayClient as never,
      {} as never,
      createFakeSandboxClientForOutboundWrite("/shared/outbound/self/image-1.png") as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-2",
        name: "image_generate",
        arguments: {
          prompt: "Сделай меня суперменом",
          count: 1
        }
      } as never,
      sessionId: "session-1",
      requestId: "request-2"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(imageCalls.length, 2);
    assert.equal(rewriteCalls.length, 1);
    assert.equal(imageCalls[0]?.prompt, "Сделай меня суперменом");
    assert.match(imageCalls[1]?.prompt ?? "", /heroic caped comic-book portrait/i);
    assert.equal(result.payload.revisedPrompt, imageCalls[1]?.prompt);
    assert.match(result.payload.warning ?? "", /safety system/i);
    assert.equal(rewriteCalls[0]?.model, "gpt-5.4-mini");
    assert.equal(result.artifacts.length, 1);
  });

  test("returns a typed safety failure when the single safer retry is also rejected", async () => {
    let imageCallCount = 0;
    const service = new RuntimeImageGenerateToolService(
      {
        async generateImage(): Promise<ProviderGatewayImageGenerateResult> {
          imageCallCount += 1;
          throw new ProviderGatewaySafetyRejectedError({
            status: 400,
            code: "image_provider_safety_rejected",
            message: `OpenAI image generate request was rejected by the provider safety system (request id req_retry_${String(
              imageCallCount
            )}).`,
            providerStatus: {
              provider: "openai",
              requestId: `req_retry_${String(imageCallCount)}`
            }
          });
        },
        async generateText(): Promise<ProviderGatewayTextGenerateResult> {
          return {
            provider: "openai",
            model: "gpt-5.4-mini",
            text: JSON.stringify({
              safePrompt:
                "Create a generic heroic portrait with a cape and dramatic comic-book lighting."
            }),
            respondedAt: "2026-05-25T12:00:02.000Z",
            usage: null,
            stopReason: "completed",
            toolCalls: []
          };
        }
      } as never,
      {} as never,
      {} as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-3",
        name: "image_generate",
        arguments: {
          prompt: "Сделай меня суперменом",
          count: 1
        }
      } as never,
      sessionId: "session-1",
      requestId: "request-3"
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.reason, "image_provider_safety_rejected");
    assert.equal(
      result.payload.revisedPrompt,
      "Create a generic heroic portrait with a cape and dramatic comic-book lighting."
    );
    assert.match(result.payload.warning ?? "", /also rejected by the provider safety system/i);
    assert.equal(imageCallCount, 2);
  });

  test("runs series mode as multiple single-image provider calls", async () => {
    const imageCalls: ProviderGatewayImageGenerateRequest[] = [];
    const service = new RuntimeImageGenerateToolService(
      {
        async generateImage(
          input: ProviderGatewayImageGenerateRequest
        ): Promise<ProviderGatewayImageGenerateResult> {
          imageCalls.push(input);
          return {
            provider: "openai",
            model: "gpt-image-1",
            prompt: input.prompt,
            size: input.size,
            images: [
              {
                bytesBase64: Buffer.from([
                  0x89,
                  0x50,
                  0x4e,
                  0x47,
                  0x0d,
                  0x0a,
                  0x1a,
                  0x0a,
                  imageCalls.length
                ]).toString("base64"),
                mimeType: "image/png",
                revisedPrompt: null
              }
            ],
            respondedAt: "2026-05-25T12:00:03.000Z",
            usage: null,
            billingFacts: null,
            warning: null
          };
        }
      } as never,
      {} as never,
      createFakeSandboxClientForOutboundWrite("/shared/outbound/self/image-series.png") as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-series",
        name: "image_generate",
        arguments: {
          prompt: "Create a 3-slide carousel about sneakers",
          count: 3,
          outputMode: "series",
          seriesItems: ["slide 1 hero product", "slide 2 product detail", "slide 3 CTA"]
        }
      } as never,
      sessionId: "session-series",
      requestId: "request-series"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(result.artifacts.length, 3);
    assert.equal(imageCalls.length, 3);
    assert.deepEqual(
      imageCalls.map((call) => call.count),
      [1, 1, 1]
    );
    assert.match(imageCalls[0]?.prompt ?? "", /This item only: slide 1 hero product/);
    assert.match(imageCalls[1]?.prompt ?? "", /This item only: slide 2 product detail/);
    assert.match(imageCalls[2]?.prompt ?? "", /This item only: slide 3 CTA/);
    assert.match(
      imageCalls[0]?.prompt ?? "",
      /Keep the same product\/campaign identity, visual world, and brand continuity across all series items/i
    );
  });

  test("keeps already persisted artifacts when a later multi-image item fails", async () => {
    const imageCalls: Array<{ prompt: string; count: number }> = [];
    let savedArtifacts = 0;
    const service = new RuntimeImageGenerateToolService(
      {
        async generateImage(input: { prompt: string; count: number }) {
          imageCalls.push({ prompt: input.prompt, count: input.count });
          if (imageCalls.length <= 2) {
            return {
              provider: "openai",
              model: "gpt-image-2",
              images: [
                {
                  bytesBase64: Buffer.from([
                    0x89,
                    0x50,
                    0x4e,
                    0x47,
                    0x0d,
                    0x0a,
                    0x1a,
                    0x0a,
                    imageCalls.length
                  ]).toString("base64"),
                  mimeType: "image/png",
                  revisedPrompt: null
                }
              ],
              respondedAt: "2026-05-31T00:00:00.000Z",
              usage: null,
              billingFacts: null,
              warning: null
            };
          }
          throw new ProviderGatewaySafetyRejectedError({
            status: 400,
            code: "image_provider_safety_rejected",
            message: "provider blocked final series item",
            providerStatus: {
              provider: "openai",
              requestId: "req_partial_generate_blocked"
            }
          });
        }
      } as never,
      {} as never,
      {
        async writeSharedOutbound(input: { contentBase64: string }) {
          savedArtifacts += 1;
          return {
            workspaceRelPath: `/shared/outbound/self/generate-partial-${String(savedArtifacts)}.png`,
            sizeBytes: Buffer.from(input.contentBase64, "base64").length
          };
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-partial-generate",
        name: "image_generate",
        arguments: {
          prompt: "Create 3 outputs",
          count: 3,
          outputMode: "series",
          seriesItems: ["slide 1", "slide 2", "slide 3"]
        }
      } as never,
      sessionId: "session-partial",
      requestId: "request-partial"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(result.artifacts.length, 2);
    assert.equal(imageCalls.length, 3);
    assert.match(result.payload.warning ?? "", /Stopped after 2 of 3 image\(s\)/);
    assert.match(result.payload.warning ?? "", /safety system/i);
  });

  test("rejects ref-bound series generate when a reusable source image is already available", async () => {
    const service = new RuntimeImageGenerateToolService({} as never, {} as never, {} as never);

    const attachments = [
      {
        attachmentId: "attachment-1",
        kind: "image",
        storagePath: "uploads/source.png",
        mimeType: "image/png",
        displayName: "source.png",
        sizeBytes: 9,
        aliases: ["current image #1", "recent file #1"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-ref-bound-series",
        name: "image_generate",
        arguments: {
          prompt: "Build a 4-slide carousel for this sneaker",
          count: 4,
          outputMode: "series",
          seriesItems: ["hero", "detail", "lifestyle", "cta"]
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-guard",
      requestId: "request-guard"
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "source_image_required");
    assert.match(result.payload.warning ?? "", /image_edit/i);
    assert.match(result.payload.warning ?? "", /sourceImageAlias="current image #1"/i);
  });
});
