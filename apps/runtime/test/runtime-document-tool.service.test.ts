import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { RuntimeDocumentToolService } from "../src/modules/turns/runtime-document-tool.service";

function createBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      assistantHandle: "a-test",
      siblingAssistantHandles: []
    },
    runtime: {
      sandbox: null
    }
  } as unknown as AssistantRuntimeBundle;
}

describe("RuntimeDocumentToolService", () => {
  test("returns extracted payload when document.extract succeeds", async () => {
    const service = new RuntimeDocumentToolService({
      async extractDocumentToWorkspace() {
        return {
          accepted: true as const,
          sourcePath: "/workspace/source.pdf",
          outputDir: "/workspace/source.extract",
          manifestPath: "/workspace/source.extract/manifest.json",
          outputPaths: [
            "/workspace/source.extract/extracted.md",
            "/workspace/source.extract/manifest.json"
          ],
          suggestedReadPaths: [
            "/workspace/source.extract/manifest.json",
            "/workspace/source.extract/extracted.md"
          ],
          counts: {
            documentCount: 1,
            pageCount: 4,
            sheetCount: null
          },
          provider: {
            providerKey: "local" as const,
            processorMode: "local" as const,
            attemptedProviderKeys: ["local" as const]
          },
          quality: {
            status: "ok" as const,
            score: 0.8,
            reasonCodes: [],
            textChars: 1200
          },
          warnings: []
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-extract-1",
        name: "document",
        arguments: {
          action: "extract",
          path: "/workspace/source.pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-extract-1",
        sourceUserMessageText: "Extract this PDF",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.executionMode, "inline");
    assert.equal(result.payload.requestedAction, "extract");
    assert.equal(result.payload.action, "extracted");
    assert.equal(
      result.payload.extraction?.manifestPath,
      "/workspace/source.extract/manifest.json"
    );
    assert.deepEqual(result.payload.extraction?.counts, {
      documentCount: 1,
      pageCount: 4,
      sheetCount: null
    });
  });

  test("rejects document.extract paths outside canonical workspace", async () => {
    const service = new RuntimeDocumentToolService({} as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-extract-2",
        name: "document",
        arguments: {
          action: "extract",
          path: "/shared/source.pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-extract-2",
        sourceUserMessageText: "Extract this file",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
  });

  test("returns inspected payload when document.inspect succeeds", async () => {
    const service = new RuntimeDocumentToolService({
      async inspectDocumentInWorkspace() {
        return {
          accepted: true as const,
          sourcePath: "/workspace/output.xlsx",
          inspectPath: "/workspace/output.inspect.json",
          format: "xlsx" as const,
          counts: {
            pageCount: null,
            sheetCount: 2,
            formulaCount: 5,
            blankSheetCount: 1,
            paragraphCount: null,
            headingCount: null,
            tableCount: null,
            textCharCount: null
          },
          warnings: ['Sheet "Summary" is blank.'],
          suggestedReadPaths: ["/workspace/output.inspect.json"]
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-inspect-1",
        name: "document",
        arguments: {
          action: "inspect",
          path: "/workspace/output.xlsx"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-inspect-1",
        sourceUserMessageText: "Inspect this workbook",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.executionMode, "inline");
    assert.equal(result.payload.requestedAction, "inspect");
    assert.equal(result.payload.action, "inspected");
    assert.equal(result.payload.inspection?.inspectPath, "/workspace/output.inspect.json");
    assert.equal(result.payload.inspection?.format, "xlsx");
    assert.equal(result.payload.inspection?.counts.sheetCount, 2);
  });

  test("registers a visible workspace version without delivering it", async () => {
    const service = new RuntimeDocumentToolService({
      async registerDocumentVersion() {
        return {
          accepted: true as const,
          docId: "doc-visible-1",
          versionId: "version-visible-2",
          versionNumber: 2,
          descriptorMode: "revise_document" as const,
          documentType: "pdf_document" as const,
          outputFormat: "pdf" as const,
          outputPath: "/workspace/report/report.pdf",
          workspaceProjectPath: "/workspace/report",
          sourceManifestPath: "/workspace/report/manifest.json",
          inspectionPath: "/workspace/report/report.inspect.json"
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-register-1",
        name: "document",
        arguments: {
          action: "register_version",
          descriptorMode: "revise_document",
          docId: "doc-visible-1",
          workspaceProjectPath: "/workspace/report",
          outputPath: "/workspace/report/report.pdf",
          sourceManifestPath: "/workspace/report/manifest.json",
          inspectionPath: "/workspace/report/report.inspect.json"
        }
      },
      conversation: {
        channel: "web",
        externalThreadKey: "chat:web:1"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-register-1",
        sourceUserMessageText: "Register this report version",
        sourceUserMessageCreatedAt: "2026-06-29T15:00:00.000Z",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.requestedAction, "register_version");
    assert.equal(result.payload.action, "registered");
    assert.equal(result.payload.docId, "doc-visible-1");
    assert.equal(result.payload.versionId, "version-visible-2");
    assert.equal(result.payload.registration?.outputPath, "/workspace/report/report.pdf");
    assert.equal(
      result.payload.registration?.inspectionPath,
      "/workspace/report/report.inspect.json"
    );
  });

  test("renders an HTML workspace project to PDF and returns a rendered summary", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              {
                path: "/workspace/report/report.html",
                type: "file" as const,
                sizeBytes: 120,
                mimeType: "text/html",
                modifiedAt: "2026-06-29T12:00:00.000Z"
              }
            ]
          };
        },
        async upsertWorkspaceFileMetadata() {
          return;
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          if (input.toolCode === "execute_document_code") {
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: null,
              files: [
                {
                  relativePath: "report/report.pdf",
                  displayName: "report.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 1234,
                  logicalSizeBytes: 1234,
                  storagePath: "sandbox/job/report.pdf"
                }
              ]
            };
          }
          if (input.toolCode === "files" && input.args.action === "read") {
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content: "<html><body><h1>Report</h1></body></html>",
                sizeBytes: 41,
                sha256: null,
                truncated: false
              }),
              files: []
            };
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                action: "attached",
                attachment: {
                  workspaceRelPath: "/workspace/report/report.pdf",
                  sourcePath: "/workspace/report/report.pdf",
                  sizeBytes: 1234,
                  mimeType: "application/pdf",
                  displayName: "report.pdf"
                }
              }),
              files: []
            };
          }
          throw new Error(`Unexpected sandbox call: ${input.toolCode}`);
        }
      } as never
    );
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-1",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/report",
          outputPath: "/workspace/report/report.pdf",
          format: "pdf",
          entrypoint: "report.html"
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-1",
        sourceUserMessageText: "Render the report",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.requestedAction, "render");
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.render?.outputPath, "/workspace/report/report.pdf");
    assert.equal(result.payload.render?.entrypointPath, "/workspace/report/report.html");
    assert.equal(result.payload.render?.mimeType, "application/pdf");
    assert.equal(sandboxCalls[0]?.toolCode, "execute_document_code");
    assert.equal(sandboxCalls[1]?.toolCode, "files");
  });

  test("renders a visible Python build script for xlsx output", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          if (input.toolCode === "files" && input.args.action === "read") {
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content:
                  "from openpyxl import Workbook\nwb = Workbook()\nwb.active['A1'] = 'ok'\nwb.save(PERSAI_OUTPUT_PATH)\n",
                sizeBytes: 96,
                sha256: null,
                truncated: false
              }),
              files: []
            };
          }
          if (input.toolCode === "execute_document_code") {
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: null,
              files: []
            };
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                action: "attached",
                attachment: {
                  workspaceRelPath: "/workspace/model/output.xlsx",
                  sourcePath: "/workspace/model/output.xlsx",
                  sizeBytes: 2048,
                  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  displayName: "output.xlsx"
                }
              }),
              files: []
            };
          }
          throw new Error(`Unexpected sandbox call: ${input.toolCode}`);
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-xlsx",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/model",
          outputPath: "/workspace/model/output.xlsx",
          format: "xlsx"
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-xlsx",
        sourceUserMessageText: "Render the workbook",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.render?.entrypointPath, "/workspace/model/build.py");
    assert.equal(result.payload.render?.format, "xlsx");
    assert.equal(sandboxCalls[0]?.toolCode, "files");
    assert.equal(sandboxCalls[0]?.args.action, "read");
    assert.equal(sandboxCalls[1]?.toolCode, "execute_document_code");
    assert.equal(sandboxCalls[1]?.args.outputFileName, "model/output.xlsx");
    assert.match(String(sandboxCalls[1]?.args.programSource ?? ""), /PERSAI_OUTPUT_PATH/);
    assert.equal(sandboxCalls[2]?.toolCode, "files");
    assert.equal(sandboxCalls[2]?.args.action, "attach");
  });

  test("document.render reports an honest skipped result when no entrypoint exists", async () => {
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return { items: [] };
        }
      } as never,
      {
        isConfigured() {
          return true;
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-missing",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/report",
          outputPath: "/workspace/report/report.pdf",
          format: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-missing",
        sourceUserMessageText: "Render the report",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "unsupported_render_source");
  });

  test("document.render rejects output paths that do not match the requested format", async () => {
    const service = new RuntimeDocumentToolService({} as never, {} as never);

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-bad-extension",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/report",
          outputPath: "/workspace/report/report.html",
          format: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-bad-extension",
        sourceUserMessageText: "Render the report",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
  });

  test("returns pending_delivery payload when presentation enqueue is accepted", async () => {
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob() {
        return {
          accepted: true as const,
          jobId: "doc-job-1",
          docId: "doc-1",
          versionId: "version-1",
          documentType: "presentation" as const
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Create a one-page deck"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-1",
        sourceUserMessageText: "Сделай презентацию",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "pending_delivery");
    assert.equal(result.payload.jobId, "doc-job-1");
    assert.equal(result.payload.docId, "doc-1");
    assert.equal(result.payload.versionId, "version-1");
    assert.equal(result.payload.canSendFileNow, false);
    assert.equal(result.payload.toolCode, "document");
  });

  test("forwards referenced previous source attachment for new presentation jobs", async () => {
    const capturedAttachments: unknown[][] = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: { attachments: unknown[] }) {
        capturedAttachments.push(input.attachments);
        return {
          accepted: true as const,
          jobId: "doc-job-1",
          documentType: "presentation" as const
        };
      }
    } as never);

    await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Создай презентацию на основе прикреплённого документа"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-2",
        sourceUserMessageText: "Создай презентацию на основе моего документа",
        currentAttachments: [],
        availableAttachments: [
          {
            attachmentId: "att-previous-pdf",
            kind: "file",
            storagePath: "assistant-media/source.pdf",
            mimeType: "application/pdf",
            displayName: "source.pdf",
            sizeBytes: 1024,
            aliases: ["file #1"]
          }
        ]
      }
    });

    const attachments = capturedAttachments[0] ?? [];
    assert.equal(attachments.length, 1);
    assert.deepEqual(attachments[0], {
      attachmentId: "att-previous-pdf",
      kind: "file",
      storagePath: "assistant-media/source.pdf",
      mimeType: "application/pdf",
      displayName: "source.pdf",
      sizeBytes: 1024,
      aliases: ["file #1"]
    });
  });

  test("does not leak previous source attachments into unrelated new presentation jobs", async () => {
    const capturedAttachments: unknown[][] = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: { attachments: unknown[] }) {
        capturedAttachments.push(input.attachments);
        return {
          accepted: true as const,
          jobId: "doc-job-1",
          documentType: "presentation" as const
        };
      }
    } as never);

    await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Create a short deck about quarterly pricing"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-3",
        sourceUserMessageText: "Сделай презентацию про тарифы PersAI",
        currentAttachments: [],
        availableAttachments: [
          {
            attachmentId: "att-previous-pdf",
            kind: "file",
            storagePath: "assistant-media/source.pdf",
            mimeType: "application/pdf",
            displayName: "source.pdf",
            sizeBytes: 1024,
            aliases: ["file #1"]
          }
        ]
      }
    });

    assert.deepEqual(capturedAttachments[0], []);
  });

  test("retired PDF/data descriptor modes are rejected at parse time", async () => {
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob() {
        throw new Error("retired descriptor modes must not enqueue a background document job");
      }
    } as never);

    const retiredCases: ReadonlyArray<{
      descriptorMode: "create_pdf_document" | "create_data_document";
      outputFormat: "pdf" | "xlsx" | "docx" | null;
    }> = [
      { descriptorMode: "create_pdf_document", outputFormat: "pdf" },
      { descriptorMode: "create_pdf_document", outputFormat: "xlsx" },
      { descriptorMode: "create_data_document", outputFormat: "xlsx" },
      { descriptorMode: "create_data_document", outputFormat: "docx" },
      { descriptorMode: "create_data_document", outputFormat: null }
    ];

    for (const args of retiredCases) {
      const result = await service.executeToolCall({
        bundle: createBundle(),
        toolCall: {
          id: `tool-retired-${args.descriptorMode}-${args.outputFormat ?? "none"}`,
          name: "document",
          arguments: {
            descriptorMode: args.descriptorMode,
            prompt: "irrelevant retired descriptor",
            ...(args.outputFormat === null ? {} : { outputFormat: args.outputFormat })
          }
        },
        deferToAsyncDocumentJob: {
          sourceUserMessageId: "msg-retired",
          sourceUserMessageText: "noop",
          currentAttachments: [],
          availableAttachments: []
        }
      });

      assert.equal(result.isError, true);
      assert.equal(result.payload.action, "skipped");
      assert.equal(result.payload.reason, "invalid_arguments");
      assert.match(
        result.payload.warning ?? "",
        /create_presentation, revise_document, or export_or_redeliver/
      );
      assert.match(
        result.payload.warning ?? "",
        /visible workspace actions|document\.extract|document\.render|document\.inspect|document\.register_version/
      );
    }
  });

  test("maps rejected enqueue into skipped payload", async () => {
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob() {
        return {
          accepted: false as const,
          code: "document_quota_reached",
          message: "Document quota reached.",
          guidance: "Upgrade or wait for the next period."
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "document",
        arguments: {
          descriptorMode: "export_or_redeliver",
          prompt: "Resend the latest file",
          docId: "doc-1",
          outputFormat: "pptx"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-1",
        sourceUserMessageText: "Отправь документ еще раз",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "document_quota_reached");
    assert.equal(result.payload.guidance, "Upgrade or wait for the next period.");
  });

  test("defaults create_presentation to PDF when outputFormat is omitted", async () => {
    const capturedInputs: Array<{
      directToolExecution: {
        descriptorMode: string;
        request: { outputFormat?: string | null };
      };
    }> = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: {
        directToolExecution: {
          descriptorMode: string;
          request: { outputFormat?: string | null };
        };
      }) {
        capturedInputs.push(input);
        return {
          accepted: true as const,
          jobId: "doc-job-pdf-default",
          documentType: "presentation" as const
        };
      }
    } as never);

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-default-pdf",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Make a deck about flowering plants for grade 6 biology"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-default-pdf",
        sourceUserMessageText: "Сделай презентацию для 6 класса по биологии",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.payload.action, "pending_delivery");
    assert.equal(result.payload.outputFormat, "pdf");
    const input = capturedInputs[0]!;
    assert.equal(input.directToolExecution.request.outputFormat, "pdf");
  });

  test("forces create_presentation chat delivery to PDF even when the model passes outputFormat=pptx", async () => {
    const capturedInputs: Array<{
      directToolExecution: {
        descriptorMode: string;
        request: { outputFormat?: string | null };
      };
    }> = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: {
        directToolExecution: {
          descriptorMode: string;
          request: { outputFormat?: string | null };
        };
      }) {
        capturedInputs.push(input);
        return {
          accepted: true as const,
          jobId: "doc-job-pptx",
          documentType: "presentation" as const
        };
      }
    } as never);

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-pptx-1",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Create a deck",
          outputFormat: "pptx"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-pptx-1",
        sourceUserMessageText: "Сделай презентацию",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.payload.action, "pending_delivery");
    assert.equal(result.payload.outputFormat, "pdf");
    const input = capturedInputs[0]!;
    assert.equal(input.directToolExecution.request.outputFormat, "pdf");
  });

  test("forwards typed targetSlideCount and clamps it to a sane range", async () => {
    const capturedInputs: Array<{
      directToolExecution: {
        descriptorMode: string;
        request: { targetSlideCount?: number | null };
      };
    }> = [];
    const service = new RuntimeDocumentToolService({
      async enqueueDeferredDocumentJob(input: {
        directToolExecution: {
          descriptorMode: string;
          request: { targetSlideCount?: number | null };
        };
      }) {
        capturedInputs.push(input);
        return {
          accepted: true as const,
          jobId: "doc-job-target-slides",
          documentType: "presentation" as const
        };
      }
    } as never);

    await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-target-1",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Deck on photosynthesis",
          targetSlideCount: 7
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-target-1",
        sourceUserMessageText: "Сделай 7 слайдов",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-target-2",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Massive deck",
          targetSlideCount: 999
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-target-2",
        sourceUserMessageText: "Сделай очень большую презентацию",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-target-3",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Bad slide count value",
          targetSlideCount: -5
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-target-3",
        sourceUserMessageText: "Сделай отрицательное число слайдов",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(capturedInputs[0]!.directToolExecution.request.targetSlideCount, 7);
    assert.equal(capturedInputs[1]!.directToolExecution.request.targetSlideCount, 30);
    assert.equal(capturedInputs[2]!.directToolExecution.request.targetSlideCount, null);
  });
});

export async function runRuntimeDocumentToolServiceTest(): Promise<void> {
  // Tests are registered at module level via describe(); they run automatically in the child process.
}
