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
    assert.equal(outcome.outputDir, "/workspace/source.extract");
    assert.deepEqual(outcome.outputPaths, [
      "/workspace/source.extract/extracted.md",
      "/workspace/source.extract/manifest.json"
    ]);
    assert.equal(metadataUpserts.length, 2);
    assert.deepEqual(
      metadataUpserts.map((entry) => entry.path),
      ["/workspace/source.extract/extracted.md", "/workspace/source.extract/manifest.json"]
    );
    assert.deepEqual(
      pushCalls.map((entry) => entry.path),
      ["/workspace/source.extract/extracted.md", "/workspace/source.extract/manifest.json"]
    );
    const manifestBuffer = savedObjects.get("gcs:source.extract/manifest.json");
    assert.ok(manifestBuffer);
    const manifest = JSON.parse(manifestBuffer!.toString("utf8")) as Record<string, unknown>;
    assert.equal(manifest.sourcePath, "/workspace/source.pdf");
    assert.equal(manifest.outputDir, "/workspace/source.extract");
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
        async saveObject(input: { objectKey: string }) {
          savedKeys.push(input.objectKey);
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
      outputDir: "/workspace/revenue.extract"
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.counts.sheetCount, 1);
    assert.ok(outcome.outputPaths.includes("/workspace/revenue.extract/extracted.md"));
    assert.ok(outcome.outputPaths.includes("/workspace/revenue.extract/sheets/01-Revenue.csv"));
    assert.ok(savedKeys.includes("gcs:revenue.extract/manifest.json"));
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
    assert.ok(outcome.outputPaths.includes("/workspace/generic.extract/sheets/01-Sheet1.csv"));
  });

  test("rejects outputDir that points at an existing file", async () => {
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
    assert.equal(outcome.code, "invalid_output_dir");
  });

  test("rejects outputDir that already contains sidecar files", async () => {
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
        async list(input: { pathPrefix: string }) {
          return input.pathPrefix === "/workspace/source.extract/"
            ? [
                {
                  workspaceId: "workspace-1",
                  path: "/workspace/source.extract/manifest.json",
                  mimeType: "application/json",
                  sizeBytes: BigInt(2),
                  contentHash: null,
                  shortDescription: null,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              ]
            : [];
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
    assert.equal(outcome.code, "output_dir_not_empty");
  });
});
