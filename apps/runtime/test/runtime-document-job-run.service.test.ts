import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeDocumentJobRunService } from "../src/modules/turns/runtime-document-job-run.service";
import { RuntimeExecutionAdmissionService } from "../src/modules/turns/runtime-execution-admission.service";

describe("RuntimeDocumentJobRunService", () => {
  test("routes document jobs through the provider boundary and preserves provider result", async () => {
    let capturedRequest: Record<string, unknown> | null = null;
    const service = new RuntimeDocumentJobRunService(
      new RuntimeExecutionAdmissionService(new RuntimeObservabilityService()),
      {
        run: async (input: Record<string, unknown>) => {
          capturedRequest = input;
          return {
            assistantText: null,
            artifacts: [
              {
                artifactId: "artifact-1",
                file: {
                  sourceToolCode: "document",
                  storagePath: "assistant-media/test.pdf",
                  displayName: "brief.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 123,
                  logicalSizeBytes: 123
                },
                kind: "file",
                sourceToolCode: "document",
                storagePath: "assistant-media/test.pdf",
                mimeType: "application/pdf",
                filename: "brief.pdf",
                sizeBytes: 123,
                voiceNote: false
              }
            ],
            usage: null,
            toolInvocations: [
              {
                name: "document",
                iteration: 1,
                ok: true,
                executionMode: "worker"
              }
            ],
            rawText: null,
            providerStatus: {
              provider: "sandbox",
              state: "success"
            }
          };
        }
      } as never
    );

    const result = await service.run({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeSessionId: "runtime-session-1",
      runtimeTier: "paid_shared_restricted",
      runtimeBundleDocument: JSON.stringify({
        metadata: {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          publishedVersionId: "version-1"
        },
        runtime: {},
        promptConstructor: {}
      }),
      job: {
        id: "job-1",
        docId: "doc-1",
        versionId: "version-1",
        surface: "web",
        chatId: "chat-1",
        provider: "gamma",
        outputFormat: "pptx",
        sourceUserMessageId: "message-1",
        sourceUserMessageText: "Make a startup deck",
        sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z"
      },
      attachments: [],
      directToolExecution: {
        toolCode: "document",
        descriptorMode: "create_presentation",
        request: {
          prompt: "Make a startup deck",
          requestedName: "startup-deck"
        }
      }
    });

    assert.equal(result.assistantText, null);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.toolInvocations[0]?.name, "document");
    assert.equal(result.providerStatus?.state, "success");
    assert.ok(capturedRequest);
    assert.equal(
      (capturedRequest as { request: { job: { provider: string } } }).request.job.provider,
      "gamma"
    );
  });
});
