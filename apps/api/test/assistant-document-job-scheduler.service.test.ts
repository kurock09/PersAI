import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantDocumentJobSchedulerService } from "../src/modules/workspace-management/application/assistant-document-job-scheduler.service";

describe("AssistantDocumentJobSchedulerService", () => {
  test("preserves create_data_document descriptor and Office output formats when replaying queued jobs", () => {
    const service = new AssistantDocumentJobSchedulerService(
      {} as never,
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
    const access = service as unknown as {
      parseRequestPayload(value: unknown): {
        descriptorMode: string;
        sourceJson: { outputFormat: string | null; requestedName: string | null };
      } | null;
    };

    const xlsx = access.parseRequestPayload({
      sourceUserMessageText: "make excel",
      sourceUserMessageCreatedAt: "2026-06-21T15:19:01.075Z",
      descriptorMode: "create_data_document",
      sourceJson: {
        prompt: "Create spreadsheet",
        outputFormat: "xlsx",
        requestedName: "test-excel.xlsx"
      }
    });
    const docx = access.parseRequestPayload({
      sourceUserMessageText: "make docx",
      sourceUserMessageCreatedAt: "2026-06-21T15:21:12.306Z",
      descriptorMode: "create_data_document",
      sourceJson: {
        prompt: "Create Word document",
        outputFormat: "docx",
        requestedName: "test-docx"
      }
    });

    assert.equal(xlsx?.descriptorMode, "create_data_document");
    assert.equal(xlsx?.sourceJson.outputFormat, "xlsx");
    assert.equal(xlsx?.sourceJson.requestedName, "test-excel.xlsx");
    assert.equal(docx?.descriptorMode, "create_data_document");
    assert.equal(docx?.sourceJson.outputFormat, "docx");
    assert.equal(docx?.sourceJson.requestedName, "test-docx");
  });

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
      } as never,
      {
        async recordDocumentGenerationUsageEvent() {}
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
      provider: "sandbox",
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
        provider: "sandbox",
        claimToken: "claim-1"
      },
      "sandbox_render_failed",
      "Sandbox render failed.",
      {
        provider: "sandbox",
        state: "failed",
        retryable: false,
        errorCode: "sandbox_render_failed",
        message: "Sandbox render failed."
      }
    );

    assert.equal(capturedJobUpdate?.data?.providerStatusJson?.providerStatus?.retryable, false);
    assert.equal(capturedMappingUpdate?.data?.latestProviderStatus, "failed");
    assert.equal(capturedMappingUpdate?.data?.providerMetadataJson?.retryable, false);
    assert.equal(
      capturedMappingUpdate?.data?.providerMetadataJson?.errorCode,
      "sandbox_render_failed"
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
                provider: "sandbox",
                state: "failed",
                retryable: true,
                errorCode: "sandbox_render_failed",
                message: "Temporary PDF render failure"
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent() {}
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
      provider: "sandbox",
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
    assert.equal(topLevelUpdates[0]?.data?.lastErrorCode, "sandbox_render_failed");
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent() {}
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
                  storagePath: "/workspace/deck-v2.pptx",
                  kind: "file",
                  sourceToolCode: "document",
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent() {}
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

  test("successful document job persists renderedHtml on the matching AssistantDocumentVersion row", async () => {
    const versionUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> =
      [];
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async (input: {
                where: Record<string, unknown>;
                data: Record<string, unknown>;
              }) => {
                versionUpdates.push(input);
                return undefined;
              }
            },
            assistantDocumentProviderMapping: {
              findFirst: async () => null,
              create: async () => undefined,
              update: async () => undefined
            }
          }),
        assistantDocumentRenderJob: {
          updateMany: async () => ({ count: 0 })
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
                publishedVersionId: "version-html-1"
              },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return { runtimeTier: "paid_shared_restricted" };
        }
      } as never,
      {
        async run() {
          return {
            ok: true,
            result: {
              assistantText: null,
              artifacts: [
                {
                  artifactId: "artifact-html-1",
                  storagePath: "/workspace/doc.pdf",
                  kind: "file",
                  sourceToolCode: "document",
                  mimeType: "application/pdf",
                  filename: "doc.pdf",
                  sizeBytes: 1500,
                  voiceNote: false
                }
              ],
              usage: null,
              toolInvocations: [
                { name: "document", iteration: 1, ok: true, executionMode: "worker" }
              ],
              rawText: null,
              renderedHtml: "<!DOCTYPE html><html><body><h1>Test</h1></body></html>",
              providerStatus: { provider: "sandbox", state: "success" }
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
          throw new Error("delivery must not run in this test");
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent() {}
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-html-persist-1",
      docId: "doc-html-1",
      versionId: "version-html-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      provider: "sandbox",
      outputFormat: "pdf",
      sourceUserMessageId: "message-html-1",
      requestJson: {
        sourceUserMessageText: "Create a test document",
        sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z",
        descriptorMode: "create_pdf_document",
        sourceJson: { prompt: "Create a test document" }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "claim-html-1"
    });

    const versionHtmlUpdate = versionUpdates.find((u) => u.where.id === "version-html-1");
    assert.ok(versionHtmlUpdate !== undefined, "must update AssistantDocumentVersion");
    assert.equal(
      versionHtmlUpdate.data.renderedHtml,
      "<!DOCTYPE html><html><body><h1>Test</h1></body></html>",
      "renderedHtml must be persisted on the AssistantDocumentVersion row"
    );
  });

  test("successful document job persists structured snapshot fields on AssistantDocumentVersion", async () => {
    const versionUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> =
      [];
    const structureSnapshot = {
      version: 1,
      renderModel: "persai_document_structure_v1",
      sections: [
        {
          id: "sec-1",
          heading: "Title",
          blocks: [{ id: "blk-1", type: "paragraph", html: "Body" }]
        }
      ]
    };
    const styleProfile = {
      version: 1,
      renderModel: "persai_document_style_v1",
      typography: {
        bodyFontFamily: "Georgia, serif",
        bodyFontSizePt: 11,
        headingFontFamily: "Georgia, serif",
        lineHeight: 1.45
      },
      layout: { pageMarginMm: 20, paragraphSpacingEm: 0.55, sectionSpacingEm: 1.1 },
      colors: { heading: "#111", body: "#222", accent: "#444" }
    };
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: {
              update: async (input: {
                where: Record<string, unknown>;
                data: Record<string, unknown>;
              }) => {
                versionUpdates.push(input);
                return undefined;
              }
            },
            assistantDocumentProviderMapping: {
              findFirst: async () => null,
              create: async () => undefined,
              update: async () => undefined
            }
          }),
        assistantDocumentRenderJob: {
          updateMany: async () => ({ count: 0 })
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
                publishedVersionId: "version-struct-1"
              },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return { runtimeTier: "paid_shared_restricted" };
        }
      } as never,
      {
        async run() {
          return {
            ok: true,
            result: {
              assistantText: null,
              artifacts: [
                {
                  artifactId: "artifact-struct-1",
                  storagePath: "/workspace/large-doc.pdf",
                  kind: "file",
                  sourceToolCode: "document",
                  mimeType: "application/pdf",
                  filename: "large-doc.pdf",
                  sizeBytes: 1500,
                  voiceNote: false
                }
              ],
              usage: null,
              toolInvocations: [
                { name: "document", iteration: 1, ok: true, executionMode: "worker" }
              ],
              rawText: null,
              renderedHtml:
                '<!DOCTYPE html><html><body><section id="sec-1"><p>Body</p></section></body></html>',
              structureJson: structureSnapshot,
              styleProfileJson: styleProfile,
              editStrategy: "structured_large",
              structureVersion: 1,
              providerStatus: { provider: "sandbox", state: "success" }
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
          throw new Error("delivery must not run in this test");
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent() {}
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-struct-persist-1",
      docId: "doc-struct-1",
      versionId: "version-struct-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      provider: "sandbox",
      outputFormat: "pdf",
      sourceUserMessageId: "message-struct-1",
      requestJson: {
        sourceUserMessageText: "Create a large document",
        sourceUserMessageCreatedAt: "2026-05-26T10:00:00.000Z",
        descriptorMode: "create_pdf_document",
        sourceJson: { prompt: "Create a large document", transferMode: "verbatim" }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "claim-struct-1"
    });

    const versionUpdate = versionUpdates.find((u) => u.where.id === "version-struct-1");
    assert.ok(versionUpdate !== undefined, "must update AssistantDocumentVersion");
    assert.equal(versionUpdate.data.editStrategy, "structured_large");
    assert.equal(versionUpdate.data.structureVersion, 1);
    assert.deepEqual(versionUpdate.data.structureJson, structureSnapshot);
    assert.deepEqual(versionUpdate.data.styleProfileJson, styleProfile);
  });

  test("scheduler forwards previousVersionRenderedHtml from persisted requestJson to runtime worker request", async () => {
    let capturedRuntimeRequest: Record<string, unknown> | null = null;
    const previousHtml = "<html><body><h1>Previous version HTML</h1></body></html>";
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
                  artifactId: "artifact-revise-1",
                  storagePath: "/workspace/revised.pdf",
                  kind: "file",
                  sourceToolCode: "document",
                  mimeType: "application/pdf",
                  filename: "revised.pdf",
                  sizeBytes: 2000,
                  voiceNote: false
                }
              ],
              usage: null,
              toolInvocations: [],
              rawText: null,
              providerStatus: { provider: "sandbox", state: "success" }
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent() {}
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-revise-html-1",
      docId: "doc-1",
      versionId: "version-5",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      surface: "web",
      provider: "sandbox",
      outputFormat: "pdf",
      sourceUserMessageId: "message-revise-1",
      requestJson: {
        sourceUserMessageText: "Shorten the introduction",
        sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z",
        descriptorMode: "revise_document",
        previousVersionRenderedHtml: previousHtml,
        sourceJson: {
          prompt: "Shorten the introduction",
          docId: "doc-1"
        }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "claim-revise-html-1"
    });

    assert.ok(capturedRuntimeRequest !== null, "runtime client must have been called");
    assert.equal(
      (capturedRuntimeRequest as { previousVersionRenderedHtml?: string })
        .previousVersionRenderedHtml,
      previousHtml,
      "previousVersionRenderedHtml must be forwarded from requestJson to the runtime request"
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

  test("appends document_generation ledger row when outcome.result.usage is non-null", async () => {
    const ledgerCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: { update: async () => undefined },
            assistantDocumentProviderMapping: {
              findFirst: async () => null,
              create: async () => undefined,
              update: async () => undefined
            }
          }),
        assistantDocumentRenderJob: { updateMany: async () => ({ count: 0 }) }
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
              metadata: { assistantId: "assistant-1", workspaceId: "workspace-1" },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return { runtimeTier: "paid_shared_restricted" };
        }
      } as never,
      {
        async run() {
          return {
            ok: true,
            result: {
              assistantText: null,
              artifacts: [
                {
                  artifactId: "artifact-ledger-1",
                  storagePath: "/workspace/ledger-doc.pdf",
                  kind: "file",
                  sourceToolCode: "document",
                  mimeType: "application/pdf",
                  filename: "ledger-doc.pdf",
                  sizeBytes: 1500,
                  voiceNote: false
                }
              ],
              usage: {
                providerKey: "openai",
                modelKey: "gpt-4.1-mini",
                inputTokens: 1200,
                cachedInputTokens: 0,
                outputTokens: 800,
                totalTokens: 2000
              },
              toolInvocations: [
                { name: "document", iteration: 1, ok: true, executionMode: "worker" }
              ],
              rawText: null,
              providerStatus: { provider: "sandbox", state: "success" }
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
          throw new Error("delivery should not run");
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent(input: Record<string, unknown>) {
          ledgerCalls.push(input);
        }
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-ledger-1",
      docId: "doc-ledger-1",
      versionId: "version-ledger-1",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      chatId: "chat-ledger-1",
      surface: "web",
      provider: "sandbox",
      outputFormat: "pdf",
      sourceUserMessageId: "message-ledger-1",
      requestJson: {
        sourceUserMessageText: "Generate a PDF",
        sourceUserMessageCreatedAt: "2026-05-30T10:00:00.000Z",
        descriptorMode: "create_pdf_document",
        sourceJson: { prompt: "Generate a PDF" }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "claim-ledger-1"
    });

    assert.equal(ledgerCalls.length, 1, "recordDocumentGenerationUsageEvent must be called once");
    assert.equal(ledgerCalls[0]!.source, "document_job_generation");
    assert.equal(ledgerCalls[0]!.sourceEventId, "document_render_job:job-ledger-1:generation");
    assert.equal(ledgerCalls[0]!.workspaceId, "workspace-1");
    assert.equal(ledgerCalls[0]!.assistantId, "assistant-1");
    assert.equal(ledgerCalls[0]!.userId, "user-1");
    assert.equal(
      (ledgerCalls[0]!.usage as Record<string, unknown>).inputTokens,
      1200,
      "usage inputTokens must be forwarded"
    );
  });

  test("does not append ledger row when outcome.result.usage is null", async () => {
    const ledgerCalls: Array<Record<string, unknown>> = [];
    const service = new AssistantDocumentJobSchedulerService(
      {
        $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
          callback({
            assistantDocumentRenderJob: {
              updateMany: async () => ({ count: 1 })
            },
            assistantDocumentVersion: { update: async () => undefined },
            assistantDocumentProviderMapping: {
              findFirst: async () => null,
              create: async () => undefined,
              update: async () => undefined
            }
          }),
        assistantDocumentRenderJob: { updateMany: async () => ({ count: 0 }) }
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
              metadata: { assistantId: "assistant-1", workspaceId: "workspace-1" },
              runtime: {},
              promptConstructor: {}
            })
          };
        }
      } as never,
      {
        async resolveByAssistantId() {
          return { runtimeTier: "paid_shared_restricted" };
        }
      } as never,
      {
        async run() {
          return {
            ok: true,
            result: {
              assistantText: null,
              artifacts: [
                {
                  artifactId: "artifact-null-usage-1",
                  storagePath: "/workspace/null-usage.pdf",
                  kind: "file",
                  sourceToolCode: "document",
                  mimeType: "application/pdf",
                  filename: "null-usage.pdf",
                  sizeBytes: 1500,
                  voiceNote: false
                }
              ],
              usage: null,
              toolInvocations: [
                { name: "document", iteration: 1, ok: true, executionMode: "worker" }
              ],
              rawText: null,
              providerStatus: { provider: "sandbox", state: "success" }
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
          throw new Error("delivery should not run");
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
      } as never,
      {
        async recordDocumentGenerationUsageEvent(input: Record<string, unknown>) {
          ledgerCalls.push(input);
        }
      } as never
    );

    await (
      service as unknown as { processQueuedJob: (job: Record<string, unknown>) => Promise<void> }
    ).processQueuedJob({
      id: "job-null-usage-1",
      docId: "doc-null-usage-1",
      versionId: "version-null-usage-1",
      assistantId: "assistant-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      chatId: "chat-null-usage-1",
      surface: "web",
      provider: "sandbox",
      outputFormat: "pdf",
      sourceUserMessageId: "message-null-usage-1",
      requestJson: {
        sourceUserMessageText: "Generate a PDF",
        sourceUserMessageCreatedAt: "2026-05-30T10:00:00.000Z",
        descriptorMode: "create_pdf_document",
        sourceJson: { prompt: "Generate a PDF" }
      },
      attemptCount: 1,
      maxAttempts: 5,
      claimToken: "claim-null-usage-1"
    });

    assert.equal(
      ledgerCalls.length,
      0,
      "recordDocumentGenerationUsageEvent must NOT be called when usage is null"
    );
  });
});
