import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

function createBareTurnExecutionService(): TurnExecutionService {
  const deps = Array.from({ length: 34 }, () => ({})) as unknown as ConstructorParameters<
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

describe("deferred media acknowledgement", () => {
  test("adds a hard follow-up instruction for deferred media jobs", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: unknown[],
        availableWorkingFileHandles: unknown[],
        closedOpenLoopRefs: string[],
        hasToolHistory: boolean,
        toolHistory: unknown[],
        availableToolNames: string[],
        forceFinalTextOnly: boolean,
        deferredMediaJobs: Array<{
          jobId: string;
          toolCode: "image_generate" | "image_edit" | "video_generate";
          kind: "image" | "video";
          action: "pending_delivery";
          canSendFileNow: false;
          messageToUser: string | null;
          requestedCount: number | null;
          expectedResultCount: number | null;
        }>,
        deferredDocumentJobs: []
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
      [
        {
          jobId: "job-1",
          toolCode: "image_generate",
          kind: "image",
          action: "pending_delivery",
          canSendFileNow: false,
          messageToUser: "Accepted. The image will be delivered separately.",
          requestedCount: 1,
          expectedResultCount: 1
        }
      ],
      []
    );
    assert.ok(instructions?.includes("accepted for async background processing"));
    assert.ok(instructions?.includes("will arrive separately when ready"));
  });

  test("deferred-media follow-up permits independent work while preserving honesty guardrails", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: unknown[],
        availableWorkingFileHandles: unknown[],
        closedOpenLoopRefs: string[],
        hasToolHistory: boolean,
        toolHistory: unknown[],
        availableToolNames: string[],
        forceFinalTextOnly: boolean,
        deferredMediaJobs: Array<{
          jobId: string;
          toolCode: "image_generate" | "image_edit" | "video_generate";
          kind: "image" | "video";
          action: "pending_delivery";
          canSendFileNow: false;
          messageToUser: string | null;
          requestedCount: number | null;
          expectedResultCount: number | null;
        }>,
        deferredDocumentJobs: []
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
      [
        {
          jobId: "job-continue-1",
          toolCode: "image_generate",
          kind: "image",
          action: "pending_delivery",
          canSendFileNow: false,
          messageToUser: "Accepted. The image will be delivered separately.",
          requestedCount: 1,
          expectedResultCount: 1
        }
      ],
      []
    );

    assert.ok(instructions?.includes("may continue with other independent work"));
    assert.ok(instructions?.includes("Do not describe the final media as already generated"));
    assert.ok(instructions?.includes("Do not print raw tool JSON"));
    assert.equal(instructions?.includes("Write only a brief acknowledgement"), false);
  });

  type DeferredMediaJobFixture = {
    jobId: string;
    toolCode: "image_generate" | "image_edit" | "video_generate";
    kind: "image" | "video";
    action: "pending_delivery";
    canSendFileNow: false;
    messageToUser: string | null;
    requestedCount: number | null;
    expectedResultCount: number | null;
  };

  type CorrectionService = {
    applyAssistantTextCorrections(input: {
      assistantText: string;
      artifacts: unknown[];
      deferredMediaJobs: DeferredMediaJobFixture[];
      deferredDocumentJobs: [];
      locale: string | null;
    }): string;
  };

  function pendingImageJob(jobId: string): DeferredMediaJobFixture {
    return {
      jobId,
      toolCode: "image_generate",
      kind: "image",
      action: "pending_delivery",
      canSendFileNow: false,
      messageToUser: "Accepted. The image will be delivered separately.",
      requestedCount: 1,
      expectedResultCount: 1
    };
  }

  // Model-owned-reply policy: any non-empty assistant text alongside a deferred
  // media job is preserved verbatim. Honesty about pending delivery is enforced
  // upstream via `buildDeferredMediaFollowUpInstruction` and the global
  // DELIVERY_HONESTY_CONTRACT; the runtime no longer overwrites the model's
  // own explanation with a generic "request accepted" canonical line.
  test("preserves the model's own deferred-media reply verbatim instead of overwriting it", () => {
    const service = createBareTurnExecutionService() as unknown as CorrectionService;
    const assistantText = "Принято. Делаю карусель в твоей стилистике, скоро пришлю.";
    const corrected = service.applyAssistantTextCorrections({
      assistantText,
      artifacts: [],
      deferredMediaJobs: [pendingImageJob("job-1")],
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(corrected, assistantText);
  });

  test("preserves the model's rejection explanation when a turn mixes accepted and rejected media", () => {
    const service = createBareTurnExecutionService() as unknown as CorrectionService;
    const assistantText =
      "Первое изображение принято и придёт отдельно. Второй запрос отклонён: достигнут лимит на этот ход.";
    const corrected = service.applyAssistantTextCorrections({
      assistantText,
      artifacts: [],
      deferredMediaJobs: [pendingImageJob("job-1")],
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(corrected, assistantText);
  });

  test("falls back to the canonical acknowledgement only when the model produced no text after a deferred media job", () => {
    const service = createBareTurnExecutionService() as unknown as CorrectionService;
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "",
      artifacts: [],
      deferredMediaJobs: [pendingImageJob("job-1")],
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });

  test("fallback acknowledgement is whitespace-only-safe (treats blank text as empty)", () => {
    const service = createBareTurnExecutionService() as unknown as CorrectionService;
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "   \n  ",
      artifacts: [],
      deferredMediaJobs: [pendingImageJob("job-1")],
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });
});
