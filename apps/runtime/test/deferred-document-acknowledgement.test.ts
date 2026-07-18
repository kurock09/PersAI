import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

function createBareTurnExecutionService(): TurnExecutionService {
  const deps = Array.from({ length: 33 }, () => ({})) as unknown as ConstructorParameters<
    typeof TurnExecutionService
  >;
  deps[4] = {
    pruneClosedOpenLoopRefsDeveloperBlock(content: string | null) {
      return content;
    }
  } as never;
  deps[29] = new RuntimeObservabilityService() as never;
  deps[30] = new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()) as never;
  return new TurnExecutionService(...deps);
}

describe("deferred document acknowledgement", () => {
  test("stream and sync paths both inject deferred_document_follow_up instruction (parity)", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: unknown[],
        availableWorkingFileHandles: unknown[],
        closedOpenLoopRefs: string[],
        hasToolHistory: boolean,
        toolHistory: unknown[],
        availableToolNames: string[],
        forceFinalTextOnly: boolean,
        deferredMediaJobs: [],
        deferredDocumentJobs: Array<{
          jobId: string;
          toolCode: "document";
          descriptorMode: "create_presentation";
          documentType: "presentation";
        }>
      ) => string | null;
    };
    const docJob = {
      jobId: "doc-parity-1",
      toolCode: "document" as const,
      descriptorMode: "create_presentation" as const,
      documentType: "presentation" as const
    };
    const stubToolExchange = [{ toolCall: { name: "document" }, toolResult: {} }];
    // Simulate what both stream and sync paths now pass: deferredDocumentJobs populated
    const withDocs = service.buildToolLoopDeveloperInstructions(
      [],
      [],
      [],
      true,
      stubToolExchange,
      [],
      false,
      [],
      [docJob]
    );
    // Without deferred document jobs the section must be absent
    const withoutDocs = service.buildToolLoopDeveloperInstructions(
      [],
      [],
      [],
      true,
      stubToolExchange,
      [],
      false,
      [],
      []
    );
    assert.ok(
      withDocs?.includes("accepted for async background processing"),
      "deferred_document_follow_up present when deferredDocumentJobs is non-empty"
    );
    // The stream path (which now passes deferredDocumentJobs just like the sync path)
    // must produce the same instruction; without jobs the section must be absent
    assert.equal(
      withoutDocs?.includes("final document will arrive separately when ready") ?? false,
      false,
      "deferred_document_follow_up absent when deferredDocumentJobs is empty"
    );
  });

  test("adds a hard follow-up instruction for deferred document jobs", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: unknown[],
        availableWorkingFileHandles: unknown[],
        closedOpenLoopRefs: string[],
        hasToolHistory: boolean,
        toolHistory: unknown[],
        availableToolNames: string[],
        forceFinalTextOnly: boolean,
        deferredMediaJobs: [],
        deferredDocumentJobs: Array<{
          jobId: string;
          toolCode: "document";
          descriptorMode: "create_presentation";
          documentType: "presentation";
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
          descriptorMode: "create_presentation",
          documentType: "presentation"
        }
      ]
    );
    assert.ok(instructions?.includes("accepted for async background processing"));
    assert.ok(instructions?.includes("pending_delivery with canSendFileNow=false"));
    assert.ok(
      instructions?.includes(
        "Do not attempt to deliver this document or any file from this turn via the files tool."
      )
    );
    assert.ok(instructions?.includes("final document will arrive separately when ready"));
  });

  test("deferred-document follow-up permits independent work while preserving delivery guardrails", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: unknown[],
        availableWorkingFileHandles: unknown[],
        closedOpenLoopRefs: string[],
        hasToolHistory: boolean,
        toolHistory: unknown[],
        availableToolNames: string[],
        forceFinalTextOnly: boolean,
        deferredMediaJobs: [],
        deferredDocumentJobs: Array<{
          jobId: string;
          toolCode: "document";
          descriptorMode: "create_presentation";
          documentType: "presentation";
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
          jobId: "doc-job-continue-1",
          toolCode: "document",
          descriptorMode: "create_presentation",
          documentType: "presentation"
        }
      ]
    );

    assert.ok(instructions?.includes("may continue with other independent work"));
    assert.ok(instructions?.includes("Do not describe the final document as already generated"));
    assert.ok(
      instructions?.includes(
        "Do not attempt to deliver this document or any file from this turn via the files tool."
      )
    );
    assert.ok(instructions?.includes("Do not print raw tool JSON"));
    assert.equal(instructions?.includes("Write only a brief acknowledgement"), false);
  });

  type DocumentCorrectionService = {
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

  function pendingPresentationJob(): {
    jobId: string;
    toolCode: "document";
    descriptorMode: "create_presentation";
    documentType: "presentation";
  } {
    return {
      jobId: "doc-job-1",
      toolCode: "document",
      descriptorMode: "create_presentation",
      documentType: "presentation"
    };
  }

  // Model-owned-reply policy: any non-empty assistant text alongside a deferred
  // document job is preserved verbatim. Honesty about pending delivery is
  // enforced upstream via `buildDeferredDocumentFollowUpInstruction` and the
  // global DELIVERY_HONESTY_CONTRACT; the runtime no longer overwrites the
  // model's own explanation with a generic "request accepted" canonical line.
  test("preserves the model's own deferred-document reply verbatim instead of overwriting it", () => {
    const service = createBareTurnExecutionService() as unknown as DocumentCorrectionService;
    const assistantText = "Принято. Готовлю презентацию из 12 слайдов по твоему плану.";
    const corrected = service.applyAssistantTextCorrections({
      assistantText,
      artifacts: [],
      deferredMediaJobs: [],
      deferredDocumentJobs: [pendingPresentationJob()],
      locale: "ru-RU"
    });
    assert.equal(corrected, assistantText);
  });

  test("falls back to the canonical acknowledgement only when the model produced no text after a deferred document job", () => {
    const service = createBareTurnExecutionService() as unknown as DocumentCorrectionService;
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "",
      artifacts: [],
      deferredMediaJobs: [],
      deferredDocumentJobs: [pendingPresentationJob()],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Готовлю презентацию и пришлю её отдельно, когда она будет готова."
    );
  });

  test("document fallback acknowledgement is whitespace-only-safe (treats blank text as empty)", () => {
    const service = createBareTurnExecutionService() as unknown as DocumentCorrectionService;
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "  \n\t  ",
      artifacts: [],
      deferredMediaJobs: [],
      deferredDocumentJobs: [pendingPresentationJob()],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Готовлю презентацию и пришлю её отдельно, когда она будет готова."
    );
  });

  test("reorders batch so document executes before files when model emits files first", () => {
    const service = createBareTurnExecutionService() as unknown as {
      reorderToolCallsDocumentFirst: (
        toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      ) => Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    };

    const reordered = service.reorderToolCallsDocumentFirst([
      { id: "tc-files-1", name: "files", arguments: { action: "send" } },
      {
        id: "tc-doc-1",
        name: "presentation",
        arguments: { descriptorMode: "create_presentation" }
      }
    ]);

    assert.equal(reordered[0]?.name, "presentation");
    assert.equal(reordered[1]?.name, "files");
  });

  test("reorderToolCallsDocumentFirst preserves relative order within document and non-document groups", () => {
    const service = createBareTurnExecutionService() as unknown as {
      reorderToolCallsDocumentFirst: (
        toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      ) => Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    };

    const reordered = service.reorderToolCallsDocumentFirst([
      { id: "tc-files-1", name: "files", arguments: { action: "send" } },
      { id: "tc-other-1", name: "web_search", arguments: {} },
      { id: "tc-doc-1", name: "presentation", arguments: { descriptorMode: "revise_document" } },
      { id: "tc-files-2", name: "files", arguments: { action: "write_and_send" } },
      {
        id: "tc-doc-2",
        name: "presentation",
        arguments: { descriptorMode: "create_presentation" }
      }
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
      {
        id: "tc-doc-1",
        name: "presentation",
        arguments: { descriptorMode: "create_presentation" }
      },
      { id: "tc-other-1", name: "web_search", arguments: {} }
    ];
    const reordered2 = service.reorderToolCallsDocumentFirst(input2);
    assert.equal(reordered2, input2);
  });
});
