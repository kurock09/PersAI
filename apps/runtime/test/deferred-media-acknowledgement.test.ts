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
          kind: "image"
        }
      ],
      []
    );
    assert.ok(instructions?.includes("accepted for async background processing"));
    assert.ok(instructions?.includes("will arrive separately when ready"));
  });

  test("normalizes delivery-claiming deferred-media assistant text to honest pending acknowledgement", () => {
    const service = createBareTurnExecutionService() as unknown as {
      applyAssistantTextCorrections(input: {
        assistantText: string;
        artifacts: unknown[];
        deferredMediaJobs: Array<{
          jobId: string;
          toolCode: "image_generate" | "image_edit" | "video_generate";
          kind: "image" | "video";
        }>;
        deferredDocumentJobs: [];
        locale: string | null;
      }): string;
    };
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "Сделала картинку, держи результат.",
      artifacts: [],
      deferredMediaJobs: [
        {
          jobId: "job-1",
          toolCode: "image_generate",
          kind: "image"
        }
      ],
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });

  test("normalizes any non-empty deferred-media text to honest pending acknowledgement", () => {
    const service = createBareTurnExecutionService() as unknown as {
      applyAssistantTextCorrections(input: {
        assistantText: string;
        artifacts: unknown[];
        deferredMediaJobs: Array<{
          jobId: string;
          toolCode: "image_generate" | "image_edit" | "video_generate";
          kind: "image" | "video";
        }>;
        deferredDocumentJobs: [];
        locale: string | null;
      }): string;
    };
    const corrected = service.applyAssistantTextCorrections({
      assistantText: "Делаю и пришлю отдельно, когда будет готово.",
      artifacts: [],
      deferredMediaJobs: [
        {
          jobId: "job-1",
          toolCode: "image_generate",
          kind: "image"
        }
      ],
      deferredDocumentJobs: [],
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });
});
