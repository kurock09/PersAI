import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

function createBareTurnExecutionService(): TurnExecutionService {
  const deps = Array.from({ length: 25 }, () => ({})) as unknown as ConstructorParameters<
    typeof TurnExecutionService
  >;
  deps[4] = {
    pruneClosedOpenLoopRefsDeveloperBlock(content: string | null) {
      return content;
    }
  } as never;
  deps[23] = new RuntimeObservabilityService() as never;
  deps[24] = new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()) as never;
  return new TurnExecutionService(...deps);
}

describe("deferred document acknowledgement", () => {
  test("adds a hard follow-up instruction for deferred document jobs", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: unknown[],
        availableWorkingFileRefs: unknown[],
        closedOpenLoopRefs: string[],
        hasToolHistory: boolean,
        toolHistory: unknown[],
        availableToolNames: string[],
        forceFinalTextOnly: boolean,
        deferredMediaJobs: [],
        deferredDocumentJobs: Array<{
          jobId: string;
          toolCode: "document";
          descriptorMode: "create_pdf_document";
          documentType: "pdf_document";
        }>
      ) => string | null;
    };
    const instructions = service.buildToolLoopDeveloperInstructions(
      [],
      [],
      [],
      true,
      [],
      [],
      false,
      [],
      [
        {
          jobId: "doc-job-1",
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          documentType: "pdf_document"
        }
      ]
    );
    assert.ok(instructions?.includes("accepted for async background processing"));
    assert.ok(instructions?.includes("pending_delivery with canSendFileNow=false"));
    assert.ok(instructions?.includes("Do not call files.send"));
    assert.ok(instructions?.includes("final document will arrive separately when ready"));
  });

  test("replaces false deferred-document completion claims with a standard RU acknowledgement", () => {
    const service = createBareTurnExecutionService() as unknown as {
      applyAssistantTextCorrections(input: {
        assistantText: string;
        artifacts: unknown[];
        deferredMediaJobs: [];
        deferredDocumentJobs: Array<{
          jobId: string;
          toolCode: "document";
          descriptorMode: "create_presentation";
          documentType: "presentation";
        }>;
        locale: string | null;
      }): string;
    };
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "Готово, вот презентация.",
      artifacts: [],
      deferredMediaJobs: [],
      deferredDocumentJobs: [
        {
          jobId: "doc-job-1",
          toolCode: "document",
          descriptorMode: "create_presentation",
          documentType: "presentation"
        }
      ],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Готовлю презентацию и пришлю её отдельно, когда она будет готова."
    );
  });

  test("blocks files.send while a document from the same turn is pending delivery", async () => {
    const service = createBareTurnExecutionService() as unknown as {
      executeProjectedToolCall: (
        execution: unknown,
        acceptedTurn: unknown,
        input: unknown,
        toolCall: { id: string; name: string; arguments: Record<string, unknown> },
        currentUserMessageId: string | null,
        currentArtifacts: unknown[],
        currentFileRefs: unknown[],
        currentDeferredDocumentJobs: Array<{
          jobId: string;
          toolCode: "document";
          descriptorMode: "revise_document";
          documentType: "pdf_document";
        }>
      ) => Promise<{ payload: { action?: string; reason?: string | null } }>;
    };

    const outcome = await service.executeProjectedToolCall(
      {
        projectedTools: { tools: [{ name: "files" }] },
        bundle: {
          runtime: {
            sharedCompaction: {
              summarizeToolCode: "summarize_context",
              compactToolCode: "compact_context"
            }
          }
        }
      },
      {},
      {},
      {
        id: "tool-files-send-1",
        name: "files",
        arguments: { action: "send", alias: "previous attachment #1" }
      },
      "user-message-1",
      [],
      [],
      [
        {
          jobId: "doc-job-1",
          toolCode: "document",
          descriptorMode: "revise_document",
          documentType: "pdf_document"
        }
      ]
    );

    assert.equal(outcome.payload.action, "skipped");
    assert.equal(outcome.payload.reason, "document_pending_delivery");
  });

  test("blocks files.write_and_send while a document from the same turn is pending delivery", async () => {
    const service = createBareTurnExecutionService() as unknown as {
      executeProjectedToolCall: (
        execution: unknown,
        acceptedTurn: unknown,
        input: unknown,
        toolCall: { id: string; name: string; arguments: Record<string, unknown> },
        currentUserMessageId: string | null,
        currentArtifacts: unknown[],
        currentFileRefs: unknown[],
        currentDeferredDocumentJobs: Array<{
          jobId: string;
          toolCode: "document";
          descriptorMode: "create_pdf_document";
          documentType: "pdf_document";
        }>
      ) => Promise<{
        payload: { action?: string; reason?: string | null; requestedAction?: string | null };
      }>;
    };

    const outcome = await service.executeProjectedToolCall(
      {
        projectedTools: { tools: [{ name: "files" }] },
        bundle: {
          runtime: {
            sharedCompaction: {
              summarizeToolCode: "summarize_context",
              compactToolCode: "compact_context"
            }
          }
        }
      },
      {},
      {},
      {
        id: "tool-files-was-1",
        name: "files",
        arguments: { action: "write_and_send", alias: "result.pdf", content: "..." }
      },
      "user-message-2",
      [],
      [],
      [
        {
          jobId: "doc-job-2",
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          documentType: "pdf_document"
        }
      ]
    );

    assert.equal(outcome.payload.action, "skipped");
    assert.equal(outcome.payload.reason, "document_pending_delivery");
    assert.equal(outcome.payload.requestedAction, "write_and_send");
  });

  test("reorders batch so document executes before files.send when model emits files.send first", () => {
    const service = createBareTurnExecutionService() as unknown as {
      reorderToolCallsDocumentFirst: (
        toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      ) => Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    };

    const reordered = service.reorderToolCallsDocumentFirst([
      { id: "tc-files-1", name: "files", arguments: { action: "send" } },
      { id: "tc-doc-1", name: "document", arguments: { descriptorMode: "create_pdf_document" } }
    ]);

    assert.equal(reordered[0]?.name, "document");
    assert.equal(reordered[1]?.name, "files");
  });

  test("reorderToolCallsDocumentFirst preserves relative order within document and files groups", () => {
    const service = createBareTurnExecutionService() as unknown as {
      reorderToolCallsDocumentFirst: (
        toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      ) => Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    };

    const reordered = service.reorderToolCallsDocumentFirst([
      { id: "tc-files-1", name: "files", arguments: { action: "send" } },
      { id: "tc-other-1", name: "web_search", arguments: {} },
      { id: "tc-doc-1", name: "document", arguments: { descriptorMode: "create_pdf_document" } },
      { id: "tc-files-2", name: "files", arguments: { action: "write_and_send" } },
      { id: "tc-doc-2", name: "document", arguments: { descriptorMode: "create_presentation" } }
    ]);

    assert.equal(reordered[0]?.id, "tc-doc-1");
    assert.equal(reordered[1]?.id, "tc-doc-2");
    assert.equal(reordered[2]?.id, "tc-other-1");
    assert.equal(reordered[3]?.id, "tc-files-1");
    assert.equal(reordered[4]?.id, "tc-files-2");
  });

  test("reorderToolCallsDocumentFirst leaves order unchanged when no document or no files in batch", () => {
    const service = createBareTurnExecutionService() as unknown as {
      reorderToolCallsDocumentFirst: (
        toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      ) => Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    };

    const input = [
      { id: "tc-files-1", name: "files", arguments: { action: "send" } },
      { id: "tc-other-1", name: "web_search", arguments: {} }
    ];
    const reordered = service.reorderToolCallsDocumentFirst(input);
    assert.equal(reordered, input);

    const input2 = [
      { id: "tc-doc-1", name: "document", arguments: { descriptorMode: "create_pdf_document" } },
      { id: "tc-other-1", name: "web_search", arguments: {} }
    ];
    const reordered2 = service.reorderToolCallsDocumentFirst(input2);
    assert.equal(reordered2, input2);
  });
});
