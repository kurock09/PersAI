import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeDocumentJobRunRequest } from "@persai/runtime-contract";
import { InternalRuntimeDocumentJobsController } from "../src/modules/turns/interface/http/internal-runtime-document-jobs.controller";
import type { RuntimeDocumentJobCompletionService } from "../src/modules/turns/runtime-document-job-completion.service";
import type { RuntimeDocumentJobRunService } from "../src/modules/turns/runtime-document-job-run.service";

const INTERNAL_TOKEN = "test-internal-token";

function buildValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assistantId: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    runtimeTier: "paid_shared_restricted",
    runtimeBundleDocument: "{}",
    job: {
      id: "33333333-3333-3333-3333-333333333333",
      docId: "44444444-4444-4444-4444-444444444444",
      versionId: "55555555-5555-5555-5555-555555555555",
      surface: "web",
      chatId: "66666666-6666-6666-6666-666666666666",
      provider: "sandbox",
      outputFormat: "pdf",
      sourceUserMessageId: "77777777-7777-7777-7777-777777777777",
      sourceUserMessageText: "edit the document",
      sourceUserMessageCreatedAt: "2026-05-24T18:00:00.000Z"
    },
    attachments: [],
    sourceFiles: [],
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "revise_document",
      request: {
        prompt: "make the cover page colourful",
        instructions: null,
        outputFormat: "pdf",
        docId: "44444444-4444-4444-4444-444444444444"
      }
    },
    ...overrides
  };
}

function buildController(capture: {
  input: RuntimeDocumentJobRunRequest | null;
}): InternalRuntimeDocumentJobsController {
  const runService = {
    run: async (input: RuntimeDocumentJobRunRequest) => {
      capture.input = input;
      return {
        assistantText: null,
        artifacts: [],
        usage: null,
        toolInvocations: [],
        rawText: null,
        providerStatus: null
      };
    }
  } as unknown as RuntimeDocumentJobRunService;
  const completionService = {} as RuntimeDocumentJobCompletionService;
  const config = {
    PERSAI_INTERNAL_API_TOKEN: INTERNAL_TOKEN
  } as unknown as RuntimeConfig;
  return new InternalRuntimeDocumentJobsController(runService, completionService, config);
}

function buildReq(): { headers: Record<string, string | string[] | undefined> } {
  return { headers: { authorization: `Bearer ${INTERNAL_TOKEN}` } };
}

export async function runInternalRuntimeDocumentJobsControllerTest(): Promise<void> {
  await describe("InternalRuntimeDocumentJobsController.parseInput", () => {
    test("forwards previousVersionRenderedHtml when scheduler attaches it", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      const html = "<!DOCTYPE html><html><body><h1>v2 cover</h1></body></html>";
      await controller.run(buildReq(), buildValidBody({ previousVersionRenderedHtml: html }));
      assert.ok(capture.input, "expected run service to be invoked");
      assert.equal(capture.input?.previousVersionRenderedHtml, html);
    });

    test("omits previousVersionRenderedHtml when scheduler did not attach it (create/legacy)", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      await controller.run(buildReq(), buildValidBody());
      assert.ok(capture.input, "expected run service to be invoked");
      assert.equal(
        Object.prototype.hasOwnProperty.call(capture.input, "previousVersionRenderedHtml"),
        false,
        "previousVersionRenderedHtml must be omitted (not undefined-keyed) when not provided"
      );
    });

    test("collapses empty-string previousVersionRenderedHtml to omitted (no fake patch-revise)", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      await controller.run(buildReq(), buildValidBody({ previousVersionRenderedHtml: "" }));
      assert.ok(capture.input, "expected run service to be invoked");
      assert.equal(
        Object.prototype.hasOwnProperty.call(capture.input, "previousVersionRenderedHtml"),
        false,
        "empty-string previousVersionRenderedHtml must be omitted; adapter would otherwise hit the patch-revise branch with no source HTML"
      );
    });

    test("collapses non-string previousVersionRenderedHtml to omitted", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      await controller.run(buildReq(), buildValidBody({ previousVersionRenderedHtml: 12345 }));
      assert.ok(capture.input, "expected run service to be invoked");
      assert.equal(
        Object.prototype.hasOwnProperty.call(capture.input, "previousVersionRenderedHtml"),
        false
      );
    });
  });
}

if (require.main === module) {
  void runInternalRuntimeDocumentJobsControllerTest();
}
