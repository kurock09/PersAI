import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DocumentWorkspaceInspectionService } from "../src/modules/workspace-management/application/document-workspace-inspection.service";

describe("DocumentWorkspaceInspectionService", () => {
  const sessionRoot = "/workspace/assistants/assistant-1/sessions/chat-1";
  const revenueProjectRoot = `${sessionRoot}/projects/revenue`;
  const briefProjectRoot = `${sessionRoot}/projects/brief`;

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
          if (input.path !== `${sessionRoot}/revenue.xlsx`) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: `${sessionRoot}/revenue.xlsx`,
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
      path: `${sessionRoot}/revenue.xlsx`,
      depth: "standard",
      outputPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.inspectPath, `${sessionRoot}/revenue.inspect.json`);
    assert.equal(outcome.format, "xlsx");
    assert.equal(outcome.counts.sheetCount, 2);
    assert.equal(outcome.counts.formulaCount, 1);
    assert.equal(outcome.counts.blankSheetCount, 1);
    assert.deepEqual(
      metadataUpserts.map((entry) => entry.path),
      [`${sessionRoot}/revenue.inspect.json`]
    );
    assert.deepEqual(
      pushCalls.map((entry) => entry.path),
      [`${sessionRoot}/revenue.inspect.json`]
    );
    const inspectBuffer = savedObjects.get(
      "gcs:assistants/assistant-1/sessions/chat-1/revenue.inspect.json"
    );
    assert.ok(inspectBuffer);
    const inspectJson = JSON.parse(inspectBuffer!.toString("utf8")) as Record<string, unknown>;
    assert.equal(inspectJson.schema, "persai.document.inspect.v1");
    assert.equal(inspectJson.format, "xlsx");
  });

  test("compares imported xlsx output against projectSourcePath and records structural degradation", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const sourceWorkbook = XLSX.utils.book_new();
    const sourceRevenue = XLSX.utils.aoa_to_sheet([
      ["Month", "Revenue"],
      ["Jan", 100],
      ["Feb", 150],
      ["Total", 250]
    ]);
    sourceRevenue.B4 = { t: "n", v: 250, f: "SUM(B2:B3)" };
    XLSX.utils.book_append_sheet(sourceWorkbook, sourceRevenue, "Revenue");
    const sourceSummary = XLSX.utils.aoa_to_sheet([
      ["Metric", "Value"],
      ["Growth", 0.2]
    ]);
    sourceSummary.B2 = { t: "n", v: 0.2, f: "B2" };
    XLSX.utils.book_append_sheet(sourceWorkbook, sourceSummary, "Summary");
    const sourceBuffer = XLSX.write(sourceWorkbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const outputWorkbook = XLSX.utils.book_new();
    const outputRevenue = XLSX.utils.aoa_to_sheet([
      ["Month", "Revenue"],
      ["Jan", 100],
      ["Feb", 150],
      ["Total", 250]
    ]);
    outputRevenue.B4 = { t: "n", v: 250, f: "SUM(B2:B3)" };
    XLSX.utils.book_append_sheet(outputWorkbook, outputRevenue, "Revenue");
    const outputBuffer = XLSX.write(outputWorkbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const projectManifest = {
      schema: "persai.document.project.v1",
      sourceKind: "imported_workspace_file",
      sourceFormat: "xlsx",
      projectSourcePath: `${revenueProjectRoot}/source/revenue.xlsx`
    };

    const savedObjects = new Map<string, Buffer>();
    const service = new DocumentWorkspaceInspectionService(
      {
        async get(input: { path: string }) {
          if (
            input.path === `${revenueProjectRoot}/output/revenue.xlsx` ||
            input.path === `${revenueProjectRoot}/project.json` ||
            input.path === `${revenueProjectRoot}/source/revenue.xlsx`
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: input.path.endsWith(".json")
                ? "application/json"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              sizeBytes: BigInt(128),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
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
            objectKey ===
            "gcs:assistants/assistant-1/sessions/chat-1/projects/revenue/output/revenue.xlsx"
          ) {
            return {
              buffer: outputBuffer,
              contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            };
          }
          if (
            objectKey === "gcs:assistants/assistant-1/sessions/chat-1/projects/revenue/project.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(projectManifest), "utf8"),
              contentType: "application/json"
            };
          }
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/chat-1/projects/revenue/source/revenue.xlsx"
          ) {
            return {
              buffer: sourceBuffer,
              contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            };
          }
          return null;
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
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: `${revenueProjectRoot}/output/revenue.xlsx`,
      depth: "standard",
      outputPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.comparison?.sourceFormat, "xlsx");
    assert.match(outcome.comparison?.summary ?? "", /structurally degraded/i);
    assert.ok(
      outcome.warnings.some((warning) => warning.includes("missing source sheets")),
      "inspect should surface comparison-derived XLSX warnings"
    );
    const inspectBuffer = savedObjects.get(
      "gcs:assistants/assistant-1/sessions/chat-1/projects/revenue/output/revenue.inspect.json"
    );
    assert.ok(inspectBuffer);
    const inspectJson = JSON.parse(inspectBuffer!.toString("utf8")) as {
      details?: {
        comparison?: {
          missingSheetNames?: string[];
          sourceCounts?: { sheetCount?: number; formulaCount?: number };
          outputCounts?: { sheetCount?: number; formulaCount?: number };
        };
      };
    };
    assert.deepEqual(inspectJson.details?.comparison?.missingSheetNames, ["Summary"]);
    assert.equal(inspectJson.details?.comparison?.sourceCounts?.sheetCount, 2);
    assert.equal(inspectJson.details?.comparison?.outputCounts?.sheetCount, 1);
  });

  test("compares imported docx output against projectSourcePath and records structural degradation", async () => {
    const sourceBuffer = await createDocxBuffer({
      headings: ["Quarterly Brief"],
      paragraphs: ["Opening summary", "Detailed paragraph"],
      tableRows: [
        ["Metric", "Value"],
        ["Revenue", "100"]
      ]
    });
    const outputBuffer = await createDocxBuffer({
      headings: [],
      paragraphs: ["Opening summary"],
      tableRows: []
    });
    const projectManifest = {
      schema: "persai.document.project.v1",
      sourceKind: "imported_workspace_file",
      sourceFormat: "docx",
      projectSourcePath: `${briefProjectRoot}/source/brief.docx`
    };
    const savedObjects = new Map<string, Buffer>();
    const service = new DocumentWorkspaceInspectionService(
      {
        async get(input: { path: string }) {
          if (
            input.path === `${briefProjectRoot}/output/brief.docx` ||
            input.path === `${briefProjectRoot}/project.json` ||
            input.path === `${briefProjectRoot}/source/brief.docx`
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: input.path.endsWith(".json")
                ? "application/json"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sizeBytes: BigInt(128),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
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
            objectKey ===
            "gcs:assistants/assistant-1/sessions/chat-1/projects/brief/output/brief.docx"
          ) {
            return {
              buffer: outputBuffer,
              contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            };
          }
          if (
            objectKey === "gcs:assistants/assistant-1/sessions/chat-1/projects/brief/project.json"
          ) {
            return {
              buffer: Buffer.from(JSON.stringify(projectManifest), "utf8"),
              contentType: "application/json"
            };
          }
          if (
            objectKey ===
            "gcs:assistants/assistant-1/sessions/chat-1/projects/brief/source/brief.docx"
          ) {
            return {
              buffer: sourceBuffer,
              contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            };
          }
          return null;
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
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: `${briefProjectRoot}/output/brief.docx`,
      depth: "standard",
      outputPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.comparison?.sourceFormat, "docx");
    assert.match(outcome.comparison?.summary ?? "", /structurally degraded/i);
    assert.ok(
      outcome.warnings.some((warning) => warning.includes("fewer headings")),
      "inspect should surface comparison-derived DOCX warnings"
    );
    const inspectBuffer = savedObjects.get(
      "gcs:assistants/assistant-1/sessions/chat-1/projects/brief/output/brief.inspect.json"
    );
    assert.ok(inspectBuffer);
    const inspectJson = JSON.parse(inspectBuffer!.toString("utf8")) as {
      details?: {
        comparison?: {
          sourceCounts?: { headingCount?: number; paragraphCount?: number; tableCount?: number };
          outputCounts?: { headingCount?: number; paragraphCount?: number; tableCount?: number };
        };
      };
    };
    assert.equal(inspectJson.details?.comparison?.sourceCounts?.headingCount, 1);
    assert.equal(inspectJson.details?.comparison?.outputCounts?.headingCount, 0);
    assert.equal(inspectJson.details?.comparison?.sourceCounts?.tableCount, 1);
    assert.equal(inspectJson.details?.comparison?.outputCounts?.tableCount, 0);
  });

  test("accepts a minimally valid-looking PDF, persists the sidecar, and warns when parsing fails", async () => {
    const pdfBuffer = Buffer.from("%PDF-1.4\nfake pdf bytes", "utf8");
    const service = new DocumentWorkspaceInspectionService(
      {
        async get(input: { path: string }) {
          if (input.path !== `${sessionRoot}/output.pdf`) {
            return null;
          }
          return {
            workspaceId: "workspace-1",
            path: `${sessionRoot}/output.pdf`,
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
            objectKey: "gcs:assistants/assistant-1/sessions/chat-1/output.inspect.json",
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
      path: `${sessionRoot}/output.pdf`,
      depth: "quick",
      outputPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.format, "pdf");
    assert.equal(outcome.inspectPath, `${sessionRoot}/output.inspect.json`);
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
      path: `${sessionRoot}/output.pdf`,
      depth: "standard",
      outputPath: `${sessionRoot}/output.pdf`
    });

    assert.equal(outcome.accepted, false);
    if (outcome.accepted) {
      return;
    }
    assert.equal(outcome.code, "invalid_output_path");
  });
});

async function createDocxBuffer(input: {
  headings: string[];
  paragraphs: string[];
  tableRows: string[][];
}): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require("jszip") as typeof import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder("word")!.file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`
  );
  zip
    .folder("word")!
    .folder("_rels")!
    .file(
      "document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );
  const headingXml = input.headings
    .map(
      (heading) =>
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(heading)}</w:t></w:r></w:p>`
    )
    .join("");
  const paragraphXml = input.paragraphs
    .map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`)
    .join("");
  const tableXml =
    input.tableRows.length === 0
      ? ""
      : `<w:tbl>${input.tableRows
          .map(
            (row) =>
              `<w:tr>${row
                .map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`)
                .join("")}</w:tr>`
          )
          .join("")}</w:tbl>`;
  zip.folder("word")!.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${headingXml}${paragraphXml}${tableXml}<w:sectPr/></w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
