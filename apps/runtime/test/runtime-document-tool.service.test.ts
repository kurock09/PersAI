import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import { RuntimeDocumentToolService } from "../src/modules/turns/runtime-document-tool.service";

function createStoragePlaneStub(input?: {
  resolveWritePath?: (targetPath: string) => Promise<string> | string;
  writeTextFile?: (args: {
    targetPath: string;
    content: string;
  }) => Promise<{ ok: true; resolvedPath: string; sizeBytes: number }>;
  readTextFile?: (args: { path: string }) => Promise<{
    ok: true;
    content: string;
    sizeBytes: number;
    sha256: string;
    truncated: boolean;
  }>;
}) {
  return {
    async resolveWritePath(args: { targetPath: string }) {
      if (input?.resolveWritePath !== undefined) {
        return input.resolveWritePath(args.targetPath);
      }
      return args.targetPath;
    },
    async writeTextFile(args: { targetPath: string; content: string }) {
      if (input?.writeTextFile !== undefined) {
        return input.writeTextFile(args);
      }
      return {
        ok: true as const,
        resolvedPath: args.targetPath,
        sizeBytes: Buffer.byteLength(args.content, "utf8")
      };
    },
    async readTextFile(args: { path: string }) {
      if (input?.readTextFile !== undefined) {
        return input.readTextFile(args);
      }
      return {
        ok: true as const,
        content: "# file",
        sizeBytes: 6,
        sha256: "abc",
        truncated: false
      };
    }
  };
}

function createMediaStorageStub(input?: { downloadBytes?: Buffer }) {
  const downloadBytes = input?.downloadBytes ?? Buffer.from("rendered-bytes");
  return {
    buildWorkspaceObjectKey() {
      return "workspace/key";
    },
    async downloadObject() {
      return downloadBytes;
    },
    async saveObject(saveInput: { buffer: Buffer; mimeType: string }) {
      return {
        objectKey: "workspace/key",
        sizeBytes: saveInput.buffer.length,
        mimeType: saveInput.mimeType
      };
    }
  };
}

function createDocumentToolService(
  internalApi: unknown,
  options?: {
    storagePlane?: ReturnType<typeof createStoragePlaneStub>;
    mediaStorage?: ReturnType<typeof createMediaStorageStub>;
    sandbox?: unknown;
  }
) {
  return new RuntimeDocumentToolService(
    internalApi as never,
    (options?.storagePlane ?? createStoragePlaneStub()) as never,
    (options?.mediaStorage ?? createMediaStorageStub()) as never,
    options?.sandbox as never
  );
}

function createProducedDocumentJob(mimeType: string, sizeBytes: number) {
  return {
    status: "completed" as const,
    jobId: "job-render-1",
    toolCode: "execute_document_code",
    exitCode: 0,
    reason: null,
    warning: null,
    violationCode: null,
    violationMessage: null,
    stderr: null,
    content: null,
    files: [
      {
        relativePath: "output",
        displayName: "output",
        mimeType,
        sizeBytes,
        logicalSizeBytes: sizeBytes,
        storagePath: "fs/sandbox/job-render-1/output"
      }
    ]
  };
}

function createDocumentSandbox(input?: {
  calls?: Array<{ toolCode: string; args: Record<string, unknown> }>;
  mimeType?: string;
  sizeBytes?: number;
}) {
  return {
    isConfigured() {
      return true;
    },
    async waitForCompletion(jobInput: { toolCode: string; args: Record<string, unknown> }) {
      input?.calls?.push(jobInput);
      if (jobInput.toolCode === "execute_document_code") {
        return createCompletedDocumentJob(
          input?.mimeType ?? "application/pdf",
          input?.sizeBytes ?? 321
        );
      }
      throw new Error(
        `Unexpected sandbox call: ${jobInput.toolCode}/${String(jobInput.args.action ?? "")}`
      );
    }
  };
}

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

const TEST_SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/session-1";

function wp(relativePath: string): string {
  return `${TEST_SESSION_ROOT}/${relativePath.replace(/^\/+/, "")}`;
}

function createCompletedDocumentJob(mimeType = "application/pdf", sizeBytes = 321) {
  return createProducedDocumentJob(mimeType, sizeBytes);
}

describe("RuntimeDocumentToolService", () => {
  test('rejects removed "extract" action instead of aliasing it', async () => {
    const service = createDocumentToolService({});

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-extract-removed",
        name: "document",
        arguments: {
          action: "extract",
          path: wp("source.pdf")
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
    const service = createDocumentToolService({});

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-edit-removed",
        name: "document",
        arguments: {
          action: "edit",
          path: wp("source.docx"),
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
    const service = createDocumentToolService({});

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-register-version-removed",
        name: "document",
        arguments: {
          action: "register_version",
          outputPath: wp("source.pdf"),
          inspectionPath: wp("source.inspect.json"),
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

  test("rejects nested path in document.requestedName", async () => {
    const service = createDocumentToolService(
      {},
      {
        sandbox: {
          isConfigured() {
            return true;
          }
        }
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-bad-name",
        name: "document",
        arguments: {
          action: "render",
          requestedName: "/workspace/assistants/current/sessions/current/test.pdf",
          format: "pdf",
          content: "# Bad"
        }
      },
      sessionId: "session-1",
      requestId: "request-render-bad-name",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-bad-name",
        sourceUserMessageText: "Make a PDF",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.match(result.payload.warning ?? "", /filename only|requestedName/i);
  });

  test("inspects a document using only path", async () => {
    const inspectCalls: Array<Record<string, unknown>> = [];
    const service = createDocumentToolService({
      async inspectDocumentInWorkspace(args: Record<string, unknown>) {
        inspectCalls.push(args);
        return {
          accepted: true as const,
          sourcePath: wp("source.pdf"),
          inspectPath: wp("source.inspect.json"),
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
          suggestedReadPaths: [wp("source.inspect.json")],
          editMethod: "shell_native",
          siblingMarkdownPath: null,
          extractedMdPath: null
        };
      }
    });

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-inspect-1",
        name: "document",
        arguments: {
          action: "inspect",
          path: wp("source.pdf")
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
    assert.equal(result.payload.inspection?.inspectPath, wp("source.inspect.json"));
    assert.deepEqual(inspectCalls, [
      {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        path: wp("source.pdf"),
        depth: "standard",
        outputPath: null
      }
    ]);
  });

  test("renders authored PDF and persists collision-safe sibling markdown", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const storageCalls: Array<{ kind: string; path: string }> = [];
    const metadataPaths: string[] = [];
    const resolvedMarkdownPath = wp("monthly (1).md");
    const markdownContent = "# Monthly\n\nSummary body.";
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata(args: Record<string, unknown>) {
          metadataPaths.push(String(args.path ?? ""));
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: wp("reports/monthly.pdf"),
            inspectPath: wp("reports/monthly.inspect.json"),
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
            editMethod: "shell_native",
            siblingMarkdownPath: null,
            extractedMdPath: null
          };
        }
      },
      {
        storagePlane: createStoragePlaneStub({
          resolveWritePath(targetPath) {
            storageCalls.push({ kind: "resolve", path: targetPath });
            return targetPath.endsWith(".md") ? resolvedMarkdownPath : targetPath;
          },
          async writeTextFile(args) {
            storageCalls.push({ kind: "write", path: args.targetPath });
            return {
              ok: true,
              resolvedPath: args.targetPath,
              sizeBytes: Buffer.byteLength(args.content, "utf8")
            };
          }
        }),
        mediaStorage: createMediaStorageStub({
          downloadBytes: Buffer.alloc(321)
        }),
        sandbox: {
          isConfigured() {
            return true;
          },
          async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
            sandboxCalls.push(input);
            if (input.toolCode === "execute_document_code") {
              return createCompletedDocumentJob("application/pdf", 321);
            }
            throw new Error(
              `Unexpected sandbox call: ${input.toolCode}/${String(input.args.action ?? "")}`
            );
          }
        }
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-pdf",
        name: "document",
        arguments: {
          action: "render",
          requestedName: "monthly.pdf",
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
    assert.equal(result.payload.render?.outputPath, wp("monthly.pdf"));
    assert.equal(result.payload.render?.sourceMarkdownPath, resolvedMarkdownPath);
    assert.equal(result.payload.render?.mimeType, "application/pdf");
    assert.equal(result.payload.descriptorMode, null);
    assert.equal(result.payload.docId, null);
    assert.equal(result.payload.versionId, undefined);
    assert.deepEqual(
      sandboxCalls.map((call) => `${call.toolCode}:${String(call.args.action ?? "")}`),
      ["execute_document_code:"]
    );
    assert.deepEqual(
      storageCalls.map((call) => `${call.kind}:${call.path}`),
      [`resolve:${wp("monthly.md")}`, `write:${resolvedMarkdownPath}`]
    );
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /CONTENT_PATH = Path\(".*monthly \(1\)\.md"\)/);
    assert.match(
      programSource,
      new RegExp(
        `OUTPUT_PATH = Path\\("${wp("monthly.pdf").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`
      )
    );
    assert.doesNotMatch(programSource, /PERSAI_OUTPUT_PATH/);
    assert.match(programSource, /HTML\(string=build_html_document\(\)/);
    assert.deepEqual(metadataPaths, [wp("monthly.pdf")]);
  });

  test("renders authored XLSX from Markdown tables and writes sibling markdown", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const markdownPath = wp("revenue.md");
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: wp("tables/revenue.xlsx"),
            inspectPath: wp("tables/revenue.inspect.json"),
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
            editMethod: "shell_native",
            siblingMarkdownPath: null,
            extractedMdPath: null
          };
        }
      },
      {
        sandbox: createDocumentSandbox({
          calls: sandboxCalls,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 512
        })
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-xlsx",
        name: "document",
        arguments: {
          action: "render",
          requestedName: "revenue.xlsx",
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
    assert.match(
      programSource,
      new RegExp(
        `OUTPUT_PATH = Path\\("${wp("revenue.xlsx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`
      )
    );
    assert.doesNotMatch(programSource, /PERSAI_OUTPUT_PATH/);
    assert.match(programSource, /requires at least one Markdown table/);
    assert.match(programSource, /sheet\.append/);
  });

  test("converts an existing document and derives outputPath when omitted", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const upsertCalls: Array<Record<string, unknown>> = [];
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata(args: Record<string, unknown>) {
          upsertCalls.push(args);
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: wp("source.pdf"),
            inspectPath: wp("source.inspect.json"),
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
            editMethod: "shell_native",
            siblingMarkdownPath: null,
            extractedMdPath: null
          };
        }
      },
      {
        sandbox: createDocumentSandbox({
          calls: sandboxCalls,
          mimeType: "application/pdf",
          sizeBytes: 2048
        })
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-convert-pdf",
        name: "document",
        arguments: {
          action: "convert",
          source: wp("source.docx"),
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
    assert.equal(result.payload.convert?.sourcePath, wp("source.docx"));
    assert.equal(result.payload.convert?.outputPath, wp("source.pdf"));
    assert.equal(result.payload.convert?.targetFormat, "pdf");
    const documentUpsert = upsertCalls.at(-1);
    assert.equal(documentUpsert?.path, wp("source.pdf"));
    assert.equal(documentUpsert?.replace, true);
    assert.equal(documentUpsert?.sourceUserMessageText, "Convert this file");
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /soffice/);
    assert.match(
      programSource,
      new RegExp(
        `SOURCE_PATH = Path\\("${wp("source.docx").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`
      )
    );
    assert.match(
      programSource,
      new RegExp(
        `OUTPUT_PATH = Path\\("${wp("source.pdf").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`
      )
    );
    assert.doesNotMatch(programSource, /PERSAI_OUTPUT_PATH/);
    assert.match(programSource, /TARGET_FORMAT = "pdf"/);
  });

  test("render succeeds without legacy direct register/version payloads", async () => {
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          throw new Error("inspect should not run after single-owner registration cutover");
        }
      },
      {
        sandbox: createDocumentSandbox({ mimeType: "application/pdf", sizeBytes: 321 })
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-warning",
        name: "document",
        arguments: {
          action: "render",
          requestedName: "monthly.pdf",
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
    assert.equal(result.payload.render?.outputPath, wp("monthly.pdf"));
    assert.equal(result.payload.warning, null);
  });

  test("convert succeeds without legacy direct register/version payloads", async () => {
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace() {
          throw new Error("inspect should not run after single-owner registration cutover");
        }
      },
      {
        sandbox: createDocumentSandbox({ mimeType: "application/pdf", sizeBytes: 2048 })
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-convert-warning",
        name: "document",
        arguments: {
          action: "convert",
          source: wp("source.docx"),
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
    assert.equal(result.payload.convert?.outputPath, wp("source.pdf"));
    assert.equal(result.payload.warning, null);
  });

  test("render stays rendered when metadata upsert fails after attach", async () => {
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          throw new Error("registration unavailable");
        },
        async inspectDocumentInWorkspace() {
          throw new Error("inspect should not run after single-owner registration cutover");
        }
      },
      {
        sandbox: createDocumentSandbox({ mimeType: "application/pdf", sizeBytes: 321 })
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-upsert-warning",
        name: "document",
        arguments: {
          action: "render",
          requestedName: "monthly.pdf",
          format: "pdf",
          content: "# Monthly\n\nSummary body."
        }
      },
      sessionId: "session-1",
      requestId: "request-render-upsert-warning",
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
    assert.equal(result.payload.render?.outputPath, wp("monthly.pdf"));
    assert.match(result.payload.warning ?? "", /registration unavailable/);
  });

  test("convert stays converted when metadata upsert fails after attach", async () => {
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata() {
          throw new Error("registration unavailable");
        },
        async inspectDocumentInWorkspace() {
          throw new Error("inspect should not run after single-owner registration cutover");
        }
      },
      {
        sandbox: createDocumentSandbox({ mimeType: "application/pdf", sizeBytes: 2048 })
      }
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-convert-upsert-warning",
        name: "document",
        arguments: {
          action: "convert",
          source: wp("source.docx"),
          targetFormat: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-convert-upsert-warning",
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
    assert.equal(result.payload.convert?.outputPath, wp("source.pdf"));
    assert.match(result.payload.warning ?? "", /registration unavailable/);
  });

  test("Case A: edit sibling markdown and re-render persists the same output path through the single-owner seam", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const documentUpsertCalls: Array<Record<string, unknown>> = [];
    const initialMarkdown = "# Report\n\nOriginal body.\n";
    const editedMarkdown = "# Report\n\nEdited body with exact spacing.\n";
    const sourceMarkdownPath =
      "/workspace/assistants/assistant-1/sessions/session-case-a/report.md";
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata(args: Record<string, unknown>) {
          if (String(args.path ?? "").endsWith(".pdf")) {
            documentUpsertCalls.push(args);
          }
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: wp("report.pdf"),
            inspectPath: wp("report.inspect.json"),
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
            editMethod: "shell_native",
            siblingMarkdownPath: null,
            extractedMdPath: null
          };
        }
      },
      {
        storagePlane: createStoragePlaneStub({
          resolveWritePath(targetPath) {
            return targetPath.endsWith("report.md") ? sourceMarkdownPath : targetPath;
          },
          async writeTextFile(args) {
            return {
              ok: true,
              resolvedPath: args.targetPath,
              sizeBytes: Buffer.byteLength(args.content, "utf8")
            };
          },
          async readTextFile(args) {
            return {
              ok: true,
              content: args.path === sourceMarkdownPath ? editedMarkdown : initialMarkdown,
              sizeBytes: editedMarkdown.length,
              sha256: "abc",
              truncated: false
            };
          }
        }),
        sandbox: createDocumentSandbox({
          calls: sandboxCalls,
          mimeType: "application/pdf",
          sizeBytes: 2048
        })
      }
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
      requestedName: "report.pdf"
    });
    const second = await executeRender("case-a-render-v2", {
      action: "render",
      contentPath: sourceMarkdownPath,
      format: "pdf",
      requestedName: "report.pdf"
    });

    assert.equal(first.isError, false);
    assert.equal(first.payload.action, "rendered");
    assert.equal(first.payload.render?.sourceMarkdownPath, sourceMarkdownPath);
    assert.equal(second.isError, false);
    assert.equal(second.payload.action, "rendered");
    assert.equal(
      second.payload.render?.outputPath,
      "/workspace/assistants/assistant-1/sessions/session-case-a/report.pdf"
    );
    assert.equal(documentUpsertCalls.length, 2);
    assert.equal(
      documentUpsertCalls[0]?.path,
      "/workspace/assistants/assistant-1/sessions/session-case-a/report.pdf"
    );
    assert.equal(
      documentUpsertCalls[1]?.path,
      "/workspace/assistants/assistant-1/sessions/session-case-a/report.pdf"
    );
    assert.equal(documentUpsertCalls[0]?.replace, true);
    assert.equal(documentUpsertCalls[1]?.replace, true);
    assert.deepEqual(
      sandboxCalls.map((call) => `${call.toolCode}:${String(call.args.action ?? "")}`),
      ["execute_document_code:", "execute_document_code:"]
    );
    const secondProgramSource = String(
      sandboxCalls.filter((call) => call.toolCode === "execute_document_code").at(-1)?.args
        .programSource ?? ""
    );
    assert.match(
      secondProgramSource,
      new RegExp(
        `CONTENT_PATH = Path\\("${"/workspace/assistants/assistant-1/sessions/session-case-a/report.md".replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`
      )
    );
  });

  test("rendering the same output path twice uses the same single-owner persist path twice", async () => {
    const documentUpsertCalls: Array<Record<string, unknown>> = [];
    const service = createDocumentToolService(
      {
        async upsertWorkspaceFileMetadata(args: Record<string, unknown>) {
          if (String(args.path ?? "").endsWith(".pdf")) {
            documentUpsertCalls.push(args);
          }
        },
        async inspectDocumentInWorkspace() {
          return {
            accepted: true as const,
            sourcePath: wp("reports/monthly.pdf"),
            inspectPath: wp("reports/monthly.inspect.json"),
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
            editMethod: "shell_native",
            siblingMarkdownPath: null,
            extractedMdPath: null
          };
        }
      },
      {
        sandbox: createDocumentSandbox({ mimeType: "application/pdf", sizeBytes: 321 })
      }
    );

    const executeRender = (requestId: string, content: string) =>
      service.executeToolCall({
        bundle: createBundle(),
        toolCall: {
          id: requestId,
          name: "document",
          arguments: {
            action: "render",
            requestedName: "monthly.pdf",
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
    assert.equal(documentUpsertCalls.length, 2);
    assert.equal(documentUpsertCalls[0]?.path, wp("monthly.pdf"));
    assert.equal(documentUpsertCalls[1]?.path, wp("monthly.pdf"));
  });
});

export async function runRuntimeDocumentToolServiceTest(): Promise<void> {
  return;
}
