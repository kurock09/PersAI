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
});
