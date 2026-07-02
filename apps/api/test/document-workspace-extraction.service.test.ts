import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DocumentWorkspaceExtractionService } from "../src/modules/workspace-management/application/document-workspace-extraction.service";

describe("DocumentWorkspaceExtractionService", () => {
  test("extracts a PDF into visible sidecars under the default output dir", async () => {
    const savedObjects = new Map<string, Buffer>();
    const metadataUpserts: Array<{ path: string; mimeType: string; sizeBytes: number | bigint }> =
      [];
    const pushCalls: Array<{ path?: string | null; storagePath?: string | null }> = [];
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path !== "/workspace/source.pdf") {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: "/workspace/source.pdf",
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
      path: "/workspace/source.pdf",
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.projectPath, "/workspace/projects/source");
    assert.equal(outcome.outputDir, "/workspace/projects/source/extract");
    assert.equal(outcome.projectManifestPath, "/workspace/projects/source/project.json");
    assert.equal(outcome.projectSourcePath, "/workspace/projects/source/source/source.pdf");
    assert.equal(outcome.defaultRenderEntrypoint, "/workspace/projects/source/render/report.html");
    assert.equal(outcome.defaultPdfOutputPath, "/workspace/projects/source/output/report.pdf");
    assert.ok(outcome.outputPaths.includes("/workspace/projects/source/extract/extracted.md"));
    assert.ok(outcome.outputPaths.includes("/workspace/projects/source/extract/manifest.json"));
    assert.ok(outcome.outputPaths.includes("/workspace/projects/source/project.json"));
    assert.ok(outcome.outputPaths.includes("/workspace/projects/source/source/source.pdf"));
    assert.ok(outcome.outputPaths.includes("/workspace/projects/source/render/report.html"));
    assert.equal(metadataUpserts.length, 5);
    assert.deepEqual(
      metadataUpserts.map((entry) => entry.path),
      [
        "/workspace/projects/source/extract/extracted.md",
        "/workspace/projects/source/extract/manifest.json",
        "/workspace/projects/source/project.json",
        "/workspace/projects/source/source/source.pdf",
        "/workspace/projects/source/render/report.html"
      ]
    );
    const projectManifestBuffer = savedObjects.get("gcs:projects/source/project.json");
    assert.ok(projectManifestBuffer);
    const projectManifest = JSON.parse(projectManifestBuffer!.toString("utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(projectManifest.schema, "persai.document.project.v1");
    assert.equal(projectManifest.projectPath, "/workspace/projects/source");
    assert.equal(projectManifest.sourceKind, "imported_workspace_file");
    assert.equal(projectManifest.sourcePath, "/workspace/source.pdf");
    assert.equal(projectManifest.projectSourcePath, "/workspace/projects/source/source/source.pdf");
    assert.equal(projectManifest.sourceFormat, "pdf");
    assert.equal(projectManifest.sourceMimeType, "application/pdf");
    const manifestBuffer = savedObjects.get("gcs:projects/source/extract/manifest.json");
    assert.ok(manifestBuffer);
    const manifest = JSON.parse(manifestBuffer!.toString("utf8")) as Record<string, unknown>;
    assert.equal(manifest.kind, "extraction_view");
    assert.equal(manifest.sourcePath, "/workspace/source.pdf");
    assert.equal(manifest.projectPath, "/workspace/projects/source");
    assert.equal(manifest.sourceFormat, "pdf");
    assert.equal(manifest.sourceMimeType, "application/pdf");
    assert.equal(manifest.outputDir, "/workspace/projects/source/extract");
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
          if (input.path !== "/workspace/revenue.xlsx") {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: "/workspace/revenue.xlsx",
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
      path: "/workspace/revenue.xlsx",
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.projectPath, "/workspace/projects/revenue");
    assert.equal(outcome.projectSourcePath, "/workspace/projects/revenue/source/revenue.xlsx");
    assert.equal(outcome.defaultRenderEntrypoint, "/workspace/projects/revenue/render/build.py");
    assert.equal(outcome.counts.sheetCount, 1);
    assert.ok(outcome.outputPaths.includes("/workspace/projects/revenue/extract/extracted.md"));
    assert.ok(
      outcome.outputPaths.includes("/workspace/projects/revenue/extract/sheets/01-Revenue.csv")
    );
    assert.ok(outcome.outputPaths.includes("/workspace/projects/revenue/source/revenue.xlsx"));
    assert.ok(savedKeys.includes("gcs:projects/revenue/extract/manifest.json"));
    assert.ok(!outcome.outputPaths.includes("/workspace/projects/revenue/render/build.py"));
    assert.ok(!outcome.outputPaths.includes("/workspace/projects/revenue/render/export_pdf.py"));
    assert.ok(!savedKeys.includes("gcs:projects/revenue/render/build.py"));
    assert.ok(!savedKeys.includes("gcs:projects/revenue/render/export_pdf.py"));
    assert.ok(Array.isArray(outcome.suggestedNextActions));
    assert.equal(outcome.suggestedNextActions?.length, 1);
    assert.deepEqual(outcome.suggestedNextActions?.[0]?.args, {
      action: "render",
      projectPath: "/workspace/projects/revenue",
      outputPath: "/workspace/projects/revenue/output/report.pdf",
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
          if (input.path !== "/workspace/generic.xlsx") {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: "/workspace/generic.xlsx",
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
      path: "/workspace/generic.xlsx",
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    assert.equal(sharedExtractionCalled, false);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.counts.sheetCount, 1);
    assert.ok(
      outcome.outputPaths.includes("/workspace/projects/generic/extract/sheets/01-Sheet1.csv")
    );
  });

  test("rejects legacy outputDir on extract", async () => {
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path === "/workspace/source.pdf") {
            return {
              workspaceId: "workspace-1",
              path: "/workspace/source.pdf",
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
      path: "/workspace/source.pdf",
      mode: "auto",
      outputDir: "/workspace/source.pdf"
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
          if (input.path !== "/workspace/source.pdf") {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: "/workspace/source.pdf",
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
      path: "/workspace/source.pdf",
      mode: "auto",
      outputDir: "/workspace/source.extract"
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
          if (input.path !== "/workspace/source.docx") {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: "/workspace/source.docx",
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
      path: "/workspace/source.docx",
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.projectPath, "/workspace/projects/source");
    assert.equal(outcome.projectSourcePath, "/workspace/projects/source/source/source.docx");
    assert.equal(outcome.defaultRenderEntrypoint, "/workspace/projects/source/render/build.py");
    assert.ok(!outcome.outputPaths.includes("/workspace/projects/source/render/build.py"));
    assert.ok(!outcome.outputPaths.includes("/workspace/projects/source/render/export_pdf.py"));
    assert.ok(!outcome.outputPaths.includes("/workspace/projects/source/render/report.html"));

    const projectManifestBuffer = savedObjects.get("gcs:projects/source/project.json");
    assert.ok(projectManifestBuffer);
    const projectManifest = JSON.parse(projectManifestBuffer!.toString("utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(
      projectManifest.defaultRenderEntrypoint,
      "/workspace/projects/source/render/build.py"
    );
    assert.equal(
      projectManifest.defaultPdfExportEntrypoint,
      "/workspace/projects/source/render/export_pdf.py"
    );
    assert.equal(savedObjects.has("gcs:projects/source/render/build.py"), false);
    assert.equal(savedObjects.has("gcs:projects/source/render/export_pdf.py"), false);
    assert.ok(Array.isArray(outcome.suggestedNextActions));
    assert.equal(outcome.suggestedNextActions?.length, 1);
    assert.deepEqual(outcome.suggestedNextActions?.[0]?.args, {
      action: "render",
      projectPath: "/workspace/projects/source",
      outputPath: "/workspace/projects/source/output/report.pdf",
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
          if (input.path !== "/workspace/source.pdf") {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: "/workspace/source.pdf",
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
      path: "/workspace/source.pdf",
      mode: "layout",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    assert.deepEqual(requestedModes, ["high_quality_fallback", "local"]);
    if (!outcome.accepted) {
      return;
    }
    assert.match(outcome.warnings.join("\n"), /fell back to text mode/i);
    assert.ok(outcome.outputPaths.includes("/workspace/projects/source/extract/extracted.md"));
  });

  test("resolves a requested older numbered sibling to the newest version deterministically", async () => {
    const downloadedKeys: string[] = [];
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (input.path === "/workspace/contracts/brief (5).docx") {
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
          if (input.path === "/workspace/contracts/brief (6).docx") {
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
          if (input.pathPrefix === "/workspace/contracts/") {
            return [
              {
                workspaceId: "workspace-1",
                path: "/workspace/contracts/brief (5).docx",
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
                path: "/workspace/contracts/brief (6).docx",
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
      path: "/workspace/contracts/brief (5).docx",
      mode: "auto",
      outputDir: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.sourcePath, "/workspace/contracts/brief (6).docx");
    assert.ok(downloadedKeys.includes("gcs:contracts/brief (6).docx"));
    assert.match(outcome.warnings.join("\n"), /resolved to the newest sibling version/i);
  });

  test("reuses the existing document project for the same source instead of allocating a suffixed path", async () => {
    const savedObjects = new Map<string, Buffer>();
    const sourceBytes = Buffer.from("fake docx bytes", "utf8");
    const existingProjectManifest = {
      schema: "persai.document.project.v1",
      projectPath: "/workspace/projects/source",
      sourceKind: "imported_workspace_file",
      sourcePath: "/workspace/source.docx",
      projectSourcePath: "/workspace/projects/source/source/source.docx",
      sourceFormat: "docx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractManifestPath: "/workspace/projects/source/extract/manifest.json",
      defaultRenderEntrypoint: "/workspace/projects/source/render/build.py",
      defaultPdfExportEntrypoint: "/workspace/projects/source/render/export_pdf.py"
    };
    const service = new DocumentWorkspaceExtractionService(
      {
        async get(input: { path: string }) {
          if (
            input.path === "/workspace/source.docx" ||
            input.path === "/workspace/projects/source/project.json"
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType:
                input.path === "/workspace/source.docx"
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : "application/json",
              sizeBytes: BigInt(sourceBytes.length),
              contentHash: input.path === "/workspace/source.docx" ? "hash-source-docx" : null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        },
        async list(input: { pathPrefix?: string }) {
          if (input.pathPrefix === "/workspace/projects/source/") {
            return [
              {
                workspaceId: "workspace-1",
                path: "/workspace/projects/source/project.json",
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
          if (objectKey === "gcs:projects/source/project.json") {
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
      path: "/workspace/source.docx",
      mode: "auto",
      outputDir: null
    });
    const second = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: "/workspace/source.docx",
      mode: "auto",
      outputDir: null
    });

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, true);
    if (!first.accepted || !second.accepted) {
      return;
    }
    assert.equal(first.projectPath, "/workspace/projects/source");
    assert.equal(second.projectPath, "/workspace/projects/source");
    assert.equal(second.projectManifestPath, "/workspace/projects/source/project.json");
    assert.ok(savedObjects.has("gcs:projects/source/project.json"));
  });
});
