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
      /document\.action must be "inspect", "render", or "convert"/
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
    assert.equal(registerCalls[0]?.workspaceProjectPath, "/workspace/reports");
    assert.equal(registerCalls[0]?.outputPath, "/workspace/reports/monthly.pdf");
    assert.deepEqual(
      sandboxCalls.map((call) => `${call.toolCode}:${String(call.args.action ?? "")}`),
      [
        "files:resolve_write_path",
        "files:write",
        "files:write",
        "execute_document_code:",
        "files:attach"
      ]
    );
    assert.equal(sandboxCalls[0]?.args.path, "/workspace/reports/monthly.md");
    assert.equal(sandboxCalls[0]?.args.replace, false);
    assert.equal(sandboxCalls[1]?.args.path, resolvedMarkdownPath);
    assert.equal(sandboxCalls[1]?.args.replace, false);
    assert.equal(sandboxCalls[2]?.args.path, "/workspace/reports/project.json");
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /CONTENT_PATH = Path\(".*monthly \(1\)\.md"\)/);
    assert.match(programSource, /HTML\(string=build_html_document\(\)/);
    assert.deepEqual(metadataPaths, [
      resolvedMarkdownPath,
      "/workspace/reports/project.json",
      "/workspace/reports/monthly.pdf"
    ]);
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
    assert.equal(registerCalls[0]?.workspaceProjectPath, "/workspace");
    assert.equal(registerCalls[0]?.outputPath, "/workspace/source.pdf");
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /soffice/);
    assert.match(programSource, /SOURCE_PATH = Path\("\/workspace\/source\.docx"\)/);
    assert.match(programSource, /TARGET_FORMAT = "pdf"/);
  });
});

export async function runRuntimeDocumentToolServiceTest(): Promise<void> {
  return;
}
