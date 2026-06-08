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
      {} as never,
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
        aliases: ["current image #1", "image #1", "file #1"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-1",
        name: "image_edit",
        arguments: {
          prompt: "Сделай меня суперменом",
          sourceImageAlias: "image #1"
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-1",
      requestId: "request-1"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(result.payload.requestedCount, 1);
    assert.equal(editCalls[0]?.count, 1);
    assert.equal(editCalls.length, 2);
    assert.equal(rewriteCalls.length, 1);
    assert.equal(editCalls[0]?.prompt, "Сделай меня суперменом");
    assert.match(editCalls[1]?.prompt ?? "", /generic heroic comic-book style/i);
    assert.equal(result.payload.revisedPrompt, editCalls[1]?.prompt);
    assert.equal(result.payload.sourceImageAlias, "image #1");
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
      {} as never,
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
          sourceImageAlias: "image #1"
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
          aliases: ["image #1"]
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

  test("selects source and reference images via explicit structural aliases", async () => {
    let capturedRequest: ProviderGatewayImageEditRequest | undefined;
    const service = new RuntimeImageEditToolService(
      {
        async editImage(
          input: ProviderGatewayImageEditRequest
        ): Promise<ProviderGatewayImageEditResult> {
          capturedRequest = input;
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
            respondedAt: "2026-05-31T00:00:00.000Z",
            usage: null,
            billingFacts: null,
            warning: null
          };
        }
      } as never,
      {} as never,
      {
        buildRuntimeOutputObjectKey() {
          return "runtime/image-edit-ref.png";
        },
        async saveObject() {
          return { objectKey: "runtime/image-edit-ref.png", mimeType: "image/png", sizeBytes: 9 };
        },
        async downloadObject() {
          return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
        }
      } as never,
      {
        async ensureAttachmentBackedFile() {
          return {
            id: "file-ref-1",
            filename: "source-edited.png",
            mimeType: "image/png",
            sizeBytes: 9
          };
        },
        toRuntimeFileRef() {
          return { fileRef: "file-ref-1", displayName: "source-edited.png", mimeType: "image/png" };
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
        aliases: ["image #1"]
      },
      {
        attachmentId: "attachment-2",
        kind: "image",
        objectKey: "uploads/reference.png",
        mimeType: "image/png",
        filename: "reference.png",
        sizeBytes: 9,
        aliases: ["current image #2", "image #2", "file #2"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-ref",
        name: "image_edit",
        arguments: {
          prompt: "Apply the style of the reference image",
          sourceImageAlias: "image #1",
          referenceImageAlias: "image #2"
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-ref",
      requestId: "request-ref"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(result.payload.sourceImageAlias, "image #1");
    assert.equal(result.payload.referenceImageAlias, "image #2");
    assert.ok(
      capturedRequest?.referenceImage !== null,
      "reference image must be passed to provider"
    );
  });

  test("returns source_image_alias_required when multiple images present and no alias provided", async () => {
    const service = new RuntimeImageEditToolService(
      {} as never,
      {} as never,
      {
        async downloadObject() {
          return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
        }
      } as never,
      {} as never
    );

    const attachments = [
      {
        attachmentId: "attachment-1",
        kind: "image",
        objectKey: "uploads/a.png",
        mimeType: "image/png",
        filename: "a.png",
        sizeBytes: 9,
        aliases: ["image #1"]
      },
      {
        attachmentId: "attachment-2",
        kind: "image",
        objectKey: "uploads/b.png",
        mimeType: "image/png",
        filename: "b.png",
        sizeBytes: 9,
        aliases: ["image #2"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-guard",
        name: "image_edit",
        arguments: {
          prompt: "make it brighter"
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-guard",
      requestId: "request-guard"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "source_image_alias_required");
  });

  test("wires count into the enqueue request and returns pending_delivery when accepted", async () => {
    const enqueueCalls: Array<{ toolCode: string; request: { count?: number } }> = [];
    const service = new RuntimeImageEditToolService(
      {} as never,
      {
        async enqueueDeferredMediaJob(input: {
          directToolExecution: { toolCode: string; request: { count?: number } };
        }) {
          enqueueCalls.push(input.directToolExecution);
          return { accepted: true, jobId: "media-job-7", kind: "image" };
        }
      } as never,
      {
        async downloadObject() {
          return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
        }
      } as never,
      {} as never
    );

    const attachments = [
      {
        attachmentId: "attachment-1",
        kind: "image",
        objectKey: "uploads/source.png",
        mimeType: "image/png",
        filename: "source.png",
        sizeBytes: 9,
        aliases: ["image #1"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-1",
        name: "image_edit",
        arguments: {
          prompt: "Make the background a sunset",
          sourceImageAlias: "image #1",
          count: 2
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncMediaJob: {
        sourceUserMessageId: "message-1",
        sourceUserMessageText: "Make the background a sunset"
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "pending_delivery");
    assert.equal(result.payload.canSendFileNow, false);
    assert.equal(result.payload.jobId, "media-job-7");
    assert.equal(result.payload.requestedCount, 2);
    assert.equal(result.payload.expectedResultCount, 2);
    assert.equal(typeof result.payload.messageToUser, "string");
    assert.equal(enqueueCalls.length, 1);
    assert.equal(enqueueCalls[0]?.toolCode, "image_edit");
    assert.equal(enqueueCalls[0]?.request.count, 2);
  });

  test("runs edit series mode as multiple single-image provider calls", async () => {
    const editCalls: ProviderGatewayImageEditRequest[] = [];
    const service = new RuntimeImageEditToolService(
      {
        async editImage(
          input: ProviderGatewayImageEditRequest
        ): Promise<ProviderGatewayImageEditResult> {
          editCalls.push(input);
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
                  editCalls.length
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
      } as never,
      {} as never,
      {
        buildRuntimeOutputObjectKey() {
          return `runtime/edit-series-${String(editCalls.length)}.png`;
        },
        async saveObject() {
          return {
            objectKey: `runtime/edit-series-${String(editCalls.length)}.png`,
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
            id: `file-series-${String(editCalls.length)}`,
            filename: `series-${String(editCalls.length)}.png`,
            mimeType: "image/png",
            sizeBytes: 9
          };
        },
        toRuntimeFileRef(file: { id: string; filename: string; mimeType: string }) {
          return { fileRef: file.id, displayName: file.filename, mimeType: file.mimeType };
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
        aliases: ["image #1"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-series-edit",
        name: "image_edit",
        arguments: {
          prompt: "Create a 3-frame edited story",
          sourceImageAlias: "image #1",
          count: 3,
          outputMode: "series",
          seriesItems: ["frame 1 warmer hero shot", "frame 2 close detail", "frame 3 CTA overlay"]
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-series",
      requestId: "request-series"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(result.artifacts.length, 3);
    assert.equal(editCalls.length, 3);
    assert.deepEqual(
      editCalls.map((call) => call.count),
      [1, 1, 1]
    );
    assert.match(editCalls[0]?.prompt ?? "", /This item only: frame 1 warmer hero shot/);
    assert.match(
      editCalls[0]?.prompt ?? "",
      /Keep the same source product\/object identity from image #1 across every series item/i
    );
  });

  test("keeps already persisted artifacts when a later multi-image item fails", async () => {
    const editCalls: Array<{ prompt: string; count: number }> = [];
    let savedArtifacts = 0;
    const service = new RuntimeImageEditToolService(
      {
        async editImage(input: { prompt: string; count: number }) {
          editCalls.push({ prompt: input.prompt, count: input.count });
          if (editCalls.length <= 2) {
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
                    editCalls.length
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
              requestId: "req_partial_edit_blocked"
            }
          });
        }
      } as never,
      {} as never,
      {
        buildRuntimeOutputObjectKey(input: {
          assistantId: string;
          sessionId: string;
          requestId: string;
          artifactId?: string;
          extension: string | null;
        }) {
          const extension = input.extension ?? "png";
          return `assistant-media/assistants/${input.assistantId}/runtime-output/sessions/${input.sessionId}/requests/${input.requestId}/${input.artifactId ?? "artifact"}.${extension}`;
        },
        async saveObject() {
          savedArtifacts += 1;
          return {
            objectKey: `runtime/edit-partial-${String(savedArtifacts)}.png`,
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
            id: `file-partial-${String(savedArtifacts)}`,
            filename: `partial-${String(savedArtifacts)}.png`,
            mimeType: "image/png",
            sizeBytes: 9
          };
        },
        toRuntimeFileRef(file: { id: string; filename: string; mimeType: string }) {
          return { fileRef: file.id, displayName: file.filename, mimeType: file.mimeType };
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
        aliases: ["image #1"]
      }
    ] as unknown as RuntimeAttachmentRef[];

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "call-partial-series-edit",
        name: "image_edit",
        arguments: {
          prompt: "Create 3 edited outputs",
          sourceImageAlias: "image #1",
          count: 3,
          outputMode: "series",
          seriesItems: ["frame 1", "frame 2", "frame 3"]
        }
      } as never,
      availableAttachments: attachments,
      sessionId: "session-partial",
      requestId: "request-partial"
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "generated");
    assert.equal(result.artifacts.length, 2);
    assert.equal(editCalls.length, 3);
    assert.match(result.payload.warning ?? "", /Stopped after 2 of 3 image\(s\)/);
    assert.match(result.payload.warning ?? "", /safety system/i);
  });
});
