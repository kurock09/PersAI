import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DocumentWorkspaceExtractionService } from "../src/modules/workspace-management/application/document-workspace-extraction.service";

describe("DocumentWorkspaceExtractionService", () => {
  const sessionRoot = "/workspace/assistants/assistant-1/sessions/chat-1";
  const sourcePdfPath = `${sessionRoot}/source.pdf`;
  const sourceDocxPath = `${sessionRoot}/source.docx`;
  const revenueXlsxPath = `${sessionRoot}/revenue.xlsx`;
  const genericXlsxPath = `${sessionRoot}/generic.xlsx`;
  const contractsRoot = `${sessionRoot}/contracts`;
  const sourceProjectRoot = `${sessionRoot}/projects/source`;
  const revenueProjectRoot = `${sessionRoot}/projects/revenue`;
  const genericProjectRoot = `${sessionRoot}/projects/generic`;

  test("extracts a PDF into visible sidecars under the default output dir", async () => {
    const savedObjects = new Map<string, Buffer>();
    const metadataUpserts: Array<{ path: string; mimeType: string; sizeBytes: number | bigint }> =
      [];
    const pushCalls: Array<{ path?: string | null; storagePath?: string | null }> = [];
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path !== sourcePdfPath) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: sourcePdfPath,
            mimeType: "application/pdf",
            sizeBytes: BigInt(32),
            contentHash: null,
            shortDescription: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        },
        async list() {
          return [];
        },
        async delete() {
          return;
        },
        async upsert(input: { path: string; mimeType: string; sizeBytes: number | bigint }) {
          metadataUpserts.push(input);
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject() {
          return {
            buffer: Buffer.from("%PDF-1.4 fake pdf", "utf8"),
            contentType: "application/pdf"
          };
        },
        async saveObject(input: { objectKey: string; buffer: Buffer }) {
          savedObjects.set(input.objectKey, input.buffer);
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: "application/octet-stream"
          };
        },
        async deletePrefix() {
          return;
        }
      } as never,
      {
        async extract() {
          return {
            normalizedText: "Extracted body text",
            markdown: "# Extracted\n\nExtracted body text",
            provider: {
              providerKey: "local" as const,
              processorMode: "local" as const,
              attemptedProviderKeys: ["local" as const]
            },
            quality: {
              status: "ok" as const,
              score: 0.8,
              reasonCodes: [],
              textChars: 19
            }
          };
        }
      } as never,
      {
        async pushWorkspaceFileBytes(input: { path?: string | null; storagePath?: string | null }) {
          pushCalls.push(input);
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: sourcePdfPath,
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.projectPath, sourceProjectRoot);
    assert.equal(outcome.outputDir, `${sourceProjectRoot}/extract`);
    assert.equal(outcome.projectManifestPath, `${sourceProjectRoot}/project.json`);
    assert.equal(outcome.projectSourcePath, `${sourceProjectRoot}/source/source.pdf`);
    assert.equal(outcome.defaultRenderEntrypoint, `${sourceProjectRoot}/render/report.html`);
    assert.equal(outcome.defaultPdfOutputPath, `${sourceProjectRoot}/output/report.pdf`);
    assert.ok(outcome.outputPaths.includes(`${sourceProjectRoot}/extract/extracted.md`));
    assert.ok(outcome.outputPaths.includes(`${sourceProjectRoot}/extract/manifest.json`));
    assert.ok(outcome.outputPaths.includes(`${sourceProjectRoot}/project.json`));
    assert.ok(outcome.outputPaths.includes(`${sourceProjectRoot}/source/source.pdf`));
    assert.ok(outcome.outputPaths.includes(`${sourceProjectRoot}/render/report.html`));
    assert.equal(metadataUpserts.length, 5);
    assert.deepEqual(
      metadataUpserts.map((entry) => entry.path),
      [
        `${sourceProjectRoot}/extract/extracted.md`,
        `${sourceProjectRoot}/extract/manifest.json`,
        `${sourceProjectRoot}/project.json`,
        `${sourceProjectRoot}/source/source.pdf`,
        `${sourceProjectRoot}/render/report.html`
      ]
    );
    const projectManifestBuffer = savedObjects.get(
      "gcs:assistants/assistant-1/sessions/chat-1/projects/source/project.json"
    );
    assert.ok(projectManifestBuffer);
    const projectManifest = JSON.parse(projectManifestBuffer!.toString("utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(projectManifest.schema, "persai.document.project.v1");
    assert.equal(projectManifest.projectPath, sourceProjectRoot);
    assert.equal(projectManifest.sourceKind, "imported_workspace_file");
    assert.equal(projectManifest.sourcePath, sourcePdfPath);
    assert.equal(projectManifest.projectSourcePath, `${sourceProjectRoot}/source/source.pdf`);
    assert.equal(projectManifest.sourceFormat, "pdf");
    assert.equal(projectManifest.sourceMimeType, "application/pdf");
    const manifestBuffer = savedObjects.get(
      "gcs:assistants/assistant-1/sessions/chat-1/projects/source/extract/manifest.json"
    );
    assert.ok(manifestBuffer);
    const manifest = JSON.parse(manifestBuffer!.toString("utf8")) as Record<string, unknown>;
    assert.equal(manifest.kind, "extraction_view");
    assert.equal(manifest.sourcePath, sourcePdfPath);
    assert.equal(manifest.projectPath, sourceProjectRoot);
    assert.equal(manifest.sourceFormat, "pdf");
    assert.equal(manifest.sourceMimeType, "application/pdf");
    assert.equal(manifest.outputDir, `${sourceProjectRoot}/extract`);
    assert.equal(outcome.suggestedNextActions, null);
  });

  test("extracts an xlsx workbook into summary plus per-sheet csv sidecars", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Month", "Revenue"],
        ["Jan", 100],
        ["Feb", 150]
      ]),
      "Revenue"
    );
    const workbookBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const savedKeys: string[] = [];
    const savedObjects = new Map<string, Buffer>();
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path !== revenueXlsxPath) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: revenueXlsxPath,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: BigInt(workbookBuffer.length),
            contentHash: null,
            shortDescription: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        },
        async list() {
          return [];
        },
        async delete() {
          return;
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject() {
          return {
            buffer: workbookBuffer,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          };
        },
        async saveObject(input: { objectKey: string; buffer: Buffer }) {
          savedKeys.push(input.objectKey);
          savedObjects.set(input.objectKey, input.buffer);
          return {
            objectKey: input.objectKey,
            sizeBytes: 1,
            mimeType: "application/octet-stream"
          };
        },
        async deletePrefix() {
          return;
        }
      } as never,
      {
        async extract() {
          throw new Error("spreadsheet path should not call shared document extraction");
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: revenueXlsxPath,
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.projectPath, revenueProjectRoot);
    assert.equal(outcome.projectSourcePath, `${revenueProjectRoot}/source/revenue.xlsx`);
    assert.equal(outcome.defaultRenderEntrypoint, `${revenueProjectRoot}/render/build.py`);
    assert.equal(outcome.counts.sheetCount, 1);
    assert.ok(outcome.outputPaths.includes(`${revenueProjectRoot}/extract/extracted.md`));
    assert.ok(outcome.outputPaths.includes(`${revenueProjectRoot}/extract/sheets/01-Revenue.csv`));
    assert.ok(outcome.outputPaths.includes(`${revenueProjectRoot}/source/revenue.xlsx`));
    assert.ok(
      savedKeys.includes(
        "gcs:assistants/assistant-1/sessions/chat-1/projects/revenue/extract/manifest.json"
      )
    );
    assert.ok(!outcome.outputPaths.includes(`${revenueProjectRoot}/render/build.py`));
    assert.ok(!outcome.outputPaths.includes(`${revenueProjectRoot}/render/export_pdf.py`));
    assert.ok(
      !savedKeys.includes(
        "gcs:assistants/assistant-1/sessions/chat-1/projects/revenue/render/build.py"
      )
    );
    assert.ok(
      !savedKeys.includes(
        "gcs:assistants/assistant-1/sessions/chat-1/projects/revenue/render/export_pdf.py"
      )
    );
    assert.ok(Array.isArray(outcome.suggestedNextActions));
    assert.equal(outcome.suggestedNextActions?.length, 1);
    assert.deepEqual(outcome.suggestedNextActions?.[0]?.args, {
      action: "render",
      projectPath: revenueProjectRoot,
      outputPath: `${revenueProjectRoot}/output/report.pdf`,
      format: "pdf"
    });
    assert.match(
      outcome.suggestedNextActions?.[0]?.reason ?? "",
      /Convert the imported XLSX to PDF/i
    );
  });

  test("infers spreadsheet extraction when stored mime type is generic", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["A"], [1]]), "Sheet1");
    const workbookBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    let sharedExtractionCalled = false;

    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path !== genericXlsxPath) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: genericXlsxPath,
            mimeType: "application/octet-stream",
            sizeBytes: BigInt(workbookBuffer.length),
            contentHash: null,
            shortDescription: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        },
        async list() {
          return [];
        },
        async delete() {
          return;
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject() {
          return {
            buffer: workbookBuffer,
            contentType: "application/octet-stream"
          };
        },
        async saveObject() {
          return {
            objectKey: "gcs:any",
            sizeBytes: 1,
            mimeType: "application/octet-stream"
          };
        },
        async deletePrefix() {
          return;
        }
      } as never,
      {
        async extract() {
          sharedExtractionCalled = true;
          throw new Error("generic xlsx should route to spreadsheet extraction");
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: genericXlsxPath,
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    assert.equal(sharedExtractionCalled, false);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.counts.sheetCount, 1);
    assert.ok(outcome.outputPaths.includes(`${genericProjectRoot}/extract/sheets/01-Sheet1.csv`));
  });

  test("rejects legacy outputDir on extract", async () => {
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path === sourcePdfPath) {
            return {
              workspaceId: "workspace-1",
              path: sourcePdfPath,
              mimeType: "application/pdf",
              sizeBytes: BigInt(32),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        async list() {
          return [];
        },
        async delete() {
          return;
        },
        async upsert() {
          return;
        }
      } as never,
      {} as never,
      {} as never,
      {} as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: sourcePdfPath,
      mode: "auto",
      outputDir: sourcePdfPath
    });

    assert.equal(outcome.accepted, false);
    if (outcome.accepted) {
      return;
    }
    assert.equal(outcome.code, "legacy_output_dir_rejected");
  });

  test("rejects legacy outputDir even when the directory is empty", async () => {
    let downloaded = false;
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path !== sourcePdfPath) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: sourcePdfPath,
            mimeType: "application/pdf",
            sizeBytes: BigInt(32),
            contentHash: null,
            shortDescription: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        },
        async list() {
          return [];
        },
        async upsert() {
          return;
        }
      } as never,
      {
        async downloadObject() {
          downloaded = true;
          return null;
        }
      } as never,
      {} as never,
      {} as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: sourcePdfPath,
      mode: "auto",
      outputDir: `${sessionRoot}/source.extract`
    });

    assert.equal(outcome.accepted, false);
    assert.equal(downloaded, false);
    if (outcome.accepted) {
      return;
    }
    assert.equal(outcome.code, "legacy_output_dir_rejected");
  });

  test("extracts a docx into a native visible build scaffold", async () => {
    const savedObjects = new Map<string, Buffer>();
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path !== sourceDocxPath) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: sourceDocxPath,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: BigInt(64),
            contentHash: null,
            shortDescription: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        },
        async list() {
          return [];
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject() {
          return {
            buffer: Buffer.from("fake docx bytes", "utf8"),
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          };
        },
        async saveObject(input: { objectKey: string; buffer: Buffer }) {
          savedObjects.set(input.objectKey, input.buffer);
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: "application/octet-stream"
          };
        }
      } as never,
      {
        async extract() {
          return {
            normalizedText: "Visible DOCX text",
            markdown: "# DOCX\n\nVisible DOCX text",
            provider: {
              providerKey: "local" as const,
              processorMode: "local" as const,
              attemptedProviderKeys: ["local" as const]
            },
            quality: {
              status: "ok" as const,
              score: 0.9,
              reasonCodes: [],
              textChars: 17
            }
          };
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: sourceDocxPath,
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.projectPath, sourceProjectRoot);
    assert.equal(outcome.projectSourcePath, `${sourceProjectRoot}/source/source.docx`);
    assert.equal(outcome.defaultRenderEntrypoint, `${sourceProjectRoot}/render/build.py`);
    assert.ok(!outcome.outputPaths.includes(`${sourceProjectRoot}/render/build.py`));
    assert.ok(!outcome.outputPaths.includes(`${sourceProjectRoot}/render/export_pdf.py`));
    assert.ok(!outcome.outputPaths.includes(`${sourceProjectRoot}/render/report.html`));

    const projectManifestBuffer = savedObjects.get(
      "gcs:assistants/assistant-1/sessions/chat-1/projects/source/project.json"
    );
    assert.ok(projectManifestBuffer);
    const projectManifest = JSON.parse(projectManifestBuffer!.toString("utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(projectManifest.defaultRenderEntrypoint, `${sourceProjectRoot}/render/build.py`);
    assert.equal(
      projectManifest.defaultPdfExportEntrypoint,
      `${sourceProjectRoot}/render/export_pdf.py`
    );
    assert.equal(
      savedObjects.has(
        "gcs:assistants/assistant-1/sessions/chat-1/projects/source/render/build.py"
      ),
      false
    );
    assert.equal(
      savedObjects.has(
        "gcs:assistants/assistant-1/sessions/chat-1/projects/source/render/export_pdf.py"
      ),
      false
    );
    assert.ok(Array.isArray(outcome.suggestedNextActions));
    assert.equal(outcome.suggestedNextActions?.length, 1);
    assert.deepEqual(outcome.suggestedNextActions?.[0]?.args, {
      action: "render",
      projectPath: sourceProjectRoot,
      outputPath: `${sourceProjectRoot}/output/report.pdf`,
      format: "pdf"
    });
    assert.match(
      outcome.suggestedNextActions?.[0]?.reason ?? "",
      /Convert the imported DOCX to PDF/i
    );
  });

  test("layout extraction falls back to text mode with a warning instead of surfacing an error", async () => {
    const requestedModes: Array<string | undefined> = [];
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path !== sourcePdfPath) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: sourcePdfPath,
            mimeType: "application/pdf",
            sizeBytes: BigInt(64),
            contentHash: null,
            shortDescription: null,
            createdAt: new Date("2026-07-01T12:00:00.000Z"),
            updatedAt: new Date("2026-07-01T12:00:00.000Z")
          };
        },
        async list() {
          return [];
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject() {
          return {
            buffer: Buffer.from("%PDF-1.4 fallback case", "utf8"),
            contentType: "application/pdf"
          };
        },
        async saveObject() {
          return {
            objectKey: "gcs:any",
            sizeBytes: 1,
            mimeType: "application/pdf"
          };
        }
      } as never,
      {
        async extract(input: { requestedMode?: string }) {
          requestedModes.push(input.requestedMode);
          if (input.requestedMode === "high_quality_fallback") {
            throw new Error("LlamaParse job did not complete in time (last status: RUNNING).");
          }
          return {
            normalizedText: "Plain text fallback content",
            markdown: null,
            provider: {
              providerKey: "local" as const,
              processorMode: "local" as const,
              attemptedProviderKeys: ["local" as const]
            },
            quality: {
              status: "ok" as const,
              score: 0.7,
              reasonCodes: [],
              textChars: 27
            }
          };
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: sourcePdfPath,
      mode: "layout",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    assert.deepEqual(requestedModes, ["high_quality_fallback", "local"]);
    if (!outcome.accepted) {
      return;
    }
    assert.match(outcome.warnings.join("\n"), /fell back to text mode/i);
    assert.ok(outcome.outputPaths.includes(`${sourceProjectRoot}/extract/extracted.md`));
  });

  test("resolves a requested older numbered sibling to the newest version deterministically", async () => {
    const downloadedKeys: string[] = [];
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path === `${contractsRoot}/brief (5).docx`) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sizeBytes: BigInt(50),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date("2026-06-29T10:00:00.000Z"),
              updatedAt: new Date("2026-06-29T10:00:00.000Z")
            };
          }
          if (input.path === `${contractsRoot}/brief (6).docx`) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sizeBytes: BigInt(60),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date("2026-06-30T10:00:00.000Z"),
              updatedAt: new Date("2026-06-30T10:00:00.000Z")
            };
          }
          return null;
        },
        async list(input: { pathPrefix?: string }) {
          if (input.pathPrefix === `${contractsRoot}/`) {
            return [
              {
                workspaceId: "workspace-1",
                path: `${contractsRoot}/brief (5).docx`,
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                sizeBytes: BigInt(50),
                contentHash: null,
                shortDescription: null,
                originChatId: null,
                originAssistantId: null,
                createdAt: new Date("2026-06-29T10:00:00.000Z"),
                updatedAt: new Date("2026-06-29T10:00:00.000Z")
              },
              {
                workspaceId: "workspace-1",
                path: `${contractsRoot}/brief (6).docx`,
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                sizeBytes: BigInt(60),
                contentHash: null,
                shortDescription: null,
                originChatId: null,
                originAssistantId: null,
                createdAt: new Date("2026-06-30T10:00:00.000Z"),
                updatedAt: new Date("2026-06-30T10:00:00.000Z")
              }
            ];
          }
          return [];
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          const key = `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
          downloadedKeys.push(key);
          return key;
        },
        async downloadObject() {
          return {
            buffer: Buffer.from("fake docx bytes", "utf8"),
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          };
        },
        async saveObject() {
          return {
            objectKey: "gcs:any",
            sizeBytes: 1,
            mimeType: "application/octet-stream"
          };
        }
      } as never,
      {
        async extract() {
          return {
            normalizedText: "Visible DOCX text",
            markdown: "# DOCX\n\nVisible DOCX text",
            provider: {
              providerKey: "local" as const,
              processorMode: "local" as const,
              attemptedProviderKeys: ["local" as const]
            },
            quality: {
              status: "ok" as const,
              score: 0.9,
              reasonCodes: [],
              textChars: 17
            }
          };
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: `${contractsRoot}/brief (5).docx`,
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.sourcePath, `${contractsRoot}/brief (6).docx`);
    assert.ok(
      downloadedKeys.includes("gcs:assistants/assistant-1/sessions/chat-1/contracts/brief (6).docx")
    );
    assert.match(outcome.warnings.join("\n"), /resolved to the newest sibling version/i);
  });

  test("reuses the existing document project for the same source instead of allocating a suffixed path", async () => {
    const savedObjects = new Map<string, Buffer>();
    const sourceBytes = Buffer.from("fake docx bytes", "utf8");
    const existingProjectManifest = {
      schema: "persai.document.project.v1",
      projectPath: sourceProjectRoot,
      sourceKind: "imported_workspace_file",
      sourcePath: sourceDocxPath,
      projectSourcePath: `${sourceProjectRoot}/source/source.docx`,
      sourceFormat: "docx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractManifestPath: `${sourceProjectRoot}/extract/manifest.json`,
      defaultRenderEntrypoint: `${sourceProjectRoot}/render/build.py`,
      defaultPdfExportEntrypoint: `${sourceProjectRoot}/render/export_pdf.py`
    };
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path === sourceDocxPath || input.path === `${sourceProjectRoot}/project.json`) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType:
                input.path === sourceDocxPath
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : "application/json",
              sizeBytes: BigInt(sourceBytes.length),
              contentHash: input.path === sourceDocxPath ? "hash-source-docx" : null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        async list(input: { pathPrefix?: string }) {
          if (input.pathPrefix === `${sourceProjectRoot}/`) {
            return [
              {
                workspaceId: "workspace-1",
                path: `${sourceProjectRoot}/project.json`,
                mimeType: "application/json",
                sizeBytes: BigInt(128),
                contentHash: null,
                shortDescription: null,
                originChatId: null,
                originAssistantId: null,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            ];
          }
          return [];
        },
        async upsert() {
          return;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject(objectKey: string) {
          if (
            objectKey === "gcs:assistants/assistant-1/sessions/chat-1/projects/source/project.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(existingProjectManifest, null, 2), "utf8"),
              contentType: "application/json"
            };
          }
          return {
            buffer: sourceBytes,
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          };
        },
        async saveObject(input: { objectKey: string; buffer: Buffer }) {
          savedObjects.set(input.objectKey, input.buffer);
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: "application/octet-stream"
          };
        }
      } as never,
      {
        async extract() {
          return {
            normalizedText: "Visible DOCX text",
            markdown: "# DOCX\n\nVisible DOCX text",
            provider: {
              providerKey: "local" as const,
              processorMode: "local" as const,
              attemptedProviderKeys: ["local" as const]
            },
            quality: {
              status: "ok" as const,
              score: 0.9,
              reasonCodes: [],
              textChars: 17
            }
          };
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const first = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: sourceDocxPath,
      mode: "auto",
      outputDir: null
    });
    const second = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: sourceDocxPath,
      mode: "auto",
      outputDir: null
    });

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, true);
    if (!first.accepted || !second.accepted) {
      return;
    }
    assert.equal(first.projectPath, sourceProjectRoot);
    assert.equal(second.projectPath, sourceProjectRoot);
    assert.equal(second.projectManifestPath, `${sourceProjectRoot}/project.json`);
    assert.ok(
      savedObjects.has("gcs:assistants/assistant-1/sessions/chat-1/projects/source/project.json")
    );
  });
});
