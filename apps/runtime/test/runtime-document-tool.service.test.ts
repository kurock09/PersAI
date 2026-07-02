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

function createResolvedWritePathJob(path: string) {
  return {
    status: "completed" as const,
    exitCode: 0,
    reason: null,
    warning: null,
    violationMessage: null,
    stderr: null,
    content: JSON.stringify({ resolvedPath: path }),
    files: []
  };
}

function createWrittenWorkspaceFileJob(path: string, content: string) {
  return {
    status: "completed" as const,
    exitCode: 0,
    reason: null,
    warning: null,
    violationMessage: null,
    stderr: null,
    content: JSON.stringify({
      sizeBytes: Buffer.byteLength(content, "utf8"),
      resolvedPath: path
    }),
    files: []
  };
}

function createReadWorkspaceFileJob(content: string) {
  return {
    status: "completed" as const,
    exitCode: 0,
    reason: null,
    warning: null,
    violationMessage: null,
    stderr: null,
    content: JSON.stringify({
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      truncated: false
    }),
    files: []
  };
}

function createAttachedWorkspaceFileJob(path: string, mimeType: string, sizeBytes = 1024) {
  return {
    status: "completed" as const,
    exitCode: 0,
    reason: null,
    warning: null,
    violationMessage: null,
    stderr: null,
    content: JSON.stringify({
      action: "attached",
      attachment: {
        workspaceRelPath: path,
        sourcePath: path,
        sizeBytes,
        mimeType,
        displayName: path.split("/").pop()
      }
    }),
    files: []
  };
}

function createCompletedDocumentJob() {
  return {
    status: "completed" as const,
    exitCode: 0,
    reason: null,
    warning: null,
    violationMessage: null,
    stderr: null,
    content: null,
    files: []
  };
}

describe("RuntimeDocumentToolService", () => {
  test('rejects removed "extract" action instead of aliasing it', async () => {
    const service = new RuntimeDocumentToolService({} as never);

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-extract-removed",
        name: "document",
        arguments: {
          action: "extract",
          path: "/workspace/source.pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-1",
        sourceUserMessageText: "Extract this PDF",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.match(
      result.payload.warning ?? "",
      /Presentation work belongs in the presentation tool|document\.action must be "inspect", "render", or "convert"/
    );
  });

  test('rejects removed "edit" action instead of aliasing it', async () => {
    const service = new RuntimeDocumentToolService({} as never);

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-edit-removed",
        name: "document",
        arguments: {
          action: "edit",
          path: "/workspace/source.docx",
          edits: [{ op: "replace", target: "Old", value: "New" }],
          rerender: true
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-edit-1",
        sourceUserMessageText: "Edit this DOCX",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.match(
      result.payload.warning ?? "",
      /Presentation work belongs in the presentation tool|document\.action must be "inspect", "render", or "convert"/
    );
  });

  test('rejects removed "register_version" action instead of aliasing it', async () => {
    const service = new RuntimeDocumentToolService({} as never);

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-register-version-removed",
        name: "document",
        arguments: {
          action: "register_version",
          outputPath: "/workspace/source.pdf",
          inspectionPath: "/workspace/source.inspect.json",
          descriptorMode: "revise_document",
          docId: "11111111-1111-4111-8111-111111111111"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-register-1",
        sourceUserMessageText: "Register this version",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.match(
      result.payload.warning ?? "",
      /Presentation work belongs in the presentation tool|document\.action must be "inspect", "render", or "convert"/
    );
  });

  test("inspects a document using only path", async () => {
    const inspectCalls: Array<Record<string, unknown>> = [];
    const service = new RuntimeDocumentToolService({
      async inspectDocumentInWorkspace(args: Record<string, unknown>) {
        inspectCalls.push(args);
        return {
          accepted: true as const,
          sourcePath: "/workspace/source.pdf",
          inspectPath: "/workspace/source.inspect.json",
          format: "pdf" as const,
          counts: {
            pageCount: 2,
            sheetCount: null,
            formulaCount: null,
            blankSheetCount: null,
            paragraphCount: 5,
            headingCount: 2,
            tableCount: 1,
            textCharCount: 240
          },
          warnings: [],
          suggestedReadPaths: ["/workspace/source.inspect.json"],
          comparison: null
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
          path: "/workspace/source.pdf"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-2",
        sourceUserMessageText: "Inspect this file",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.requestedAction, "inspect");
    assert.equal(result.payload.action, "inspected");
    assert.equal(result.payload.inspection?.inspectPath, "/workspace/source.inspect.json");
    assert.deepEqual(inspectCalls, [
      {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        path: "/workspace/source.pdf",
        depth: "standard",
        outputPath: null
      }
    ]);
  });

  test("renders authored PDF and persists collision-safe sibling markdown", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const registerCalls: Array<Record<string, unknown>> = [];
    const metadataPaths: string[] = [];
    const resolvedMarkdownPath = "/workspace/reports/monthly (1).md";
    const markdownContent = "# Monthly\n\nSummary body.";
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata(args: Record<string, unknown>) {
          metadataPaths.push(String(args.path ?? ""));
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: "/workspace/reports/monthly.pdf",
            inspectPath: "/workspace/reports/monthly.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: 1,
              headingCount: 1,
              tableCount: 0,
              textCharCount: 22
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion(args: Record<string, unknown>) {
          registerCalls.push(args);
          return {
            accepted: true as const,
            docId: "doc-1",
            versionId: "version-1",
            versionNumber: 1,
            descriptorMode: "create_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: "/workspace/reports/monthly.pdf",
            workspaceProjectPath: "/workspace/reports",
            sourceManifestPath: null,
            inspectionPath: "/workspace/reports/monthly.inspect.json"
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          if (input.toolCode === "files" && input.args.action === "resolve_write_path") {
            return createResolvedWritePathJob(resolvedMarkdownPath);
          }
          if (input.toolCode === "files" && input.args.action === "write") {
            return createWrittenWorkspaceFileJob(
              String(input.args.path ?? ""),
              String(input.args.content ?? "")
            );
          }
          if (input.toolCode === "execute_document_code") {
            return createCompletedDocumentJob();
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return createAttachedWorkspaceFileJob(
              "/workspace/reports/monthly.pdf",
              "application/pdf",
              321
            );
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-pdf",
        name: "document",
        arguments: {
          action: "render",
          outputPath: "/workspace/reports/monthly.pdf",
          format: "pdf",
          content: markdownContent,
          style: "report"
        }
      },
      sessionId: "session-1",
      requestId: "request-render-pdf",
      conversation: {
        channel: "web",
        externalThreadKey: "thread-1"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-3",
        sourceUserMessageText: "Make the monthly PDF",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.render?.outputPath, "/workspace/reports/monthly.pdf");
    assert.equal(result.payload.render?.sourceMarkdownPath, resolvedMarkdownPath);
    assert.equal(result.payload.render?.mimeType, "application/pdf");
    assert.equal(registerCalls[0]?.workspaceProjectPath, null);
    assert.equal(registerCalls[0]?.outputPath, "/workspace/reports/monthly.pdf");
    assert.deepEqual(
      sandboxCalls.map((call) => `${call.toolCode}:${String(call.args.action ?? "")}`),
      ["files:resolve_write_path", "files:write", "execute_document_code:", "files:attach"]
    );
    assert.equal(sandboxCalls[0]?.args.path, "/workspace/reports/monthly.md");
    assert.equal(sandboxCalls[0]?.args.replace, false);
    assert.equal(sandboxCalls[1]?.args.path, resolvedMarkdownPath);
    assert.equal(sandboxCalls[1]?.args.replace, false);
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /CONTENT_PATH = Path\(".*monthly \(1\)\.md"\)/);
    assert.match(programSource, /HTML\(string=build_html_document\(\)/);
    assert.deepEqual(metadataPaths, [resolvedMarkdownPath, "/workspace/reports/monthly.pdf"]);
  });

  test("renders authored XLSX from Markdown tables and writes sibling markdown", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const markdownPath = "/workspace/tables/revenue.md";
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: "/workspace/tables/revenue.xlsx",
            inspectPath: "/workspace/tables/revenue.inspect.json",
            format: "xlsx" as const,
            counts: {
              pageCount: null,
              sheetCount: 1,
              formulaCount: 0,
              blankSheetCount: 0,
              paragraphCount: null,
              headingCount: null,
              tableCount: 1,
              textCharCount: null
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion() {
          return {
            accepted: true as const,
            docId: "doc-xlsx",
            versionId: "version-xlsx",
            versionNumber: 1,
            descriptorMode: "create_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "xlsx" as const,
            outputPath: "/workspace/tables/revenue.xlsx",
            workspaceProjectPath: "/workspace/tables",
            sourceManifestPath: null,
            inspectionPath: "/workspace/tables/revenue.inspect.json"
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          if (input.toolCode === "files" && input.args.action === "resolve_write_path") {
            return createResolvedWritePathJob(markdownPath);
          }
          if (input.toolCode === "files" && input.args.action === "write") {
            return createWrittenWorkspaceFileJob(
              String(input.args.path ?? ""),
              String(input.args.content ?? "")
            );
          }
          if (input.toolCode === "execute_document_code") {
            return createCompletedDocumentJob();
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return createAttachedWorkspaceFileJob(
              "/workspace/tables/revenue.xlsx",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              512
            );
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
          );
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
          outputPath: "/workspace/tables/revenue.xlsx",
          format: "xlsx",
          content: "# Revenue\n\n| Month | Revenue |\n| --- | --- |\n| Jan | 10 |"
        }
      },
      sessionId: "session-1",
      requestId: "request-render-xlsx",
      conversation: {
        channel: "web",
        externalThreadKey: "thread-2"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-4",
        sourceUserMessageText: "Make the workbook",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.render?.format, "xlsx");
    assert.equal(result.payload.render?.sourceMarkdownPath, markdownPath);
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /from openpyxl import Workbook/);
    assert.match(programSource, /requires at least one Markdown table/);
    assert.match(programSource, /sheet\.append/);
  });

  test("converts an existing document and derives outputPath when omitted", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const registerCalls: Array<Record<string, unknown>> = [];
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: "/workspace/source.pdf",
            inspectPath: "/workspace/source.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: 1,
              headingCount: 1,
              tableCount: 0,
              textCharCount: 40
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion(args: Record<string, unknown>) {
          registerCalls.push(args);
          return {
            accepted: true as const,
            docId: "doc-convert",
            versionId: "version-convert",
            versionNumber: 1,
            descriptorMode: "create_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: "/workspace/source.pdf",
            workspaceProjectPath: "/workspace",
            sourceManifestPath: null,
            inspectionPath: "/workspace/source.inspect.json"
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          if (input.toolCode === "files" && input.args.action === "write") {
            return createWrittenWorkspaceFileJob(
              String(input.args.path ?? ""),
              String(input.args.content ?? "")
            );
          }
          if (input.toolCode === "execute_document_code") {
            return createCompletedDocumentJob();
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return createAttachedWorkspaceFileJob("/workspace/source.pdf", "application/pdf", 2048);
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-convert-pdf",
        name: "document",
        arguments: {
          action: "convert",
          source: "/workspace/source.docx",
          targetFormat: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-convert-pdf",
      conversation: {
        channel: "web",
        externalThreadKey: "thread-3"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-5",
        sourceUserMessageText: "Convert this file",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.requestedAction, "convert");
    assert.equal(result.payload.action, "converted");
    assert.equal(result.payload.convert?.sourcePath, "/workspace/source.docx");
    assert.equal(result.payload.convert?.outputPath, "/workspace/source.pdf");
    assert.equal(result.payload.convert?.targetFormat, "pdf");
    assert.equal(registerCalls[0]?.workspaceProjectPath, null);
    assert.equal(registerCalls[0]?.outputPath, "/workspace/source.pdf");
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /soffice/);
    assert.match(programSource, /SOURCE_PATH = Path\("\/workspace\/source\.docx"\)/);
    assert.match(programSource, /TARGET_FORMAT = "pdf"/);
  });

  test("render stays rendered with warning when auto-register fails after persist", async () => {
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: "/workspace/reports/monthly.pdf",
            inspectPath: "/workspace/reports/monthly.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: 1,
              headingCount: 1,
              tableCount: 0,
              textCharCount: 22
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion() {
          return {
            accepted: false as const,
            code: "inspection_required",
            message: "A valid document.inspect sidecar is required to register document metadata."
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          if (input.toolCode === "files" && input.args.action === "resolve_write_path") {
            return createResolvedWritePathJob("/workspace/reports/monthly.md");
          }
          if (input.toolCode === "files" && input.args.action === "write") {
            return createWrittenWorkspaceFileJob(
              String(input.args.path ?? ""),
              String(input.args.content ?? "")
            );
          }
          if (input.toolCode === "execute_document_code") {
            return createCompletedDocumentJob();
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return createAttachedWorkspaceFileJob(
              "/workspace/reports/monthly.pdf",
              "application/pdf",
              321
            );
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-warning",
        name: "document",
        arguments: {
          action: "render",
          outputPath: "/workspace/reports/monthly.pdf",
          format: "pdf",
          content: "# Monthly\n\nSummary body."
        }
      },
      sessionId: "session-1",
      requestId: "request-render-warning",
      conversation: {
        channel: "web",
        externalThreadKey: "thread-warning"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-warning",
        sourceUserMessageText: "Make the monthly PDF",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.render?.outputPath, "/workspace/reports/monthly.pdf");
    assert.match(result.payload.warning ?? "", /inspection_required/);
    assert.equal(result.payload.registration, undefined);
  });

  test("convert stays converted with warning when auto-register fails after persist", async () => {
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: "/workspace/source.pdf",
            inspectPath: "/workspace/source.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: 1,
              headingCount: 1,
              tableCount: 0,
              textCharCount: 40
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion() {
          throw new Error("registration unavailable");
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          if (input.toolCode === "files" && input.args.action === "write") {
            return createWrittenWorkspaceFileJob(
              String(input.args.path ?? ""),
              String(input.args.content ?? "")
            );
          }
          if (input.toolCode === "execute_document_code") {
            return createCompletedDocumentJob();
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return createAttachedWorkspaceFileJob("/workspace/source.pdf", "application/pdf", 2048);
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-convert-warning",
        name: "document",
        arguments: {
          action: "convert",
          source: "/workspace/source.docx",
          targetFormat: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-convert-warning",
      conversation: {
        channel: "web",
        externalThreadKey: "thread-convert-warning"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-convert-warning",
        sourceUserMessageText: "Convert this file",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "converted");
    assert.equal(result.payload.convert?.outputPath, "/workspace/source.pdf");
    assert.match(result.payload.warning ?? "", /registration unavailable/);
    assert.equal(result.payload.registration, undefined);
  });

  test("Case A: edit sibling markdown and re-render bumps to v+1 with markdown bytes preserved", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const registerCalls: Array<Record<string, unknown>> = [];
    const initialMarkdown = "# Report\n\nOriginal body.\n";
    const editedMarkdown = "# Report\n\nEdited body with exact spacing.\n";
    const sourceMarkdownPath = "/workspace/report.md";
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: "/workspace/report.pdf",
            inspectPath: "/workspace/report.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: 1,
              headingCount: 1,
              tableCount: 0,
              textCharCount: 40
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion(args: Record<string, unknown>) {
          registerCalls.push(args);
          const versionNumber = registerCalls.length;
          return {
            accepted: true as const,
            docId: "doc-case-a-1",
            versionId: `version-case-a-${versionNumber}`,
            versionNumber,
            descriptorMode:
              versionNumber === 1 ? ("create_document" as const) : ("revise_document" as const),
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: "/workspace/report.pdf",
            workspaceProjectPath: "/workspace",
            sourceManifestPath: null,
            inspectionPath: "/workspace/report.inspect.json"
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          if (input.toolCode === "files" && input.args.action === "resolve_write_path") {
            return createResolvedWritePathJob(sourceMarkdownPath);
          }
          if (input.toolCode === "files" && input.args.action === "read") {
            assert.equal(input.args.path, sourceMarkdownPath);
            return createReadWorkspaceFileJob(editedMarkdown);
          }
          if (input.toolCode === "files" && input.args.action === "write") {
            return createWrittenWorkspaceFileJob(
              String(input.args.path ?? ""),
              String(input.args.content ?? "")
            );
          }
          if (input.toolCode === "execute_document_code") {
            return createCompletedDocumentJob();
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return createAttachedWorkspaceFileJob("/workspace/report.pdf", "application/pdf", 2048);
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
          );
        }
      } as never
    );

    const executeRender = (requestId: string, args: Record<string, unknown>) =>
      service.executeToolCall({
        bundle: createBundle(),
        toolCall: {
          id: requestId,
          name: "document",
          arguments: args
        },
        sessionId: "session-case-a",
        requestId,
        conversation: {
          channel: "web",
          externalThreadKey: "thread-case-a"
        },
        deferToAsyncDocumentJob: {
          sourceUserMessageId: `${requestId}-msg`,
          sourceUserMessageText: "Render the report",
          currentAttachments: [],
          availableAttachments: []
        }
      });

    const first = await executeRender("case-a-render-v1", {
      action: "render",
      content: initialMarkdown,
      format: "pdf",
      outputPath: "/workspace/report.pdf"
    });
    const second = await executeRender("case-a-render-v2", {
      action: "render",
      contentPath: sourceMarkdownPath,
      format: "pdf",
      outputPath: "/workspace/report.pdf"
    });

    assert.equal(first.isError, false);
    assert.equal(first.payload.action, "rendered");
    assert.equal(first.payload.render?.sourceMarkdownPath, sourceMarkdownPath);
    assert.equal(second.isError, false);
    assert.equal(second.payload.action, "rendered");
    assert.equal(second.payload.render?.outputPath, "/workspace/report.pdf");
    assert.equal(registerCalls.length, 2);
    assert.equal(registerCalls[0]?.descriptorMode, null);
    assert.equal(registerCalls[0]?.docId, null);
    assert.equal(registerCalls[0]?.versionNumber, undefined);
    assert.equal(registerCalls[1]?.descriptorMode, null);
    assert.equal(registerCalls[1]?.docId, null);
    assert.equal(first.payload.registration?.descriptorMode, "create_document");
    assert.equal(first.payload.registration?.versionNumber, 1);
    assert.equal(second.payload.registration?.descriptorMode, "revise_document");
    assert.equal(second.payload.registration?.versionNumber, 2);
    assert.equal(second.payload.registration?.docId, "doc-case-a-1");
    assert.deepEqual(
      sandboxCalls.map((call) => `${call.toolCode}:${String(call.args.action ?? "")}`),
      [
        "files:resolve_write_path",
        "files:write",
        "execute_document_code:",
        "files:attach",
        "files:read",
        "execute_document_code:",
        "files:attach"
      ]
    );
    assert.equal(sandboxCalls[0]?.args.path, sourceMarkdownPath);
    assert.equal(sandboxCalls[1]?.args.path, sourceMarkdownPath);
    assert.equal(sandboxCalls[1]?.args.content, initialMarkdown.trim());
    assert.equal(sandboxCalls[4]?.args.path, sourceMarkdownPath);
    assert.equal(
      sandboxCalls.filter(
        (call) =>
          call.toolCode === "files" &&
          call.args.action === "write" &&
          call.args.path === sourceMarkdownPath
      ).length,
      1
    );
    const secondProgramSource = String(
      sandboxCalls.filter((call) => call.toolCode === "execute_document_code").at(-1)?.args
        .programSource ?? ""
    );
    assert.match(secondProgramSource, /CONTENT_PATH = Path\("\/workspace\/report\.md"\)/);
  });

  test("rendering the same output path twice records two versions", async () => {
    const registerCalls: Array<Record<string, unknown>> = [];
    const service = new RuntimeDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: "/workspace/reports/monthly.pdf",
            inspectPath: "/workspace/reports/monthly.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: 1,
              headingCount: 1,
              tableCount: 0,
              textCharCount: 22
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion(args: Record<string, unknown>) {
          registerCalls.push(args);
          const versionNumber = registerCalls.length;
          return {
            accepted: true as const,
            docId: "doc-1",
            versionId: `version-${versionNumber}`,
            versionNumber,
            descriptorMode:
              versionNumber === 1 ? ("create_document" as const) : ("revise_document" as const),
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: "/workspace/reports/monthly.pdf",
            workspaceProjectPath: "/workspace/reports",
            sourceManifestPath: null,
            inspectionPath: "/workspace/reports/monthly.inspect.json"
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          if (input.toolCode === "files" && input.args.action === "resolve_write_path") {
            return createResolvedWritePathJob("/workspace/reports/monthly.md");
          }
          if (input.toolCode === "files" && input.args.action === "write") {
            return createWrittenWorkspaceFileJob(
              String(input.args.path ?? ""),
              String(input.args.content ?? "")
            );
          }
          if (input.toolCode === "execute_document_code") {
            return createCompletedDocumentJob();
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            return createAttachedWorkspaceFileJob(
              "/workspace/reports/monthly.pdf",
              "application/pdf",
              321
            );
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
          );
        }
      } as never
    );

    const executeRender = (requestId: string, content: string) =>
      service.executeToolCall({
        bundle: createBundle(),
        toolCall: {
          id: requestId,
          name: "document",
          arguments: {
            action: "render",
            outputPath: "/workspace/reports/monthly.pdf",
            format: "pdf",
            content
          }
        },
        sessionId: "session-1",
        requestId,
        conversation: {
          channel: "web",
          externalThreadKey: "thread-versioning"
        },
        deferToAsyncDocumentJob: {
          sourceUserMessageId: `${requestId}-msg`,
          sourceUserMessageText: "Render the document",
          currentAttachments: [],
          availableAttachments: []
        }
      });

    const first = await executeRender("render-v1", "# Monthly\n\nVersion 1");
    const second = await executeRender("render-v2", "# Monthly\n\nVersion 2");

    assert.equal(first.payload.action, "rendered");
    assert.equal(second.payload.action, "rendered");
    assert.equal(first.payload.registration?.versionNumber, 1);
    assert.equal(second.payload.registration?.versionNumber, 2);
    assert.equal(registerCalls.length, 2);
    assert.equal(registerCalls[0]?.outputPath, "/workspace/reports/monthly.pdf");
    assert.equal(registerCalls[1]?.outputPath, "/workspace/reports/monthly.pdf");
  });
});

export async function runRuntimeDocumentToolServiceTest(): Promise<void> {
  return;
}
