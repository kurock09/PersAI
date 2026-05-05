import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

function createBareTurnExecutionService(): TurnExecutionService {
  const deps = Array.from({ length: 21 }, () => ({})) as unknown as ConstructorParameters<
    typeof TurnExecutionService
  >;
  return new TurnExecutionService(...deps);
}

describe("deferred media acknowledgement", () => {
  test("adds a hard follow-up instruction for deferred media jobs", () => {
    const service = createBareTurnExecutionService() as unknown as {
      buildToolLoopDeveloperInstructions: (
        existing: string | null,
        hasToolHistory: boolean,
        forceFinalTextOnly: boolean,
        deferredMediaJobs: Array<{
          jobId: string;
          toolCode: "image_generate" | "image_edit" | "video_generate";
          kind: "image" | "video";
        }>
      ) => string | null;
    };
    const instructions = service.buildToolLoopDeveloperInstructions(null, true, false, [
      {
        jobId: "job-1",
        toolCode: "image_generate",
        kind: "image"
      }
    ]);
    assert.ok(instructions?.includes("accepted for async background processing"));
    assert.ok(instructions?.includes("will arrive separately when ready"));
  });

  test("replaces false deferred-media completion claims with a standard RU acknowledgement", () => {
    const service = createBareTurnExecutionService() as unknown as {
      applyAssistantTextCorrections(input: {
        assistantText: string;
        artifacts: unknown[];
        deferredMediaJobs: Array<{
          jobId: string;
          toolCode: "image_generate" | "image_edit" | "video_generate";
          kind: "image" | "video";
        }>;
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
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });

  test("normalizes even an honest deferred-media acknowledgement to the standard copy", () => {
    const service = createBareTurnExecutionService() as unknown as {
      applyAssistantTextCorrections(input: {
        assistantText: string;
        artifacts: unknown[];
        deferredMediaJobs: Array<{
          jobId: string;
          toolCode: "image_generate" | "image_edit" | "video_generate";
          kind: "image" | "video";
        }>;
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
      locale: "ru-RU"
    });
    assert.equal(
      corrected,
      "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово."
    );
  });
});
