import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { RuntimeDocumentToolService } from "../src/modules/turns/runtime-document-tool.service";

function createBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1"
    }
  } as AssistantRuntimeBundle;
}

describe("RuntimeDocumentToolService", () => {
  test("returns deferred payload when document enqueue is accepted", async () => {
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob() {
        return {
          accepted: true as const,
          jobId: "doc-job-1",
          documentType: "pdf_document" as const
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "create_pdf_document",
          prompt: "Create a one-page brief",
          outputFormat: "pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-1",
        sourceUserMessageText: "Сделай PDF",
        attachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "deferred");
    assert.equal(result.payload.jobId, "doc-job-1");
    assert.equal(result.payload.toolCode, "document");
  });

  test("forwards referenced previous source attachment for new PDF document jobs", async () => {
    const capturedAttachments: unknown[][] = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: { attachments: unknown[] }) {
        capturedAttachments.push(input.attachments);
        return {
          accepted: true as const,
          jobId: "doc-job-1",
          documentType: "pdf_document" as const
        };
      }
    } as never);

    await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "create_pdf_document",
          prompt: "Создай новый PDF на основе прикреплённого документа",
          outputFormat: "pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-2",
        sourceUserMessageText: "Создай новый PDF на основе моего документа",
        attachments: [
          {
            attachmentId: "att-previous-pdf",
            kind: "file",
            objectKey: "assistant-media/source.pdf",
            mimeType: "application/pdf",
            filename: "source.pdf",
            sizeBytes: 1024,
            aliases: ["previous attachment #1"]
          }
        ]
      }
    });

    const attachments = capturedAttachments[0] ?? [];
    assert.equal(attachments.length, 1);
    assert.deepEqual(attachments[0], {
      attachmentId: "att-previous-pdf",
      kind: "file",
      objectKey: "assistant-media/source.pdf",
      mimeType: "application/pdf",
      filename: "source.pdf",
      sizeBytes: 1024,
      aliases: ["previous attachment #1"]
    });
  });

  test("does not leak previous source attachments into unrelated new PDF jobs", async () => {
    const capturedAttachments: unknown[][] = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: { attachments: unknown[] }) {
        capturedAttachments.push(input.attachments);
        return {
          accepted: true as const,
          jobId: "doc-job-1",
          documentType: "pdf_document" as const
        };
      }
    } as never);

    await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "create_pdf_document",
          prompt: "Create a short PDF about quarterly pricing",
          outputFormat: "pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-3",
        sourceUserMessageText: "Сделай PDF про тарифы PersAI",
        attachments: [
          {
            attachmentId: "att-previous-pdf",
            kind: "file",
            objectKey: "assistant-media/source.pdf",
            mimeType: "application/pdf",
            filename: "source.pdf",
            sizeBytes: 1024,
            aliases: ["previous attachment #1"]
          }
        ]
      }
    });

    assert.deepEqual(capturedAttachments[0], []);
  });

  test("treats revise_document against an attached source file as new PDF creation", async () => {
    const capturedInputs: Array<{
      attachments: unknown[];
      directToolExecution: { descriptorMode: string; request: { docId?: string | null } };
    }> = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: {
        attachments: unknown[];
        directToolExecution: { descriptorMode: string; request: { docId?: string | null } };
      }) {
        capturedInputs.push(input);
        return {
          accepted: true as const,
          jobId: "doc-job-1",
          documentType: "pdf_document" as const
        };
      }
    } as never);

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "revise_document",
          prompt: "Пересобери приложенный PDF в новом светло-зелёном стиле",
          docId: "previous attachment #1",
          outputFormat: "pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-4",
        sourceUserMessageText: "Пересобери мой документ в новый PDF",
        attachments: [
          {
            attachmentId: "att-current-pdf",
            kind: "file",
            objectKey: "assistant-media/current.pdf",
            mimeType: "application/pdf",
            filename: "current.pdf",
            sizeBytes: 2048,
            aliases: ["current attachment #1"]
          }
        ]
      }
    });

    const input = capturedInputs[0]!;
    assert.equal(input.directToolExecution.descriptorMode, "create_pdf_document");
    assert.equal(input.directToolExecution.request.docId, null);
    assert.equal(input.attachments.length, 1);
    assert.equal(result.payload.descriptorMode, "create_pdf_document");
  });

  test("maps rejected enqueue into skipped payload", async () => {
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob() {
        return {
          accepted: false as const,
          code: "document_quota_reached",
          message: "Document quota reached.",
          guidance: "Upgrade or wait for the next period."
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "export_or_redeliver",
          prompt: "Resend the latest file",
          docId: "doc-1",
          outputFormat: "pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-1",
        sourceUserMessageText: "Отправь документ еще раз",
        attachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "document_quota_reached");
    assert.equal(result.payload.guidance, "Upgrade or wait for the next period.");
  });
});
