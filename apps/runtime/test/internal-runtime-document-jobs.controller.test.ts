import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BadRequestException } from "@nestjs/common";
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
    runtimeSessionId: "88888888-8888-8888-8888-888888888888",
    runtimeTier: "paid_shared_restricted",
    runtimeBundleDocument: "{}",
    job: {
      id: "33333333-3333-3333-3333-333333333333",
      docId: "44444444-4444-4444-4444-444444444444",
      versionId: "55555555-5555-5555-5555-555555555555",
      surface: "web",
      chatId: "66666666-6666-6666-6666-666666666666",
      provider: "gamma",
      outputFormat: "pptx",
      sourceUserMessageId: "77777777-7777-7777-7777-777777777777",
      sourceUserMessageText: "make a deck",
      sourceUserMessageCreatedAt: "2026-05-24T18:00:00.000Z"
    },
    attachments: [],
    sourceFiles: [],
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_presentation",
      request: {
        prompt: "make a deck about ocean biology",
        instructions: null,
        outputFormat: "pptx"
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
    test("parses a valid presentation create_presentation body end to end", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      await controller.run(buildReq(), buildValidBody());
      assert.ok(capture.input, "expected run service to be invoked");
      assert.equal(capture.input?.job.provider, "gamma");
      assert.equal(capture.input?.job.outputFormat, "pptx");
      assert.equal(capture.input?.directToolExecution.descriptorMode, "create_presentation");
    });

    test("rejects non-gamma providers at the parse boundary", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      const body = buildValidBody({
        job: {
          ...((buildValidBody().job as Record<string, unknown>) ?? {}),
          provider: "sandbox"
        }
      });
      await assert.rejects(
        () => controller.run(buildReq(), body),
        (error: unknown) =>
          error instanceof BadRequestException && /presentation-only worker/.test(error.message)
      );
    });

    test("rejects retired descriptor modes at the parse boundary", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      const body = buildValidBody({
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "create a PDF document",
            instructions: null,
            outputFormat: "pdf"
          }
        }
      });
      await assert.rejects(
        () => controller.run(buildReq(), body),
        (error: unknown) =>
          error instanceof BadRequestException &&
          /create_presentation, revise_document, or export_or_redeliver/.test(error.message)
      );
    });

    test("rejects xlsx/docx output formats at the parse boundary", async () => {
      const capture: { input: RuntimeDocumentJobRunRequest | null } = { input: null };
      const controller = buildController(capture);
      const body = buildValidBody({
        job: {
          ...((buildValidBody().job as Record<string, unknown>) ?? {}),
          outputFormat: "xlsx"
        }
      });
      await assert.rejects(
        () => controller.run(buildReq(), body),
        (error: unknown) =>
          error instanceof BadRequestException && /one of pdf or pptx/.test(error.message)
      );
    });
  });
}

export const __INTERNAL_TOKEN__ = INTERNAL_TOKEN;
