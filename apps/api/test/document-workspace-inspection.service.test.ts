import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DocumentWorkspaceInspectionService } from "../src/modules/workspace-management/application/document-workspace-inspection.service";

describe("DocumentWorkspaceInspectionService", () => {
  test("inspects an xlsx workbook and persists a visible inspect sidecar", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.utils.book_new();
    const revenueSheet = XLSX.utils.aoa_to_sheet([
      ["Month", "Revenue"],
      ["Jan", 100],
      ["Feb", 150],
      ["Total", 250]
    ]);
    revenueSheet.B4 = { t: "n", v: 250, f: "SUM(B2:B3)" };
    XLSX.utils.book_append_sheet(workbook, revenueSheet, "Revenue");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Summary");
    const workbookBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const savedObjects = new Map<string, Buffer>();
    const metadataUpserts: Array<{ path: string; mimeType: string; sizeBytes: number | bigint }> =
      [];
    const pushCalls: Array<{ path?: string | null; storagePath?: string | null }> = [];
    const service = new DocumentWorkspaceInspectionService(
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
            buffer: workbookBuffer,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          };
        },
        async saveObject(input: { objectKey: string; buffer: Buffer }) {
          savedObjects.set(input.objectKey, input.buffer);
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: "application/json"
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
      path: "/workspace/revenue.xlsx",
      depth: "standard",
      outputPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.inspectPath, "/workspace/revenue.inspect.json");
    assert.equal(outcome.format, "xlsx");
    assert.equal(outcome.counts.sheetCount, 2);
    assert.equal(outcome.counts.formulaCount, 1);
    assert.equal(outcome.counts.blankSheetCount, 1);
    assert.deepEqual(
      metadataUpserts.map((entry) => entry.path),
      ["/workspace/revenue.inspect.json"]
    );
    assert.deepEqual(
      pushCalls.map((entry) => entry.path),
      ["/workspace/revenue.inspect.json"]
    );
    const inspectBuffer = savedObjects.get("gcs:revenue.inspect.json");
    assert.ok(inspectBuffer);
    const inspectJson = JSON.parse(inspectBuffer!.toString("utf8")) as Record<string, unknown>;
    assert.equal(inspectJson.schema, "persai.document.inspect.v1");
    assert.equal(inspectJson.format, "xlsx");
  });

  test("accepts a minimally valid-looking PDF, persists the sidecar, and warns when parsing fails", async () => {
    const pdfBuffer = Buffer.from("%PDF-1.4\nfake pdf bytes", "utf8");
    const service = new DocumentWorkspaceInspectionService(
      {
        async get(input: { path: string }) {
          if (input.path !== "/workspace/output.pdf") {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: "/workspace/output.pdf",
            mimeType: "application/pdf",
            sizeBytes: BigInt(pdfBuffer.length),
            contentHash: null,
            shortDescription: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
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
            buffer: pdfBuffer,
            contentType: "application/pdf"
          };
        },
        async saveObject() {
          return {
            objectKey: "gcs:output.inspect.json",
            sizeBytes: 1,
            mimeType: "application/json"
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
      path: "/workspace/output.pdf",
      depth: "quick",
      outputPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.format, "pdf");
    assert.equal(outcome.inspectPath, "/workspace/output.inspect.json");
    assert.ok(
      outcome.warnings.some((warning) => warning.includes("PDF text extraction failed")),
      "inspect should warn honestly when a fake PDF cannot be parsed"
    );
  });

  test("rejects inspect paths outside canonical workspace", async () => {
    const service = new DocumentWorkspaceInspectionService({} as never, {} as never, {} as never);

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: "/shared/output.pdf",
      depth: "standard",
      outputPath: null
    });

    assert.equal(outcome.accepted, false);
    if (outcome.accepted) {
      return;
    }
    assert.equal(outcome.code, "invalid_source_path");
  });

  test("rejects inspect outputPath that would overwrite the source document", async () => {
    const service = new DocumentWorkspaceInspectionService({} as never, {} as never, {} as never);

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: "/workspace/output.pdf",
      depth: "standard",
      outputPath: "/workspace/output.pdf"
    });

    assert.equal(outcome.accepted, false);
    if (outcome.accepted) {
      return;
    }
    assert.equal(outcome.code, "invalid_output_path");
  });
});
