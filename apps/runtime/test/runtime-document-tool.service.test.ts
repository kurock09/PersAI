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

function createWrittenWorkspaceFileJob(path: string, sizeBytes: number) {
  return {
    status: "completed" as const,
    exitCode: 0,
    reason: null,
    warning: null,
    violationMessage: null,
    stderr: null,
    content: JSON.stringify({
      sizeBytes,
      resolvedPath: path
    }),
    files: []
  };
}

function resolveWritePathJobIfRequested(input: {
  toolCode: string;
  args: Record<string, unknown>;
}) {
  if (input.toolCode !== "files" || input.args.action !== "resolve_write_path") {
    return null;
  }
  return createResolvedWritePathJob(String(input.args.path ?? ""));
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
          warnings: [],
          suggestedNextActions: [
            {
              tool: "document" as const,
              action: "render" as const,
              args: {
                action: "render" as const,
                projectPath: "/workspace/projects/source",
                outputPath: "/workspace/projects/source/output/report.pdf",
                format: "pdf" as const
              },
              reason:
                "Convert the imported DOCX to PDF by calling document.render directly. Do not read the source content chunk by chunk or run a shell conversion; call this action directly."
            }
          ]
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
    assert.deepEqual(result.payload.extraction?.suggestedNextActions, [
      {
        tool: "document",
        action: "render",
        args: {
          action: "render",
          projectPath: "/workspace/projects/source",
          outputPath: "/workspace/projects/source/output/report.pdf",
          format: "pdf"
        },
        reason:
          "Convert the imported DOCX to PDF by calling document.render directly. Do not read the source content chunk by chunk or run a shell conversion; call this action directly."
      }
    ]);
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
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
            const resolvedWritePath = resolveWritePathJobIfRequested(input);
            if (resolvedWritePath !== null) {
              return resolvedWritePath;
            }
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
            const resolvedWritePath = resolveWritePathJobIfRequested(input);
            if (resolvedWritePath !== null) {
              return resolvedWritePath;
            }
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
      assert.match(programSource, /os\.environ\['PERSAI_OUTPUT_PATH'\] = output_path/);
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
          }
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
    assert.match(result.payload.warning ?? "", /document\.render\(format=pdf\)/);
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
          }
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
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
    assert.equal(sandboxCalls[1]?.args.action, "resolve_write_path");
    assert.equal(sandboxCalls[1]?.args.path, "/workspace/report/report.pdf");
    assert.equal(sandboxCalls[2]?.toolCode, "files");
    assert.equal(sandboxCalls[2]?.args.path, "/workspace/report/report.html");
    assert.equal(sandboxCalls[3]?.toolCode, "execute_document_code");
    assert.match(
      String(sandboxCalls[3]?.args.programSource ?? ""),
      /HTML\(string=html_source, base_url=project_dir\)/
    );
    assert.match(
      String(sandboxCalls[3]?.args.programSource ?? ""),
      /<html><body><h1>Report<\/h1><\/body><\/html>/
    );
    assert.doesNotMatch(
      String(sandboxCalls[3]?.args.programSource ?? ""),
      /HTML\(filename=entrypoint_path/
    );
    assert.equal(sandboxCalls[4]?.toolCode, "files");
  });

  test("scaffolds authored content/template into visible render sources and delivers once", async () => {
    for (const scenario of [
      {
        format: "pdf" as const,
        outputPath: "/workspace/projects/authored/output/report.pdf",
        entrypointPath: "/workspace/projects/authored/render/build.py",
        mimeType: "application/pdf",
        inspectPath: "/workspace/projects/authored/output/report.inspect.json"
      },
      {
        format: "docx" as const,
        outputPath: "/workspace/projects/authored/output/report.docx",
        entrypointPath: "/workspace/projects/authored/render/build.py",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        inspectPath: "/workspace/projects/authored/output/report.inspect.json"
      }
    ]) {
      const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
      const writtenFiles = new Map<string, string>();
      const registerCalls: Array<{ outputPath: string; workspaceProjectPath: string }> = [];
      const inspectCalls: Array<{ path: string }> = [];
      const service = new RuntimeDocumentToolService(
        {
          async upsertWorkspaceFileMetadata() {
            return;
          },
          async inspectDocumentInWorkspace(input: { path: string }) {
            inspectCalls.push({ path: input.path });
            return {
              accepted: true as const,
              sourcePath: input.path,
              inspectPath: scenario.inspectPath,
              format: scenario.format,
              counts: {
                pageCount: scenario.format === "pdf" ? 1 : null,
                sheetCount: null,
                formulaCount: null,
                blankSheetCount: null,
                paragraphCount: scenario.format === "docx" ? 4 : null,
                headingCount: scenario.format === "docx" ? 1 : null,
                tableCount: null,
                textCharCount: 48
              },
              warnings: [],
              suggestedReadPaths: [],
              comparison: null
            };
          },
          async registerDocumentVersion(input: {
            outputPath: string;
            workspaceProjectPath: string;
          }) {
            registerCalls.push({
              outputPath: input.outputPath,
              workspaceProjectPath: input.workspaceProjectPath
            });
            return {
              accepted: true as const,
              docId: `doc-authored-${scenario.format}`,
              versionId: `version-authored-${scenario.format}`,
              versionNumber: 1,
              descriptorMode: "create_document" as const,
              documentType: "workspace_document" as const,
              outputFormat: scenario.format,
              outputPath: input.outputPath,
              workspaceProjectPath: input.workspaceProjectPath,
              sourceManifestPath: null,
              inspectionPath: scenario.inspectPath
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
              return createResolvedWritePathJob(scenario.outputPath);
            }
            if (input.toolCode === "files" && input.args.action === "write") {
              const path = String(input.args.path ?? "");
              const content = String(input.args.content ?? "");
              writtenFiles.set(path, content);
              return createWrittenWorkspaceFileJob(path, Buffer.byteLength(content, "utf8"));
            }
            if (input.toolCode === "files" && input.args.action === "read") {
              const path = String(input.args.path ?? "");
              const content =
                writtenFiles.get(path) ??
                (path.endsWith("/project.json")
                  ? null
                  : (() => {
                      throw new Error(`Unexpected read path: ${path}`);
                    })());
              return {
                status: "completed",
                exitCode: 0,
                reason: null,
                warning: null,
                violationMessage: null,
                stderr: null,
                content:
                  content === null
                    ? JSON.stringify({
                        content: null,
                        sizeBytes: null,
                        sha256: null,
                        truncated: false
                      })
                    : JSON.stringify({
                        content,
                        sizeBytes: Buffer.byteLength(content, "utf8"),
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
                files: [
                  {
                    relativePath: scenario.outputPath.replace("/workspace/", ""),
                    displayName: scenario.outputPath.split("/").pop() ?? null,
                    mimeType: scenario.mimeType,
                    sizeBytes: 2048,
                    logicalSizeBytes: 2048,
                    storagePath: `sandbox/job/${scenario.format}`
                  }
                ]
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
          id: `tool-authored-${scenario.format}`,
          name: "document",
          arguments: {
            action: "render",
            projectPath: "/workspace/projects/authored",
            outputPath: scenario.outputPath,
            format: scenario.format,
            entrypoint: "ignored-by-runtime.html",
            content: "# Overview\n\n- First point\n- Second point",
            template: {
              title: "Quarterly Summary",
              theme: "report",
              pageSize: "Letter",
              runningHeader: "Q2 2026",
              runningFooter: "Internal draft"
            }
          }
        },
        sessionId: `session-authored-${scenario.format}`,
        requestId: `request-authored-${scenario.format}`,
        conversation: {
          channel: "web",
          externalThreadKey: `chat:web:authored:${scenario.format}`
        },
        deferToAsyncDocumentJob: {
          sourceUserMessageId: `msg-authored-${scenario.format}`,
          sourceUserMessageText: "Render the authored report",
          sourceUserMessageCreatedAt: "2026-07-01T19:30:00.000Z",
          currentAttachments: [],
          availableAttachments: []
        }
      });

      assert.equal(result.isError, false);
      assert.equal(result.payload.action, "rendered");
      assert.equal(result.payload.render?.entrypointPath, scenario.entrypointPath);
      assert.equal(result.payload.render?.outputPath, scenario.outputPath);
      assert.equal(registerCalls.length, 1);
      assert.equal(registerCalls[0]?.outputPath, scenario.outputPath);
      assert.equal(registerCalls[0]?.workspaceProjectPath, "/workspace/projects/authored");
      assert.equal(inspectCalls.length, 1);
      assert.equal(inspectCalls[0]?.path, scenario.outputPath);
      assert.equal(
        sandboxCalls.filter((call) => call.toolCode === "files" && call.args.action === "attach")
          .length,
        1
      );
      // The runtime scaffolds exactly three visible sources (project.json, content.md,
      // build.py). It must NOT pre-write report.html/index.html with a JS engine — those
      // visible HTML sources are produced by the single seeded Python `markdown` engine
      // inside build.py at render time.
      assert.equal(
        sandboxCalls.filter((call) => call.toolCode === "files" && call.args.action === "write")
          .length,
        3
      );
      assert.equal(
        writtenFiles.has("/workspace/projects/authored/project.json"),
        true,
        "fresh authored render should scaffold a project manifest"
      );
      assert.equal(
        writtenFiles.has("/workspace/projects/authored/render/content.md"),
        true,
        "fresh authored render should scaffold visible markdown source"
      );
      assert.equal(
        writtenFiles.has("/workspace/projects/authored/render/build.py"),
        true,
        "fresh authored render should scaffold visible build.py"
      );
      assert.equal(
        writtenFiles.has("/workspace/projects/authored/render/report.html"),
        false,
        "runtime must not pre-write report.html with a JS engine"
      );
      assert.equal(
        writtenFiles.has("/workspace/projects/authored/render/index.html"),
        false,
        "runtime must not pre-write index.html with a JS engine"
      );
      // content.md carries the raw authored Markdown verbatim (bound later by Python).
      assert.match(
        writtenFiles.get("/workspace/projects/authored/render/content.md") ?? "",
        /- First point/
      );
      // build.py is the single Markdown engine (Python `markdown`) for BOTH formats and
      // produces the visible report.html/index.html plus the requested deliverable.
      const authoredBuildPy =
        writtenFiles.get("/workspace/projects/authored/render/build.py") ?? "";
      assert.match(authoredBuildPy, /import markdown/);
      assert.match(authoredBuildPy, /extensions=\['extra', 'sane_lists', 'nl2br', 'tables'\]/);
      assert.match(authoredBuildPy, /REPORT_HTML_PATH\.write_text/);
      assert.match(authoredBuildPy, /INDEX_HTML_PATH\.write_text/);
      assert.match(authoredBuildPy, /Quarterly Summary/);
      assert.match(authoredBuildPy, new RegExp(`RENDER_FORMAT = "${scenario.format}"`));
      if (scenario.format === "pdf") {
        assert.match(authoredBuildPy, /from weasyprint import HTML/);
        assert.match(authoredBuildPy, /HTML\(filename=str\(REPORT_HTML_PATH\)\)\.write_pdf/);
      } else {
        assert.match(authoredBuildPy, /from bs4 import BeautifulSoup/);
        assert.match(authoredBuildPy, /document\.save\(str\(OUTPUT_PATH\)\)/);
      }
      assert.ok(
        !sandboxCalls.some(
          (call) =>
            call.toolCode === "files" &&
            call.args.action === "read" &&
            call.args.path === "/workspace/projects/authored/ignored-by-runtime.html"
        ),
        "authored content render must ignore model-provided entrypoint"
      );
    }
  });

  test("imported Office PDF render ignores authored content/template inputs", async () => {
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
                { type: "file", path: "/workspace/projects/report/render/export_pdf.py" }
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
            const resolvedWritePath = resolveWritePathJobIfRequested(input);
            if (resolvedWritePath !== null) {
              return resolvedWritePath;
            }
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
                  content: "print('office export')\n",
                  sizeBytes: 24,
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
          id: `tool-imported-ignore-${scenario.sourceFormat}`,
          name: "document",
          arguments: {
            action: "render",
            projectPath: "/workspace/projects/report",
            outputPath: "/workspace/projects/report/output/report.pdf",
            format: "pdf",
            content: "# Should be ignored",
            template: { title: "Ignore me", theme: "minimal" }
          }
        },
        sessionId: `session-imported-ignore-${scenario.sourceFormat}`,
        requestId: `request-imported-ignore-${scenario.sourceFormat}`,
        deferToAsyncDocumentJob: {
          sourceUserMessageId: `msg-imported-ignore-${scenario.sourceFormat}`,
          sourceUserMessageText: "Render the imported document as PDF",
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
      assert.equal(
        sandboxCalls.filter((call) => call.toolCode === "files" && call.args.action === "write")
          .length,
        0
      );
    }
  });

  test("omitting authored content keeps the legacy entrypoint render path unchanged", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              {
                path: "/workspace/report/render/report.html",
                type: "file" as const,
                sizeBytes: 120,
                mimeType: "text/html",
                modifiedAt: "2026-07-01T12:00:00.000Z"
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
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
                content: "<html><body><h1>Legacy Report</h1></body></html>",
                sizeBytes: 48,
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
                  workspaceRelPath: "/workspace/report/output/report.pdf",
                  sourcePath: "/workspace/report/output/report.pdf",
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
        id: "tool-legacy-render",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/report",
          outputPath: "/workspace/report/output/report.pdf",
          format: "pdf",
          entrypoint: "render/report.html",
          template: { title: "Ignored without content" }
        }
      },
      sessionId: "session-legacy-render",
      requestId: "request-legacy-render",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-legacy-render",
        sourceUserMessageText: "Render the legacy report",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.render?.entrypointPath, "/workspace/report/render/report.html");
    assert.equal(
      sandboxCalls.filter((call) => call.toolCode === "files" && call.args.action === "write")
        .length,
      0
    );
    assert.equal(
      sandboxCalls.filter(
        (call) =>
          call.toolCode === "files" &&
          call.args.action === "read" &&
          call.args.path === "/workspace/report/render/report.html"
      ).length,
      1
    );
  });

  test("auto-registers a document version after successful render when conversation is present", async () => {
    const registerCalls: Array<{
      workspaceProjectPath: string;
      outputPath: string;
      channel: string;
      inspectionPath: string | null;
    }> = [];
    const inspectCalls: Array<{ path: string }> = [];
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
        async inspectDocumentInWorkspace(input: { path: string }) {
          inspectCalls.push({ path: input.path });
          return {
            accepted: true as const,
            sourcePath: input.path,
            inspectPath: "/workspace/projects/auto-register/output/report.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: null,
              headingCount: null,
              tableCount: null,
              textCharCount: null
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion(input: {
          channel: string;
          workspaceProjectPath: string;
          outputPath: string;
          inspectionPath: string | null;
        }) {
          registerCalls.push({
            channel: input.channel,
            workspaceProjectPath: input.workspaceProjectPath,
            outputPath: input.outputPath,
            inspectionPath: input.inspectionPath ?? null
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
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
    assert.equal(inspectCalls.length, 1);
    assert.equal(inspectCalls[0]?.path, "/workspace/projects/auto-register/output/report.pdf");
    assert.equal(
      registerCalls[0]?.inspectionPath,
      "/workspace/projects/auto-register/output/report.inspect.json"
    );
  });

  test("document.render collision defaults to sibling path and auto-registers the resolved output", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const registerCalls: Array<{ outputPath: string }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              {
                path: "/workspace/projects/collision/render/report.html",
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
        async registerDocumentVersion(input: { outputPath: string }) {
          registerCalls.push({ outputPath: input.outputPath });
          return {
            accepted: true as const,
            docId: "doc-collision-1",
            versionId: "version-collision-1",
            versionNumber: 1,
            descriptorMode: "create_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: input.outputPath,
            workspaceProjectPath: "/workspace/projects/collision",
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
          sandboxCalls.push(input);
          if (input.toolCode === "files" && input.args.action === "resolve_write_path") {
            return createResolvedWritePathJob(
              "/workspace/projects/collision/output/report (1).pdf"
            );
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
              files: [
                {
                  relativePath: "output/report (1).pdf",
                  displayName: "report (1).pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 2048,
                  logicalSizeBytes: 2048,
                  storagePath: "sandbox/job/report (1).pdf"
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
                  workspaceRelPath: "/workspace/projects/collision/output/report (1).pdf",
                  sourcePath: "/workspace/projects/collision/output/report (1).pdf",
                  sizeBytes: 2048,
                  mimeType: "application/pdf",
                  displayName: "report (1).pdf"
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
        id: "tool-auto-register-collision",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/projects/collision",
          outputPath: "/workspace/projects/collision/output/report.pdf",
          format: "pdf",
          entrypoint: "render/report.html"
        }
      },
      sessionId: "session-collision-1",
      requestId: "request-collision-1",
      conversation: {
        channel: "web",
        externalThreadKey: "chat:web:collision"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-collision-1",
        sourceUserMessageText: "Render this report",
        sourceUserMessageCreatedAt: "2026-06-30T12:00:00.000Z",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(
      result.payload.render?.outputPath,
      "/workspace/projects/collision/output/report (1).pdf"
    );
    assert.equal(result.payload.requestedName, "report (1).pdf");
    assert.equal(
      result.payload.registration?.outputPath,
      "/workspace/projects/collision/output/report (1).pdf"
    );
    assert.equal(
      registerCalls[0]?.outputPath,
      "/workspace/projects/collision/output/report (1).pdf"
    );
    const renderJob = sandboxCalls.find((call) => call.toolCode === "execute_document_code");
    assert.equal(renderJob?.args.outputFileName, "projects/collision/output/report (1).pdf");
  });

  test("document.render replace=true keeps the exact output path and auto-registers there", async () => {
    const resolveCalls: Array<Record<string, unknown>> = [];
    const registerCalls: Array<{ outputPath: string }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              {
                path: "/workspace/projects/replace/render/report.html",
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
        async registerDocumentVersion(input: { outputPath: string }) {
          registerCalls.push({ outputPath: input.outputPath });
          return {
            accepted: true as const,
            docId: "doc-replace-1",
            versionId: "version-replace-1",
            versionNumber: 1,
            descriptorMode: "create_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: input.outputPath,
            workspaceProjectPath: "/workspace/projects/replace",
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
          if (input.toolCode === "files" && input.args.action === "resolve_write_path") {
            resolveCalls.push(input.args);
            return createResolvedWritePathJob("/workspace/projects/replace/output/report.pdf");
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
                  workspaceRelPath: "/workspace/projects/replace/output/report.pdf",
                  sourcePath: "/workspace/projects/replace/output/report.pdf",
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
        id: "tool-auto-register-replace",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/projects/replace",
          outputPath: "/workspace/projects/replace/output/report.pdf",
          format: "pdf",
          entrypoint: "render/report.html",
          replace: true
        }
      },
      sessionId: "session-replace-1",
      requestId: "request-replace-1",
      conversation: {
        channel: "web",
        externalThreadKey: "chat:web:replace"
      },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-replace-1",
        sourceUserMessageText: "Replace this report",
        sourceUserMessageCreatedAt: "2026-06-30T12:00:00.000Z",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(
      result.payload.render?.outputPath,
      "/workspace/projects/replace/output/report.pdf"
    );
    assert.equal(registerCalls[0]?.outputPath, "/workspace/projects/replace/output/report.pdf");
    assert.deepEqual(resolveCalls[0], {
      action: "resolve_write_path",
      path: "/workspace/projects/replace/output/report.pdf",
      replace: true
    });
  });

  test("relocates an escaped render output path into the project output directory", async () => {
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return {
            items: [
              {
                path: "/workspace/price-list/index.html",
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
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          sandboxCalls.push(input);
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
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
          if (input.toolCode === "files" && input.args.action === "read") {
            const path = String(input.args.path ?? "");
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content: path.endsWith("project.json")
                  ? ""
                  : "<html><body><h1>Prices</h1></body></html>",
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
                  workspaceRelPath: "/workspace/price-list/output/price-list.pdf",
                  sourcePath: "/workspace/price-list/output/price-list.pdf",
                  sizeBytes: 2048,
                  mimeType: "application/pdf",
                  displayName: "price-list.pdf"
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
        id: "tool-relocate-1",
        name: "document",
        arguments: {
          action: "render",
          projectPath: "/workspace/price-list",
          outputPath: "/workspace/price-list.pdf",
          format: "pdf",
          entrypoint: "index.html"
        }
      },
      sessionId: "session-relocate-1",
      requestId: "request-relocate-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-relocate-1",
        sourceUserMessageText: "Render the price list",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.render?.outputPath, "/workspace/price-list/output/price-list.pdf");
    const resolveCall = sandboxCalls.find(
      (call) => call.toolCode === "files" && call.args.action === "resolve_write_path"
    );
    assert.equal(resolveCall?.args.path, "/workspace/price-list/output/price-list.pdf");
    const renderJob = sandboxCalls.find((call) => call.toolCode === "execute_document_code");
    assert.equal(renderJob?.args.outputFileName, "price-list/output/price-list.pdf");
  });

  test("surfaces a registration rejection honestly instead of a clean delivered success", async () => {
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
        async inspectDocumentInWorkspace() {
          return {
            accepted: false as const,
            code: "unsupported_inspect_source",
            message: "Inspect could not read the rendered output."
          };
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
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
    assert.equal(result.payload.action, "skipped");
    assert.equal(result.payload.reason, "register_rejected:inspect_missing");
    assert.equal(result.payload.docId, null);
    assert.equal(result.payload.registration ?? null, null);
    assert.equal(result.payload.render ?? null, null);
    assert.match(result.payload.warning ?? "", /could not register\/deliver a document version/);
    assert.match(result.payload.warning ?? "", /inspect_rejected:unsupported_inspect_source/);
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
          const resolvedWritePath = resolveWritePathJobIfRequested(input);
          if (resolvedWritePath !== null) {
            return resolvedWritePath;
          }
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
    assert.equal(sandboxCalls[1]?.args.action, "resolve_write_path");
    assert.equal(sandboxCalls[1]?.args.path, "/workspace/model/output.xlsx");
    assert.equal(sandboxCalls[2]?.toolCode, "files");
    assert.equal(sandboxCalls[2]?.args.path, "/workspace/model/build.py");
    assert.equal(sandboxCalls[3]?.toolCode, "execute_document_code");
    assert.equal(sandboxCalls[3]?.args.outputFileName, "model/output.xlsx");
    assert.match(String(sandboxCalls[3]?.args.programSource ?? ""), /PERSAI_OUTPUT_PATH/);
    assert.equal(sandboxCalls[4]?.toolCode, "files");
    assert.equal(sandboxCalls[4]?.args.action, "attach");
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

  test("document.edit applies a replace over the full canonical content and preserves the rest", async () => {
    const projectPath = "/workspace/projects/report";
    const extractedPath = "/workspace/projects/report/extract/extracted.md";
    const originalContent =
      "# Quarterly Report\n\nAlpha beta gamma.\n\n## Details\n\nOld body here.\n\n## Notes\n\nKeep this intact.\n";
    const writtenFiles = new Map<string, string>();
    const sandboxCalls: Array<{ toolCode: string; args: Record<string, unknown> }> = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return { items: [{ type: "file", path: extractedPath }] };
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
          if (input.toolCode === "files" && input.args.action === "write") {
            const path = String(input.args.path ?? "");
            const content = String(input.args.content ?? "");
            writtenFiles.set(path, content);
            return createWrittenWorkspaceFileJob(path, Buffer.byteLength(content, "utf8"));
          }
          if (input.toolCode === "files" && input.args.action === "read") {
            const path = String(input.args.path ?? "");
            const content = writtenFiles.has(path)
              ? writtenFiles.get(path)!
              : path === extractedPath
                ? originalContent
                : null;
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content,
                sizeBytes: content === null ? null : Buffer.byteLength(content, "utf8"),
                sha256: null,
                truncated: false
              }),
              files: []
            };
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}:${String(input.args.action)}`
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-edit-replace",
        name: "document",
        arguments: {
          action: "edit",
          projectPath,
          edits: [{ op: "replace", find: "Old body here.", replaceWith: "New body here." }]
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-edit-replace",
        sourceUserMessageText: "Fix the details section",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "edited");
    assert.equal(result.payload.edit?.applied, true);
    assert.equal(result.payload.edit?.contentKind, "extracted");
    assert.equal(result.payload.edit?.contentPath, extractedPath);
    assert.equal(result.payload.edit?.opCount, 1);
    assert.equal(result.payload.edit?.results[0]?.status, "applied");
    assert.equal(result.payload.edit?.results[0]?.replacements, 1);
    const updated = writtenFiles.get(extractedPath) ?? "";
    assert.equal(updated, originalContent.replace("Old body here.", "New body here."));
    assert.match(updated, /## Notes\n\nKeep this intact\./);
    assert.equal(
      sandboxCalls.filter((call) => call.toolCode === "files" && call.args.action === "write")
        .length,
      1
    );
  });

  test("document.edit reports an honest per-op failure and writes nothing on zero/ambiguous match", async () => {
    const projectPath = "/workspace/projects/report";
    const extractedPath = "/workspace/projects/report/extract/extracted.md";
    const originalContent = "foo foo foo\n";
    const writeCalls: string[] = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return { items: [{ type: "file", path: extractedPath }] };
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
          if (input.toolCode === "files" && input.args.action === "write") {
            writeCalls.push(String(input.args.path ?? ""));
            return createWrittenWorkspaceFileJob(String(input.args.path ?? ""), 0);
          }
          if (input.toolCode === "files" && input.args.action === "read") {
            const path = String(input.args.path ?? "");
            const content = path === extractedPath ? originalContent : null;
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content,
                sizeBytes: content === null ? null : Buffer.byteLength(content, "utf8"),
                sha256: null,
                truncated: false
              }),
              files: []
            };
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}:${String(input.args.action)}`
          );
        }
      } as never
    );

    const ambiguous = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-edit-ambiguous",
        name: "document",
        arguments: {
          action: "edit",
          projectPath,
          edits: [{ op: "replace", find: "foo", replaceWith: "bar" }]
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-edit-ambiguous",
        sourceUserMessageText: "Replace foo",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(ambiguous.isError, true);
    assert.equal(ambiguous.payload.action, "skipped");
    assert.equal(ambiguous.payload.reason, "edit_op_failed");
    assert.equal(ambiguous.payload.edit?.applied, false);
    assert.equal(ambiguous.payload.edit?.results[0]?.status, "failed");
    assert.equal(ambiguous.payload.edit?.results[0]?.failureReason, "ambiguous_match");

    const zeroMatch = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-edit-zero",
        name: "document",
        arguments: {
          action: "edit",
          projectPath,
          edits: [{ op: "replace", find: "absent-passage", replaceWith: "x" }]
        }
      },
      sessionId: "session-1",
      requestId: "request-2",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-edit-zero",
        sourceUserMessageText: "Replace absent",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(zeroMatch.isError, true);
    assert.equal(zeroMatch.payload.action, "skipped");
    assert.equal(zeroMatch.payload.edit?.results[0]?.failureReason, "no_match");
    assert.equal(writeCalls.length, 0, "a failed all-or-nothing edit must write nothing");
  });

  test("document.edit section op replaces only the targeted section body", async () => {
    const projectPath = "/workspace/projects/report";
    const extractedPath = "/workspace/projects/report/extract/extracted.md";
    const originalContent =
      "# Doc\n\nIntro paragraph.\n\n## Alpha\n\nAlpha body original.\n\n## Beta\n\nBeta body original.\n\n### Beta Sub\n\nSub content.\n\n## Gamma\n\nGamma body.\n";
    const writtenFiles = new Map<string, string>();
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return { items: [{ type: "file", path: extractedPath }] };
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
          if (input.toolCode === "files" && input.args.action === "write") {
            const path = String(input.args.path ?? "");
            writtenFiles.set(path, String(input.args.content ?? ""));
            return createWrittenWorkspaceFileJob(path, 0);
          }
          if (input.toolCode === "files" && input.args.action === "read") {
            const path = String(input.args.path ?? "");
            const content = path === extractedPath ? originalContent : null;
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content,
                sizeBytes: content === null ? null : Buffer.byteLength(content, "utf8"),
                sha256: null,
                truncated: false
              }),
              files: []
            };
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}:${String(input.args.action)}`
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-edit-section",
        name: "document",
        arguments: {
          action: "edit",
          projectPath,
          edits: [{ op: "section", heading: "## Beta", content: "Beta body REPLACED." }]
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-edit-section",
        sourceUserMessageText: "Rewrite the Beta section",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.payload.action, "edited");
    assert.equal(result.payload.edit?.results[0]?.status, "applied");
    const updated = writtenFiles.get(extractedPath) ?? "";
    assert.match(updated, /## Alpha\n\nAlpha body original\.\n\n## Beta\n/);
    assert.match(updated, /Beta body REPLACED\./);
    assert.ok(!updated.includes("Beta body original."), "old Beta body must be gone");
    assert.ok(
      !updated.includes("### Beta Sub"),
      "the replaced section body includes its subsection"
    );
    assert.match(updated, /## Gamma\n\nGamma body\./);
  });

  test("document.edit with rerender chains into a single register + deliver door", async () => {
    const projectPath = "/workspace/projects/authored";
    const contentPath = "/workspace/projects/authored/render/content.md";
    const outputPath = "/workspace/projects/authored/output/report.pdf";
    const originalContent = "# Draft\n\n- one\n- two\n";
    const writtenFiles = new Map<string, string>();
    const registerCalls: Array<{ outputPath: string; workspaceProjectPath: string }> = [];
    const attachCalls: string[] = [];
    const service = new RuntimeDocumentToolService(
      {
        async listWorkspaceFilesFromManifest() {
          return { items: [{ type: "file", path: contentPath }] };
        },
        async upsertWorkspaceFileMetadata() {
          return;
        },
        async inspectDocumentInWorkspace(input: { path: string }) {
          return {
            accepted: true as const,
            sourcePath: input.path,
            inspectPath: "/workspace/projects/authored/output/report.inspect.json",
            format: "pdf" as const,
            counts: {
              pageCount: 1,
              sheetCount: null,
              formulaCount: null,
              blankSheetCount: null,
              paragraphCount: null,
              headingCount: null,
              tableCount: null,
              textCharCount: 24
            },
            warnings: [],
            suggestedReadPaths: [],
            comparison: null
          };
        },
        async registerDocumentVersion(input: { outputPath: string; workspaceProjectPath: string }) {
          registerCalls.push({
            outputPath: input.outputPath,
            workspaceProjectPath: input.workspaceProjectPath
          });
          return {
            accepted: true as const,
            docId: "doc-edit-rerender",
            versionId: "version-edit-rerender",
            versionNumber: 2,
            descriptorMode: "revise_document" as const,
            documentType: "workspace_document" as const,
            outputFormat: "pdf" as const,
            outputPath: input.outputPath,
            workspaceProjectPath: input.workspaceProjectPath,
            sourceManifestPath: null,
            inspectionPath: "/workspace/projects/authored/output/report.inspect.json"
          };
        }
      } as never,
      {
        isConfigured() {
          return true;
        },
        async waitForCompletion(input: { toolCode: string; args: Record<string, unknown> }) {
          const resolved = resolveWritePathJobIfRequested(input);
          if (resolved !== null) {
            return resolved;
          }
          if (input.toolCode === "files" && input.args.action === "write") {
            const path = String(input.args.path ?? "");
            const content = String(input.args.content ?? "");
            writtenFiles.set(path, content);
            return createWrittenWorkspaceFileJob(path, Buffer.byteLength(content, "utf8"));
          }
          if (input.toolCode === "files" && input.args.action === "read") {
            const path = String(input.args.path ?? "");
            const content = writtenFiles.has(path)
              ? writtenFiles.get(path)!
              : path === contentPath
                ? originalContent
                : null;
            return {
              status: "completed",
              exitCode: 0,
              reason: null,
              warning: null,
              violationMessage: null,
              stderr: null,
              content: JSON.stringify({
                content,
                sizeBytes: content === null ? null : Buffer.byteLength(content, "utf8"),
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
              files: [
                {
                  relativePath: outputPath.replace("/workspace/", ""),
                  displayName: "report.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 2048,
                  logicalSizeBytes: 2048,
                  storagePath: "sandbox/job/edit-rerender"
                }
              ]
            };
          }
          if (input.toolCode === "files" && input.args.action === "attach") {
            attachCalls.push(String(input.args.path ?? ""));
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
                  workspaceRelPath: outputPath,
                  sourcePath: outputPath,
                  sizeBytes: 2048,
                  mimeType: "application/pdf",
                  displayName: "report.pdf"
                }
              }),
              files: []
            };
          }
          throw new Error(
            `Unexpected sandbox call: ${input.toolCode}:${String(input.args.action)}`
          );
        }
      } as never
    );

    const result = await service.executeToolCall({
      bundle: createBundle(),
      toolCall: {
        id: "tool-edit-rerender",
        name: "document",
        arguments: {
          action: "edit",
          projectPath,
          edits: [{ op: "replace", find: "- one", replaceWith: "- uno" }],
          rerender: true,
          format: "pdf",
          outputPath
        }
      },
      sessionId: "session-1",
      requestId: "request-1",
      conversation: { channel: "web", externalThreadKey: "chat:web:edit-rerender" },
      deferToAsyncDocumentJob: {
        sourceUserMessageId: "msg-edit-rerender",
        sourceUserMessageText: "Fix the first bullet and re-render",
        sourceUserMessageCreatedAt: "2026-07-01T20:00:00.000Z",
        currentAttachments: [],
        availableAttachments: []
      }
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.action, "rendered");
    assert.equal(result.payload.requestedAction, "edit");
    assert.equal(result.payload.edit?.applied, true);
    assert.equal(result.payload.edit?.contentKind, "authored");
    assert.equal(result.payload.render?.outputPath, outputPath);
    assert.equal(registerCalls.length, 1, "rerender must register exactly once");
    assert.equal(registerCalls[0]?.workspaceProjectPath, projectPath);
    assert.equal(attachCalls.length, 1, "rerender must deliver exactly once");
    assert.match(writtenFiles.get(contentPath) ?? "", /- uno/);
  });
});

export async function runRuntimeDocumentToolServiceTest(): Promise<void> {
  // Tests are registered at module level via describe(); they run automatically in the child process.
}
