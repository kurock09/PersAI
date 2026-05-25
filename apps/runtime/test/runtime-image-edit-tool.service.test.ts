import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageEditResult,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  RuntimeAttachmentRef
} from "@persai/runtime-contract";
import { RuntimeImageEditToolService } from "../src/modules/turns/runtime-image-edit-tool.service";
import { ProviderGatewaySafetyRejectedError } from "../src/modules/turns/provider-gateway.client.service";

function createBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    },
    governance: {
      toolPolicies: [
        {
          toolCode: "image_edit",
          visibleToModel: true,
          enabled: true,
          usageRule: "allowed",
          executionMode: "worker"
        }
      ],
      toolCredentialRefs: {
        image_edit: {
          configured: true,
          providerId: "openai",
          modelKey: "gpt-image-1",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/image_edit/api-key"
          }
        }
      }
    },
    runtime: {
      workerTools: {
        tools: [
          {
            toolCode: "image_edit",
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
  } as unknown as AssistantRuntimeBundle;
}

describe("RuntimeImageEditToolService", () => {
  test("retries once with a safer paraphrase after provider safety rejection", async () => {
    const editCalls: ProviderGatewayImageEditRequest[] = [];
    const rewriteCalls: ProviderGatewayTextGenerateRequest[] = [];
    let editCallCount = 0;
    const providerGatewayClient = {
      async editImage(
        input: ProviderGatewayImageEditRequest
      ): Promise<ProviderGatewayImageEditResult> {
        editCalls.push(input);
        editCallCount += 1;
        if (editCallCount === 1) {
          throw new ProviderGatewaySafetyRejectedError({
            status: 400,
            code: "image_provider_safety_rejected",
            message:
              "OpenAI image edit request was rejected by the provider safety system (request id req_edit_safety_1).",
            providerStatus: {
              provider: "openai",
              requestId: "req_edit_safety_1"
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
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01
              ]).toString("base64"),
              mimeType: "image/png",
              revisedPrompt: null
            }
          ],
          respondedAt: "2026-05-25T12:05:00.000Z",
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
              "Edit the portrait into a generic heroic comic-book style with a cape and bold colors, while keeping the same person and pose."
          }),
          respondedAt: "2026-05-25T12:05:01.000Z",
          usage: null,
          stopReason: "completed",
          toolCalls: []
        };
      }
    };
    const service = new RuntimeImageEditToolService(
      providerGatewayClient as never,
      {
        async reserveMonthlyMediaQuota() {
          return { allowed: true };
        },
        async releaseMonthlyMediaQuota() {
          return undefined;
        }
      } as never,
      {
        buildRuntimeOutputObjectKey() {
          return "runtime/image-edit-1.png";
        },
        async saveObject() {
          return {
            objectKey: "runtime/image-edit-1.png",
            mimeType: "image/png",
            sizeBytes: 9
          };
        },
        async downloadObject() {
          return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
        }
      } as never,
      {
        async ensureAttachmentBackedFile() {
          return {
            id: "file-1",
            filename: "portrait-edited.png",
            mimeType: "image/png",
            sizeBytes: 9
          };
        },
        toRuntimeFileRef() {
          return {
            fileRef: "file-1",
            displayName: "portrait-edited.png",
            mimeType: "image/png"
          };
        }
      } as never
    );

    const attachments = [
      {
        attachmentId: "attachment-1",
        kind: "image",
        objectKey: "uploads/source.png",
        mimeType: "image/png",
        filename: "source.png",
        sizeBytes: 9,
        aliases: ["current image #1"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-1",
        name: "image_edit",
        arguments: {
          prompt: "Сделай меня суперменом",
          sourceImageAlias: "current image #1"
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-1",
      requestId: "request-1"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(editCalls.length, 2);
    assert.equal(rewriteCalls.length, 1);
    assert.equal(editCalls[0]?.prompt, "Сделай меня суперменом");
    assert.match(editCalls[1]?.prompt ?? "", /generic heroic comic-book style/i);
    assert.equal(result.payload.revisedPrompt, editCalls[1]?.prompt);
    assert.equal(result.payload.sourceImageAlias, "current image #1");
    assert.match(result.payload.warning ?? "", /retrying once with a safer phrasing/i);
    assert.equal(rewriteCalls[0]?.model, "gpt-5.4-mini");
    assert.equal(result.artifacts.length, 1);
  });

  test("returns a typed safety failure when the single safer retry is also rejected", async () => {
    let editCallCount = 0;
    const service = new RuntimeImageEditToolService(
      {
        async editImage(): Promise<ProviderGatewayImageEditResult> {
          editCallCount += 1;
          throw new ProviderGatewaySafetyRejectedError({
            status: 400,
            code: "image_provider_safety_rejected",
            message: `OpenAI image edit request was rejected by the provider safety system (request id req_edit_retry_${String(
              editCallCount
            )}).`,
            providerStatus: {
              provider: "openai",
              requestId: `req_edit_retry_${String(editCallCount)}`
            }
          });
        },
        async generateText(): Promise<ProviderGatewayTextGenerateResult> {
          return {
            provider: "openai",
            model: "gpt-5.4-mini",
            text: JSON.stringify({
              safePrompt:
                "Edit the image into a generic heroic comic-book portrait with a cape and dramatic colors."
            }),
            respondedAt: "2026-05-25T12:05:02.000Z",
            usage: null,
            stopReason: "completed",
            toolCalls: []
          };
        }
      } as never,
      {
        async reserveMonthlyMediaQuota() {
          return { allowed: true };
        },
        async releaseMonthlyMediaQuota() {
          return undefined;
        }
      } as never,
      {
        async downloadObject() {
          return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
        }
      } as never,
      {} as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-2",
        name: "image_edit",
        arguments: {
          prompt: "Сделай меня суперменом",
          sourceImageAlias: "current image #1"
        }
      } as never,
      availableAttachments: [
        {
          attachmentId: "attachment-1",
          kind: "image",
          objectKey: "uploads/source.png",
          mimeType: "image/png",
          filename: "source.png",
          sizeBytes: 9,
          aliases: ["current image #1"]
        }
      ] as unknown as RuntimeAttachmentRef[],
      sessionId: "session-1",
      requestId: "request-2"
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.reason, "image_provider_safety_rejected");
    assert.equal(
      result.payload.revisedPrompt,
      "Edit the image into a generic heroic comic-book portrait with a cape and dramatic colors."
    );
    assert.match(result.payload.warning ?? "", /also rejected by the provider safety system/i);
    assert.equal(editCallCount, 2);
  });
});
