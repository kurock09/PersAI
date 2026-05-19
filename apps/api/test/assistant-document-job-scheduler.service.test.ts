import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantDocumentJobSchedulerService } from "../src/modules/workspace-management/application/assistant-document-job-scheduler.service";

describe("AssistantDocumentJobSchedulerService", () => {
  test("does not requeue a failed runtime attempt when the worker lost its claim", async () => {
    const topLevelUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [],
            assistantDocumentRenderJob: {
              update: async () => undefined,
              updateMany: async () => ({ count: 0 })
            }
          }),
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            topLevelUpdates.push(input);
            return { count: 0 };
          }
        }
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        async resolveCurrent() {
          return {
            runtimeBundleDocument: JSON.stringify({
              metadata: {
                assistantId: "assistant-1",
                workspaceId: "workspace-1",
                publishedVersionId: "version-1"
              },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            runtimeTier: "paid_shared_restricted"
          };
        }
      } as never,
      {
        async run() {
          return {
            ok: false,
            retryable: true,
            code: "runtime_unavailable",
            message: "temporary runtime outage"
          };
        }
      } as never,
      {
        async extractSourceFiles() {
          return [];
        }
      } as never,
      {
        async deliverReadyJob() {
          throw new Error("delivery should not run in this test");
        }
      } as never,
      {
        async getLeaseState() {
          return null;
        },
        async acquire() {
          return null;
        },
        async heartbeat() {
          return true;
        },
        async release() {}
      } as never,
      {
        recordTickSkipped() {},
        recordTickAcquired() {},
        recordLeaseLost() {},
        recordLeaseExpiredRecovered() {}
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      provider: "pdfmonkey",
      outputFormat: "pdf",
      sourceUserMessageId: "message-1",
      requestJson: {
        sourceUserMessageText: "Create a PDF brief",
        sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z",
        descriptorMode: "revise_document",
        sourceJson: {
          prompt: "Create a PDF brief"
        }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "lost-claim-token"
    });

    assert.equal(topLevelUpdates.length, 1);
    assert.deepEqual(topLevelUpdates[0]?.where, {
      id: "job-1",
      schedulerClaimToken: "lost-claim-token",
      status: "running"
    });
    assert.equal(topLevelUpdates[0]?.data?.status, "queued");
  });

  test("persists provider failure metadata on terminal document failure", async () => {
    let capturedMappingUpdate: Record<string, unknown> | null = null;
    let capturedJobUpdate: Record<string, unknown> | null = null;
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async (input: Record<string, unknown>) => {
                capturedJobUpdate = input;
                return { count: 1 };
              }
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            },
            assistantDocumentProviderMapping: {
              findFirst: async () => ({ id: "mapping-1" }),
              update: async (input: Record<string, unknown>) => {
                capturedMappingUpdate = input;
                return undefined;
              }
            }
          })
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await (
      service as unknown as {
        failJob: (
          job: Record<string, unknown>,
          code: string,
          message: string,
          providerStatus: Record<string, unknown>
        ) => Promise<void>;
      }
    ).failJob(
      {
        id: "job-1",
        docId: "doc-1",
        versionId: "version-1",
        workspaceId: "workspace-1",
        provider: "pdfmonkey",
        claimToken: "claim-1"
      },
      "pdfmonkey_auth_failed",
      "PDFMonkey rejected the configured credential.",
      {
        provider: "pdfmonkey",
        state: "failed",
        status: "http_401",
        httpStatus: 401,
        retryable: false,
        documentTemplateId: "template-123",
        message: "PDFMonkey rejected the configured credential."
      }
    );

    assert.equal(capturedJobUpdate?.data?.providerStatusJson?.providerStatus?.httpStatus, 401);
    assert.equal(capturedMappingUpdate?.data?.latestProviderStatus, "failed");
    assert.equal(capturedMappingUpdate?.data?.providerMetadataJson?.httpStatus, 401);
    assert.equal(
      capturedMappingUpdate?.data?.providerMetadataJson?.errorCode,
      "pdfmonkey_auth_failed"
    );
  });

  test("requeues retryable provider execution failures returned inside a successful runtime envelope", async () => {
    const topLevelUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [],
            assistantDocumentRenderJob: {
              update: async () => undefined,
              updateMany: async () => ({ count: 0 })
            }
          }),
        assistantDocumentRenderJob: {
          updateMany: async (input: Record<string, unknown>) => {
            topLevelUpdates.push(input);
            return { count: 1 };
          }
        }
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        async resolveCurrent() {
          return {
            runtimeBundleDocument: JSON.stringify({
              metadata: {
                assistantId: "assistant-1",
                workspaceId: "workspace-1",
                publishedVersionId: "version-1"
              },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            runtimeTier: "paid_shared_restricted"
          };
        }
      } as never,
      {
        async run() {
          return {
            ok: true,
            result: {
              assistantText: null,
              artifacts: [],
              usage: null,
              toolInvocations: [],
              rawText: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "failed",
                retryable: true,
                errorCode: "pdfmonkey_download_unavailable",
                message: "Temporary PDF download failure"
              }
            }
          };
        }
      } as never,
      {
        async extractSourceFiles() {
          return [];
        }
      } as never,
      {
        async deliverReadyJob() {
          throw new Error("delivery should not run in this test");
        }
      } as never,
      {
        async getLeaseState() {
          return null;
        },
        async acquire() {
          return null;
        },
        async heartbeat() {
          return true;
        },
        async release() {}
      } as never,
      {
        recordTickSkipped() {},
        recordTickAcquired() {},
        recordLeaseLost() {},
        recordLeaseExpiredRecovered() {}
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      provider: "pdfmonkey",
      outputFormat: "pdf",
      sourceUserMessageId: "message-1",
      requestJson: {
        sourceUserMessageText: "Create a PDF brief",
        sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z",
        sourceJson: {
          prompt: "Create a PDF brief"
        }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "claim-1"
    });

    assert.equal(topLevelUpdates.length, 1);
    assert.equal(topLevelUpdates[0]?.data?.status, "queued");
    assert.equal(topLevelUpdates[0]?.data?.lastErrorCode, "pdfmonkey_download_unavailable");
    assert.equal(topLevelUpdates[0]?.data?.providerStatusJson?.retryable, true);
  });

  test("creates a chat message when provider execution terminally fails", async () => {
    let capturedFailureMessageInput: Record<string, unknown> | null = null;
    let capturedPostFailureUpdate: Record<string, unknown> | null = null;
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            $queryRaw: async () => [],
            assistantDocumentRenderJob: {
              update: async () => undefined,
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-1"
              }),
              update: async () => undefined
            },
            assistantDocumentProviderMapping: {
              findFirst: async () => null,
              create: async () => undefined,
              update: async () => undefined
            }
          }),
        assistantDocumentRenderJob: {
          update: async (input: Record<string, unknown>) => {
            capturedPostFailureUpdate = input;
            return undefined;
          },
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        async resolveCurrent() {
          return {
            runtimeBundleDocument: JSON.stringify({
              metadata: {
                assistantId: "assistant-1",
                workspaceId: "workspace-1",
                publishedVersionId: "version-1"
              },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            runtimeTier: "paid_shared_restricted"
          };
        }
      } as never,
      {
        async run() {
          return {
            ok: false,
            retryable: false,
            code: "gamma_request_invalid",
            message: "Gamma returned HTTP 400.",
            providerStatus: {
              provider: "gamma",
              state: "failed",
              status: "create_failed",
              httpStatus: 400,
              retryable: false
            }
          };
        }
      } as never,
      {
        async extractSourceFiles() {
          return [];
        }
      } as never,
      {
        async deliverReadyJob() {
          throw new Error("delivery should not run in this test");
        },
        async createTerminalExecutionFailureMessage(input: Record<string, unknown>) {
          capturedFailureMessageInput = input;
          return "message-failure-1";
        }
      } as never,
      {
        async getLeaseState() {
          return null;
        },
        async acquire() {
          return null;
        },
        async heartbeat() {
          return true;
        },
        async release() {}
      } as never,
      {
        recordTickSkipped() {},
        recordTickAcquired() {},
        recordLeaseLost() {},
        recordLeaseExpiredRecovered() {}
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-gamma-failed-1",
      docId: "doc-1",
      versionId: "version-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      provider: "gamma",
      outputFormat: "pdf",
      sourceUserMessageId: "message-1",
      requestJson: {
        sourceUserMessageText: "Сделай презентацию про рынок",
        sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z",
        descriptorMode: "create_presentation",
        sourceJson: {
          prompt: "Сделай презентацию про рынок"
        }
      },
      attemptCount: 1,
      maxAttempts: 1,
      claimToken: "claim-1"
    });

    assert.equal(capturedFailureMessageInput?.descriptorMode, "create_presentation");
    assert.equal(
      (capturedFailureMessageInput?.failure as { code?: string } | undefined)?.code,
      "gamma_request_invalid"
    );
    assert.equal(
      (
        capturedPostFailureUpdate?.data as
          | { providerStatusJson?: { completionAssistantMessageId?: string } }
          | undefined
      )?.providerStatusJson?.completionAssistantMessageId,
      "message-failure-1"
    );
  });

  test("passes revise_document through to the runtime request", async () => {
    let capturedRuntimeRequest: Record<string, unknown> | null = null;
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocumentProviderMapping: {
              findFirst: async () => null,
              create: async () => undefined,
              update: async () => undefined
            }
          }),
        assistantDocumentRenderJob: {
          updateMany: async () => ({ count: 1 })
        }
      } as never,
      {
        async findById() {
          return {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      } as never,
      {
        async resolveCurrent() {
          return {
            runtimeBundleDocument: JSON.stringify({
              metadata: {
                assistantId: "assistant-1",
                workspaceId: "workspace-1",
                publishedVersionId: "version-1"
              },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            runtimeTier: "paid_shared_restricted"
          };
        }
      } as never,
      {
        async run(input: Record<string, unknown>) {
          capturedRuntimeRequest = input;
          return {
            ok: true,
            result: {
              assistantText: null,
              artifacts: [
                {
                  artifactId: "artifact-1",
                  fileRef: "file-1",
                  file: {
                    fileRef: "file-1",
                    origin: "runtime_output",
                    sourceToolCode: "document",
                    objectKey: "assistant-media/test.pptx",
                    relativePath: "artifacts/test.pptx",
                    displayName: "deck-v2.pptx",
                    mimeType:
                      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    sizeBytes: 123,
                    logicalSizeBytes: 123
                  },
                  kind: "file",
                  sourceToolCode: "document",
                  objectKey: "assistant-media/test.pptx",
                  mimeType:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  filename: "deck-v2.pptx",
                  sizeBytes: 123,
                  voiceNote: false
                }
              ],
              usage: null,
              toolInvocations: [],
              rawText: null,
              providerStatus: {
                provider: "gamma",
                state: "success"
              }
            }
          };
        }
      } as never,
      {
        async extractSourceFiles() {
          return [];
        }
      } as never,
      {
        async deliverReadyJob() {
          throw new Error("delivery should not run in this test");
        }
      } as never,
      {
        async getLeaseState() {
          return null;
        },
        async acquire() {
          return null;
        },
        async heartbeat() {
          return true;
        },
        async release() {}
      } as never,
      {
        recordTickSkipped() {},
        recordTickAcquired() {},
        recordLeaseLost() {},
        recordLeaseExpiredRecovered() {}
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-revision-1",
      docId: "doc-1",
      versionId: "version-4",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      provider: "gamma",
      outputFormat: "pptx",
      sourceUserMessageId: "message-1",
      requestJson: {
        sourceUserMessageText: "Shorten slide 3",
        sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z",
        descriptorMode: "revise_document",
        sourceJson: {
          prompt: "Shorten slide 3",
          docId: "doc-1",
          outputFormat: "pptx"
        }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "claim-revision-1"
    });

    assert.equal(
      (
        capturedRuntimeRequest as {
          directToolExecution: { descriptorMode: string };
        }
      ).directToolExecution.descriptorMode,
      "revise_document"
    );
    assert.equal(
      (
        capturedRuntimeRequest as {
          directToolExecution: {
            request: { prompt: string; docId: string; outputFormat: string };
          };
        }
      ).directToolExecution.request.docId,
      "doc-1"
    );
  });

  test("keeps document ready when a non-current revision fails", async () => {
    const documentUpdates: Array<Record<string, unknown>> = [];
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async () => undefined
            },
            assistantDocument: {
              findUnique: async () => ({
                currentVersionId: "version-3"
              }),
              update: async (input: Record<string, unknown>) => {
                documentUpdates.push(input);
                return undefined;
              }
            },
            assistantDocumentProviderMapping: {
              findFirst: async () => null,
              create: async () => undefined,
              update: async () => undefined
            }
          })
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await (
      service as unknown as {
        failJob: (
          job: Record<string, unknown>,
          code: string,
          message: string,
          providerStatus?: Record<string, unknown> | null
        ) => Promise<void>;
      }
    ).failJob(
      {
        id: "job-revision-failed-1",
        docId: "doc-1",
        versionId: "version-4",
        workspaceId: "workspace-1",
        provider: "gamma",
        claimToken: "claim-1"
      },
      "gamma_generation_failed",
      "Gamma failed the revision render."
    );

    assert.equal(
      documentUpdates.some(
        (input) => input.where?.id === "doc-1" && input.data?.status === "ready"
      ),
      true
    );
    assert.equal(
      documentUpdates.some((input) => input.data?.status === "failed"),
      false
    );
  });
});
