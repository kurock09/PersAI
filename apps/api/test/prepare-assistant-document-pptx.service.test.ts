import assert from "node:assert/strict";
import { PrepareAssistantDocumentPptxService } from "../src/modules/workspace-management/application/prepare-assistant-document-pptx.service";

async function run(): Promise<void> {
  const versionRow = {
    id: "version-1",
    sourceJson: {
      prompt: "Create a school deck",
      outputFormat: "pdf",
      requestedName: "Forest.pdf",
      targetSlideCount: 7
    },
    sourceSummaryText: "Create a school deck",
    renderJobs: [{ sourceUserMessageId: "message-1" }]
  };

  {
    const enqueueCalls: unknown[] = [];
    const service = new PrepareAssistantDocumentPptxService(
      {
        assistantDocument: {
          findFirst: async () => ({ currentVersionId: "version-1" })
        },
        assistantDocumentVersion: {
          findFirst: async () => versionRow
        },
        assistantDocumentDeliveredFile: {
          findFirst: async () => ({ assistantFileId: "file-pptx-1" })
        },
        assistantDocumentRenderJob: {
          findFirst: async () => null
        }
      } as never,
      {
        execute: async (input: unknown) => {
          enqueueCalls.push(input);
          throw new Error("enqueue should not run when a PPTX is already delivered");
        }
      } as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      docId: "doc-1",
      versionId: "version-1"
    });
    assert.deepEqual(result, {
      status: "ready",
      docId: "doc-1",
      versionId: "version-1",
      fileRef: "file-pptx-1"
    });
    assert.equal(enqueueCalls.length, 0);
  }

  {
    const service = new PrepareAssistantDocumentPptxService(
      {
        assistantDocument: {
          findFirst: async () => ({ currentVersionId: "version-1" })
        },
        assistantDocumentVersion: {
          findFirst: async () => versionRow
        },
        assistantDocumentDeliveredFile: {
          findFirst: async () => null
        },
        assistantDocumentRenderJob: {
          findFirst: async () => ({ id: "job-running-1" })
        }
      } as never,
      {
        execute: async () => {
          throw new Error("enqueue should not run when a PPTX job is already active");
        }
      } as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      docId: "doc-1"
    });
    assert.deepEqual(result, {
      status: "already_running",
      docId: "doc-1",
      versionId: "version-1",
      renderJobId: "job-running-1"
    });
  }

  {
    const enqueueCalls: Array<{
      directToolExecution: {
        descriptorMode: string;
        request: {
          docId?: string | null;
          outputFormat?: string | null;
          requestedName?: string | null;
        };
      };
      sourceUserMessageId: string;
      sourceUserMessageText: string;
    }> = [];
    const service = new PrepareAssistantDocumentPptxService(
      {
        assistantDocument: {
          findFirst: async () => ({ currentVersionId: "version-1" })
        },
        assistantDocumentVersion: {
          findFirst: async () => versionRow
        },
        assistantDocumentDeliveredFile: {
          findFirst: async () => null
        },
        assistantDocumentRenderJob: {
          findFirst: async () => null
        }
      } as never,
      {
        execute: async (input: (typeof enqueueCalls)[number]) => {
          enqueueCalls.push(input);
          return {
            accepted: true,
            docId: "doc-1",
            versionId: "version-1",
            renderJobId: "job-queued-1",
            documentType: "presentation"
          };
        }
      } as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      docId: "doc-1",
      versionId: "version-1"
    });
    assert.deepEqual(result, {
      status: "queued",
      docId: "doc-1",
      versionId: "version-1",
      renderJobId: "job-queued-1"
    });
    assert.equal(enqueueCalls.length, 1);
    assert.equal(enqueueCalls[0]?.sourceUserMessageId, "message-1");
    assert.equal(enqueueCalls[0]?.sourceUserMessageText, "Create a school deck");
    assert.equal(enqueueCalls[0]?.directToolExecution.descriptorMode, "export_or_redeliver");
    assert.equal(enqueueCalls[0]?.directToolExecution.request.docId, "doc-1");
    assert.equal(enqueueCalls[0]?.directToolExecution.request.outputFormat, "pptx");
    assert.equal(enqueueCalls[0]?.directToolExecution.request.requestedName, "Forest.pptx");
  }

  {
    const service = new PrepareAssistantDocumentPptxService(
      {
        assistantDocument: {
          findFirst: async () => ({ currentVersionId: "version-current" })
        }
      } as never,
      {} as never
    );

    const result = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      docId: "doc-1",
      versionId: "old-version"
    });
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.equal(result.code, "presentation_version_not_available");
    }
  }
}

void run();
