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

describe("deferred media acknowledgement", () => {
  test("adds a hard follow-up instruction for deferred media jobs", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: unknown[],
        availableWorkingFileRefs: unknown[],
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
      hadRejectedMediaRequest: boolean;
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

  test("normalizes delivery-claiming deferred-media assistant text to honest pending acknowledgement", () => {
    const service = createBareTurnExecutionService() as unknown as CorrectionService;
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "Сделала картинку, держи результат.",
      artifacts: [],
      deferredMediaJobs: [pendingImageJob("job-1")],
      hadRejectedMediaRequest: false,
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });

  test("normalizes any non-empty deferred-media text to honest pending acknowledgement", () => {
    const service = createBareTurnExecutionService() as unknown as CorrectionService;
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "Делаю и пришлю отдельно, когда будет готово.",
      artifacts: [],
      deferredMediaJobs: [pendingImageJob("job-1")],
      hadRejectedMediaRequest: false,
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });

  test("preserves the model's rejection explanation when a turn mixes accepted and rejected media", () => {
    const service = createBareTurnExecutionService() as unknown as CorrectionService;
    const assistantText =
      "Первое изображение принято и придёт отдельно. Второй запрос отклонён: достигнут лимит на этот ход.";
    const corrected = service.applyAssistantTextCorrections({
      assistantText,
      artifacts: [],
      deferredMediaJobs: [pendingImageJob("job-1")],
      hadRejectedMediaRequest: true,
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    // The blunt pending acknowledgement must NOT overwrite the explicit
    // rejection facts; the model's own text is preserved verbatim.
    assert.equal(corrected, assistantText);
  });
});
