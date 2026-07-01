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
          outputDir: "/workspace/projects/source/extract",
          manifestPath: "/workspace/projects/source/extract/manifest.json",
          projectPath: "/workspace/projects/source",
          projectManifestPath: "/workspace/projects/source/project.json",
          projectSourcePath: "/workspace/projects/source/source/source.pdf",
          defaultRenderEntrypoint: "/workspace/projects/source/render/report.html",
          defaultPdfOutputPath: "/workspace/projects/source/output/report.pdf",
          outputPaths: [
            "/workspace/projects/source/extract/extracted.md",
            "/workspace/projects/source/extract/manifest.json",
            "/workspace/projects/source/project.json",
            "/workspace/projects/source/render/report.html"
          ],
          suggestedReadPaths: [
            "/workspace/projects/source/project.json",
            "/workspace/projects/source/render/report.html",
            "/workspace/projects/source/extract/manifest.json",
            "/workspace/projects/source/extract/extracted.md"
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
      "/workspace/projects/source/extract/manifest.json"
    );
    assert.equal(result.payload.extraction?.projectPath, "/workspace/projects/source");
    assert.equal(
      result.payload.extraction?.projectSourcePath,
      "/workspace/projects/source/source/source.pdf"
    );
    assert.deepEqual(result.payload.extraction?.counts, {
      documentCount: 1,
      pageCount: 4,
      sheetCount: null
    });
  });

  test("rejects document.extract outputDir arguments", async () => {
    const service = new RuntimeDocumentToolService({} as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-extract-outputdir",
        name: "document",
        arguments: {
          action: "extract",
          path: "/workspace/source.pdf",
          outputDir: "/workspace/source.extract"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-extract-outputdir",
        sourceUserMessageText: "Extract this file",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.match(result.payload.warning ?? "", /no longer accepts outputDir/i);
  });

  test("renders PDF from full extracted.md in a document project", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const fullExtractedText = "Paragraph one.\n\nParagraph two with more content.";
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              { type: "file", path: "/workspace/projects/report/render/report.html" },
              { type: "file", path: "/workspace/projects/report/extract/extracted.md" },
              { type: "file", path: "/workspace/projects/report/project.json" }
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
                  relativePath: "output/report.pdf",
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
            const path = String(input.args.path ?? "");
            if (path.endsWith("/extract/extracted.md")) {
              return {
                status: "completed",
                exitCode: 0,
                reason: null,
                warning: null,
                violationMessage: null,
                stderr: null,
                content: JSON.stringify({
                  content: fullExtractedText,
                  sizeBytes: fullExtractedText.length,
                  sha256: null,
                  truncated: false
                }),
                files: []
              };
            }
            if (path.endsWith("/project.json")) {
              return {
                status: "completed",
                exitCode: 0,
                reason: null,
                warning: null,
                violationMessage: null,
                stderr: null,
                content: JSON.stringify({
                  content: JSON.stringify({
                    schema: "persai.document.project.v1",
                    sourceKind: "imported_workspace_file",
                    sourceFormat: "text",
                    sourcePath: "/workspace/source.txt"
                  }),
                  sizeBytes: 64,
                  sha256: null,
                  truncated: false
                }),
                files: []
              };
            }
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content: "<html><body><h1>Truncated</h1></body></html>",
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
                  workspaceRelPath: "/workspace/projects/report/output/report.pdf",
                  sourcePath: "/workspace/projects/report/output/report.pdf",
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
        id: "tool-render-project-full-text",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/projects/report",
          outputPath: "/workspace/projects/report/output/report.pdf",
          format: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      activeDocumentProjectPath: "/workspace/projects/report",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-project-full-text",
        sourceUserMessageText: "Render the report",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /Paragraph one\./);
    assert.match(programSource, /Paragraph two with more content\./);
    assert.doesNotMatch(programSource, /Truncated/);
  });

  test("renders imported office projects through the seeded native build scaffold", async () => {
    for (const scenario of [
      {
        format: "docx" as const,
        outputPath: "/workspace/projects/report/output/report.docx",
        sourcePath: "/workspace/source.docx",
        projectSourcePath: "/workspace/projects/report/source/source.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buildScript:
          "from docx import Document\ndocument = Document(str(SOURCE_PATH))\ndocument.save(PERSAI_OUTPUT_PATH)\n"
      },
      {
        format: "xlsx" as const,
        outputPath: "/workspace/projects/report/output/report.xlsx",
        sourcePath: "/workspace/source.xlsx",
        projectSourcePath: "/workspace/projects/report/source/source.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buildScript:
          "from openpyxl import load_workbook\nworkbook = load_workbook(filename=str(SOURCE_PATH))\nworkbook.save(PERSAI_OUTPUT_PATH)\n"
      }
    ]) {
      const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
      const service = new RuntimeDocumentToolService(
        {
          async listWorkspaceFilesFromManifest() {
            return {
              items: [
                { type: "file", path: "/workspace/projects/report/project.json" },
                { type: "file", path: "/workspace/projects/report/render/build.py" }
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
            if (input.toolCode === "files" && input.args.action === "read") {
              if (input.args.path === "/workspace/projects/report/project.json") {
                return {
                  status: "completed",
                  exitCode: 0,
                  reason: null,
                  warning: null,
                  violationMessage: null,
                  stderr: null,
                  content: JSON.stringify({
                    content: JSON.stringify({
                      schema: "persai.document.project.v1",
                      sourceKind: "imported_workspace_file",
                      sourceFormat: scenario.format,
                      sourcePath: scenario.sourcePath,
                      projectSourcePath: scenario.projectSourcePath,
                      defaultRenderEntrypoint: "/workspace/projects/report/render/build.py"
                    }),
                    sizeBytes: 128,
                    sha256: null,
                    truncated: false
                  }),
                  files: []
                };
              }
              return {
                status: "completed",
                exitCode: 0,
                reason: null,
                warning: null,
                violationMessage: null,
                stderr: null,
                content: JSON.stringify({
                  content: scenario.buildScript,
                  sizeBytes: scenario.buildScript.length,
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
                    workspaceRelPath: scenario.outputPath,
                    sourcePath: scenario.outputPath,
                    sizeBytes: 2048,
                    mimeType: scenario.mimeType,
                    displayName: scenario.outputPath.split("/").pop()
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
          id: `tool-render-imported-${scenario.format}`,
          name: "document",
          arguments: {
            action: "render",
            projectPath: "/workspace/projects/report",
            outputPath: scenario.outputPath,
            format: scenario.format
          }
        },
        sessionId: "session-1",
        requestId: `request-imported-${scenario.format}`,
        activeDocumentProjectPath: "/workspace/projects/report",
        deferToAsyncDocumentJob: {
          sourceUserMessageId: `msg-render-imported-${scenario.format}`,
          sourceUserMessageText: `Render the imported ${scenario.format}`,
          currentAttachments: [],
          availableAttachments: []
        }
      });

      assert.equal(result.isError, false);
      assert.equal(result.payload.action, "rendered");
      assert.equal(
        result.payload.render?.entrypointPath,
        "/workspace/projects/report/render/build.py"
      );
      assert.equal(result.payload.render?.format, scenario.format);
      const programSource = String(
        sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args
          .programSource ?? ""
      );
      assert.match(programSource, /PERSAI_OUTPUT_PATH/);
      assert.match(
        programSource,
        scenario.format === "docx"
          ? /from docx import Document/
          : /from openpyxl import load_workbook/
      );
    }
  });

  test("renders imported office pdf export through the visible Office exporter entrypoint", async () => {
    for (const scenario of [
      {
        sourceFormat: "docx" as const,
        sourcePath: "/workspace/source.docx",
        projectSourcePath: "/workspace/projects/report/source/source.docx"
      },
      {
        sourceFormat: "xlsx" as const,
        sourcePath: "/workspace/source.xlsx",
        projectSourcePath: "/workspace/projects/report/source/source.xlsx"
      }
    ]) {
      const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
      const service = new RuntimeDocumentToolService(
        {
          async listWorkspaceFilesFromManifest() {
            return {
              items: [
                { type: "file", path: "/workspace/projects/report/project.json" },
                { type: "file", path: "/workspace/projects/report/render/export_pdf.py" },
                { type: "file", path: "/workspace/projects/report/render/report.html" }
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
            if (input.toolCode === "files" && input.args.action === "read") {
              if (input.args.path === "/workspace/projects/report/project.json") {
                return {
                  status: "completed",
                  exitCode: 0,
                  reason: null,
                  warning: null,
                  violationMessage: null,
                  stderr: null,
                  content: JSON.stringify({
                    content: JSON.stringify({
                      schema: "persai.document.project.v1",
                      sourceKind: "imported_workspace_file",
                      sourceFormat: scenario.sourceFormat,
                      sourcePath: scenario.sourcePath,
                      projectSourcePath: scenario.projectSourcePath,
                      defaultRenderEntrypoint: "/workspace/projects/report/render/build.py",
                      defaultPdfExportEntrypoint: "/workspace/projects/report/render/export_pdf.py"
                    }),
                    sizeBytes: 128,
                    sha256: null,
                    truncated: false
                  }),
                  files: []
                };
              }
              return {
                status: "completed",
                exitCode: 0,
                reason: null,
                warning: null,
                violationMessage: null,
                stderr: null,
                content: JSON.stringify({
                  content:
                    "from pathlib import Path\nimport subprocess\nOUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)\nsubprocess.run(['soffice', '--headless'], check=False)\nOUTPUT_PATH.write_bytes(b'%PDF-1.4 fake')\n",
                  sizeBytes: 128,
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
                    workspaceRelPath: "/workspace/projects/report/output/report.pdf",
                    sourcePath: "/workspace/projects/report/output/report.pdf",
                    sizeBytes: 4096,
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
          id: `tool-render-imported-${scenario.sourceFormat}-pdf`,
          name: "document",
          arguments: {
            action: "render",
            projectPath: "/workspace/projects/report",
            outputPath: "/workspace/projects/report/output/report.pdf",
            format: "pdf"
          }
        },
        sessionId: "session-1",
        requestId: `request-imported-${scenario.sourceFormat}-pdf`,
        activeDocumentProjectPath: "/workspace/projects/report",
        deferToAsyncDocumentJob: {
          sourceUserMessageId: `msg-render-imported-${scenario.sourceFormat}-pdf`,
          sourceUserMessageText: `Render the imported ${scenario.sourceFormat} as pdf`,
          currentAttachments: [],
          availableAttachments: []
        }
      });

      assert.equal(result.isError, false);
      assert.equal(result.payload.action, "rendered");
      assert.equal(
        result.payload.render?.entrypointPath,
        "/workspace/projects/report/render/export_pdf.py"
      );
      const programSource = String(
        sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args
          .programSource ?? ""
      );
      assert.match(programSource, /soffice/);
      assert.match(programSource, /PERSAI_OUTPUT_PATH/);
      assert.doesNotMatch(programSource, /weasyprint/i);
    }
  });

  test("does not fall back to extracted-text HTML for imported office pdf export", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              { type: "file", path: "/workspace/projects/report/project.json" },
              { type: "file", path: "/workspace/projects/report/render/build.py" },
              { type: "file", path: "/workspace/projects/report/render/report.html" }
            ]
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          return {
            status: "completed",
            exitCode: 0,
            reason: null,
            warning: null,
            violationMessage: null,
            stderr: null,
            content: JSON.stringify({
              content: JSON.stringify({
                schema: "persai.document.project.v1",
                sourceKind: "imported_workspace_file",
                sourceFormat: "docx",
                sourcePath: "/workspace/source.docx",
                projectSourcePath: "/workspace/projects/report/source/source.docx",
                defaultRenderEntrypoint: "/workspace/projects/report/render/build.py",
                defaultPdfExportEntrypoint: "/workspace/projects/report/render/export_pdf.py"
              }),
              sizeBytes: 128,
              sha256: null,
              truncated: false
            }),
            files: []
          };
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-imported-docx-pdf-missing-exporter",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/projects/report",
          outputPath: "/workspace/projects/report/output/report.pdf",
          format: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-imported-docx-pdf-missing-exporter",
      activeDocumentProjectPath: "/workspace/projects/report",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-imported-docx-pdf-missing-exporter",
        sourceUserMessageText: "Render the imported DOCX as pdf",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "unsupported_render_source");
    assert.match(result.payload.warning ?? "", /render\/export_pdf\.py/);
    assert.ok(
      sandboxCalls.every(
        (call) =>
          call.toolCode !== "execute_document_code" &&
          !(
            call.toolCode === "files" &&
            call.args.path === "/workspace/projects/report/render/report.html"
          )
      ),
      "imported office pdf export must not fall back to report.html or execute a synthetic HTML render"
    );
  });

  test("fails honestly when the imported office pdf exporter does not create the output", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              { type: "file", path: "/workspace/projects/report/project.json" },
              { type: "file", path: "/workspace/projects/report/render/export_pdf.py" }
            ]
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          if (input.toolCode === "files" && input.args.action === "read") {
            if (input.args.path === "/workspace/projects/report/project.json") {
              return {
                status: "completed",
                exitCode: 0,
                reason: null,
                warning: null,
                violationMessage: null,
                stderr: null,
                content: JSON.stringify({
                  content: JSON.stringify({
                    schema: "persai.document.project.v1",
                    sourceKind: "imported_workspace_file",
                    sourceFormat: "xlsx",
                    sourcePath: "/workspace/source.xlsx",
                    projectSourcePath: "/workspace/projects/report/source/source.xlsx",
                    defaultRenderEntrypoint: "/workspace/projects/report/render/build.py",
                    defaultPdfExportEntrypoint: "/workspace/projects/report/render/export_pdf.py"
                  }),
                  sizeBytes: 128,
                  sha256: null,
                  truncated: false
                }),
                files: []
              };
            }
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content:
                  "import subprocess\nfrom pathlib import Path\nOUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)\nsubprocess.run(['soffice', '--headless'], check=False)\nprint(OUTPUT_PATH)\n",
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
              exitCode: 1,
              reason: "sandbox_render_failed",
              warning: null,
              violationMessage: null,
              stderr:
                "Build script did not create the declared output path: /workspace/projects/report/output/report.pdf",
              content: null,
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
        id: "tool-render-imported-xlsx-pdf-failure",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/projects/report",
          outputPath: "/workspace/projects/report/output/report.pdf",
          format: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-imported-xlsx-pdf-failure",
      activeDocumentProjectPath: "/workspace/projects/report",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-imported-xlsx-pdf-failure",
        sourceUserMessageText: "Render the imported XLSX as pdf",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "sandbox_render_failed");
    assert.match(result.payload.warning ?? "", /did not create the declared output path/i);
    const programSource = String(
      sandboxCalls.find((call) => call.toolCode === "execute_document_code")?.args.programSource ??
        ""
    );
    assert.match(programSource, /soffice/);
    assert.doesNotMatch(programSource, /weasyprint/i);
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
          suggestedReadPaths: ["/workspace/output.inspect.json"],
          comparison: {
            comparisonKind: "imported_same_format_project_output" as const,
            sourcePath: "/workspace/projects/output/source/source.xlsx",
            sourceFormat: "xlsx" as const,
            summary:
              "Rendered XLSX appears structurally degraded relative to projectSourcePath (1 warning).",
            warningCount: 1,
            warnings: ["Rendered XLSX has fewer formulas than projectSourcePath (5 < 8)."]
          }
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
    assert.equal(
      result.payload.inspection?.comparison?.comparisonKind,
      "imported_same_format_project_output"
    );
    assert.match(result.payload.inspection?.comparison?.summary ?? "", /structurally degraded/i);
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
          documentType: "workspace_document" as const,
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

  test("surfaces register_version inspect gating failures clearly", async () => {
    const service = new RuntimeDocumentToolService({
      async registerDocumentVersion() {
        return {
          accepted: false as const,
          code: "inspect_missing",
          message:
            "Document deliverable output requires a relevant document.inspect result before document.register_version or files.attach."
        };
      }
    } as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-register-missing-inspect",
        name: "document",
        arguments: {
          action: "register_version",
          workspaceProjectPath: "/workspace/report",
          outputPath: "/workspace/report/report.pdf"
        }
      },
      conversation: {
        channel: "web",
        externalThreadKey: "chat:web:1"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-register-missing-inspect",
        sourceUserMessageText: "Register this report version",
        sourceUserMessageCreatedAt: "2026-06-29T15:00:00.000Z",
        currentAttachments: [],
        availableAttachments: []
      }
    });
    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "inspect_missing");
    assert.match(result.payload.warning ?? "", /document\.inspect/i);
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
    assert.equal(sandboxCalls[0]?.toolCode, "files");
    assert.equal(sandboxCalls[0]?.args.action, "read");
    assert.equal(sandboxCalls[0]?.args.path, "/workspace/report/project.json");
    assert.equal(sandboxCalls[1]?.toolCode, "files");
    assert.equal(sandboxCalls[1]?.args.path, "/workspace/report/report.html");
    assert.equal(sandboxCalls[2]?.toolCode, "execute_document_code");
    assert.match(
      String(sandboxCalls[2]?.args.programSource ?? ""),
      /HTML\(string=html_source, base_url=project_dir\)/
    );
    assert.match(
      String(sandboxCalls[2]?.args.programSource ?? ""),
      /<html><body><h1>Report<\/h1><\/body><\/html>/
    );
    assert.doesNotMatch(
      String(sandboxCalls[2]?.args.programSource ?? ""),
      /HTML\(filename=entrypoint_path/
    );
    assert.equal(sandboxCalls[3]?.toolCode, "files");
  });

  test("auto-registers a document version after successful render when conversation is present", async () => {
    const registerCalls: Array<{
      workspaceProjectPath: string;
      outputPath: string;
      channel: string;
    }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              {
                path: "/workspace/projects/auto-register/render/report.html",
                type: "file" as const,
                sizeBytes: 120,
                mimeType: "text/html",
                modifiedAt: "2026-06-30T12:00:00.000Z"
              }
            ]
          };
        },
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async registerDocumentVersion(input: {
          channel: string;
          workspaceProjectPath: string;
          outputPath: string;
        }) {
          registerCalls.push({
            channel: input.channel,
            workspaceProjectPath: input.workspaceProjectPath,
            outputPath: input.outputPath
          });
          return {
            accepted: true as const,
            docId: "doc-auto-1",
            versionId: "version-auto-1",
            versionNumber: 1,
            descriptorMode: "create_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: input.outputPath,
            workspaceProjectPath: input.workspaceProjectPath,
            sourceManifestPath: null,
            inspectionPath: null
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
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
                  relativePath: "output/report.pdf",
                  displayName: "report.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 2048,
                  logicalSizeBytes: 2048,
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
                  workspaceRelPath: "/workspace/projects/auto-register/output/report.pdf",
                  sourcePath: "/workspace/projects/auto-register/output/report.pdf",
                  sizeBytes: 2048,
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
        id: "tool-auto-register-render-1",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/projects/auto-register",
          outputPath: "/workspace/projects/auto-register/output/report.pdf",
          format: "pdf",
          entrypoint: "render/report.html"
        }
      },
      sessionId: "session-auto-1",
      requestId: "request-auto-1",
      conversation: {
        channel: "web",
        externalThreadKey: "chat:web:auto-register"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-auto-register-1",
        sourceUserMessageText: "Render this report",
        sourceUserMessageCreatedAt: "2026-06-30T12:00:00.000Z",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.warning, null);
    assert.equal(result.payload.docId, "doc-auto-1");
    assert.equal(result.payload.versionId, "version-auto-1");
    assert.equal(result.payload.descriptorMode, "create_document");
    assert.equal(
      result.payload.registration?.outputPath,
      "/workspace/projects/auto-register/output/report.pdf"
    );
    assert.equal(result.payload.registration?.versionNumber, 1);
    assert.equal(registerCalls.length, 1);
    assert.equal(registerCalls[0]?.channel, "web");
    assert.equal(registerCalls[0]?.workspaceProjectPath, "/workspace/projects/auto-register");
  });

  test("returns render success with auto_register_skipped warning when auto-register fails best-effort", async () => {
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              {
                path: "/workspace/projects/best-effort/render/report.html",
                type: "file" as const,
                sizeBytes: 120,
                mimeType: "text/html",
                modifiedAt: "2026-06-30T12:00:00.000Z"
              }
            ]
          };
        },
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async registerDocumentVersion() {
          return {
            accepted: false as const,
            code: "inspect_missing",
            message:
              "Document deliverable output requires a relevant document.inspect result before document.register_version or files.attach."
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
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
                  relativePath: "output/report.pdf",
                  displayName: "report.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 2048,
                  logicalSizeBytes: 2048,
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
                  workspaceRelPath: "/workspace/projects/best-effort/output/report.pdf",
                  sourcePath: "/workspace/projects/best-effort/output/report.pdf",
                  sizeBytes: 2048,
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
        id: "tool-auto-register-best-effort-1",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/projects/best-effort",
          outputPath: "/workspace/projects/best-effort/output/report.pdf",
          format: "pdf",
          entrypoint: "render/report.html"
        }
      },
      sessionId: "session-best-effort-1",
      requestId: "request-best-effort-1",
      conversation: {
        channel: "web",
        externalThreadKey: "chat:web:best-effort"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-best-effort-1",
        sourceUserMessageText: "Render this report",
        sourceUserMessageCreatedAt: "2026-06-30T12:00:00.000Z",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.docId, null);
    assert.equal(result.payload.versionId, undefined);
    assert.equal(result.payload.registration ?? null, null);
    assert.match(result.payload.warning ?? "", /^auto_register_skipped:inspect_missing/);
    assert.equal(
      result.payload.render?.outputPath,
      "/workspace/projects/best-effort/output/report.pdf"
    );
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
            if (input.args.path === "/workspace/model/project.json") {
              return {
                status: "completed",
                exitCode: 0,
                reason: null,
                warning: null,
                violationMessage: null,
                stderr: null,
                content: JSON.stringify({
                  content: JSON.stringify({
                    schema: "persai.document.project.v1",
                    sourceKind: "authored_workspace_project",
                    sourceFormat: "python",
                    sourcePath: "/workspace/model/build.py",
                    projectSourcePath: "/workspace/model/build.py"
                  }),
                  sizeBytes: 128,
                  sha256: null,
                  truncated: false
                }),
                files: []
              };
            }
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
    assert.equal(sandboxCalls[0]?.args.path, "/workspace/model/project.json");
    assert.equal(sandboxCalls[1]?.toolCode, "files");
    assert.equal(sandboxCalls[1]?.args.path, "/workspace/model/build.py");
    assert.equal(sandboxCalls[2]?.toolCode, "execute_document_code");
    assert.equal(sandboxCalls[2]?.args.outputFileName, "model/output.xlsx");
    assert.match(String(sandboxCalls[2]?.args.programSource ?? ""), /PERSAI_OUTPUT_PATH/);
    assert.equal(sandboxCalls[3]?.toolCode, "files");
    assert.equal(sandboxCalls[3]?.args.action, "attach");
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

  test("document.render does not auto-run build.py for pdf output", async () => {
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [{ type: "file", path: "/workspace/report/build.py" }]
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion() {
          throw new Error(
            "PDF render without an explicit Python entrypoint must not execute sandbox code."
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-render-pdf-build-script",
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
        sourceUserMessageId: "msg-render-pdf-build-script",
        sourceUserMessageText: "Render the report PDF",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "unsupported_render_source");
    assert.match(result.payload.warning ?? "", /format=pdf.*HTML entrypoint/i);
  });

  test("document.render rejects paths outside the active document project", async () => {
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [{ type: "file", path: "/workspace/test_pdf_project/report.html" }]
          };
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
        id: "tool-render-outside-project",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/test_pdf_project",
          outputPath: "/workspace/test_pdf_project/test.pdf",
          format: "pdf"
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      activeDocumentProjectPath: "/workspace/projects/karnaukh-report",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-render-outside-project",
        sourceUserMessageText: "Render the report",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.match(result.payload.warning ?? "", /active document project from document.extract/i);
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
    const result = await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "presentation",
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

    await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "presentation",
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

    await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "presentation",
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

  test("legacy worker-era descriptor modes normalize through register_version", async () => {
    const service = new RuntimeDocumentToolService({
      async registerDocumentVersion(input: { descriptorMode?: string | null; outputPath: string }) {
        return {
          accepted: true as const,
          docId: "doc-visible-legacy",
          versionId: "version-visible-legacy",
          versionNumber: 1,
          descriptorMode:
            input.descriptorMode === "revise_document" ? "revise_document" : "create_document",
          documentType: "workspace_document" as const,
          outputFormat: input.outputPath.endsWith(".pdf")
            ? ("pdf" as const)
            : input.outputPath.endsWith(".docx")
              ? ("docx" as const)
              : ("xlsx" as const),
          outputPath: input.outputPath,
          workspaceProjectPath: "/workspace/report",
          sourceManifestPath: null,
          inspectionPath: null
        };
      }
    } as never);

    const retiredCases: ReadonlyArray<{
      descriptorMode: "create_pdf_document" | "create_data_document";
      outputPath: string;
    }> = [
      { descriptorMode: "create_pdf_document", outputPath: "/workspace/report/report.pdf" },
      { descriptorMode: "create_pdf_document", outputPath: "/workspace/report/report.xlsx" },
      { descriptorMode: "create_data_document", outputPath: "/workspace/report/report.xlsx" },
      { descriptorMode: "create_data_document", outputPath: "/workspace/report/report.docx" }
    ];

    for (const args of retiredCases) {
      const result = await service.executeToolCall({
        bundle: createBundle(),
        toolCall: {
          id: `tool-retired-${args.descriptorMode}`,
          name: "document",
          arguments: {
            action: "register_version",
            descriptorMode: args.descriptorMode,
            outputPath: args.outputPath
          }
        },
        conversation: {
          channel: "web",
          externalThreadKey: "chat:web:legacy"
        },
        deferToAsyncDocumentJob: {
          sourceUserMessageId: "msg-retired",
          sourceUserMessageText: "register legacy visible output",
          sourceUserMessageCreatedAt: "2026-06-30T20:00:00.000Z",
          currentAttachments: [],
          availableAttachments: []
        }
      });

      assert.equal(result.isError, false);
      assert.equal(result.payload.action, "registered");
      assert.equal(result.payload.descriptorMode, "create_document");
      assert.equal(result.payload.documentType, "workspace_document");
    }
  });

  test("rejects create_presentation on the document tool", async () => {
    const service = new RuntimeDocumentToolService({} as never);
    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-presentation-on-document",
        name: "document",
        arguments: {
          descriptorMode: "create_presentation",
          prompt: "Create a deck"
        }
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-split",
        sourceUserMessageText: "Сделай презентацию",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "invalid_arguments");
    assert.match(result.payload.warning ?? "", /presentation tool/i);
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
    const result = await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-1",
        name: "presentation",
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

    const result = await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-default-pdf",
        name: "presentation",
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

    const result = await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-pptx-1",
        name: "presentation",
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

    await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-target-1",
        name: "presentation",
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

    await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-target-2",
        name: "presentation",
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

    await service.executePresentationToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-target-3",
        name: "presentation",
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
