import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DocumentWorkspaceInspectionService } from "../src/modules/workspace-management/application/document-workspace-inspection.service";

describe("DocumentWorkspaceInspectionService", () => {
  const sessionRoot = "/workspace/assistants/assistant-1/sessions/runtime-session-1";

  function noopDocumentExtractionService() {
    return {
      async extract() {
        throw new Error("document extraction should not be called in this test");
      }
    } as never;
  }

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
      } as never,
      noopDocumentExtractionService()
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
    assert.equal(outcome.editMethod, "shell_native");
    assert.equal(outcome.siblingMarkdownPath, null);
    assert.equal(outcome.extractedMdPath, null);
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
      "gcs:assistants/assistant-1/sessions/runtime-session-1/revenue.inspect.json"
    );
    assert.ok(inspectBuffer);
    const inspectJson = JSON.parse(inspectBuffer!.toString("utf8")) as Record<string, unknown>;
    assert.equal(inspectJson.schema, "persai.document.inspect.v1");
    assert.equal(inspectJson.format, "xlsx");
  });

  test("returns render_from_markdown when a sibling markdown source exists", async () => {
    const docxBuffer = await createDocxBuffer({
      headings: ["Quarterly Brief"],
      paragraphs: ["Opening summary"],
      tableRows: []
    });
    const service = new DocumentWorkspaceInspectionService(
      {
        async get(input: { path: string }) {
          if (input.path === `${sessionRoot}/brief.docx`) {
            return {
              workspaceId: "workspace-1",
              path: `${sessionRoot}/brief.docx`,
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sizeBytes: BigInt(docxBuffer.length),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          if (input.path === `${sessionRoot}/brief.md`) {
            return {
              workspaceId: "workspace-1",
              path: `${sessionRoot}/brief.md`,
              mimeType: "text/markdown",
              sizeBytes: BigInt(32),
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
        async downloadObject() {
          return {
            buffer: docxBuffer,
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          };
        },
        async saveObject() {
          return {
            objectKey: "gcs:assistants/assistant-1/sessions/runtime-session-1/brief.inspect.json",
            sizeBytes: 1,
            mimeType: "application/json"
          };
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never,
      noopDocumentExtractionService()
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      path: `${sessionRoot}/brief.docx`,
      depth: "standard",
      outputPath: null
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.editMethod, "render_from_markdown");
    assert.equal(outcome.siblingMarkdownPath, `${sessionRoot}/brief.md`);
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
            objectKey: "gcs:assistants/assistant-1/sessions/runtime-session-1/output.inspect.json",
            sizeBytes: 1,
            mimeType: "application/json"
          };
        }
      } as never,
      {
        async pushWorkspaceFileBytes() {
          return { mode: "written" as const, reason: null };
        }
      } as never,
      noopDocumentExtractionService()
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
    const service = new DocumentWorkspaceInspectionService(
      {} as never,
      {} as never,
      {} as never,
      noopDocumentExtractionService()
    );

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
    const service = new DocumentWorkspaceInspectionService(
      {} as never,
      {} as never,
      {} as never,
      noopDocumentExtractionService()
    );

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
