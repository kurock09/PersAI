import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildDocumentProjectPdfExportEntrypoint,
  buildDocumentProjectPythonRenderEntrypoint,
  buildImportedOfficePdfExportScaffold,
  buildImportedOfficeRenderScaffold,
  buildDocumentProjectRenderScaffoldHtml,
  buildDocumentWorkspaceProjectLayout,
  deriveDefaultDocumentProjectPath,
  validateDocumentProjectRenderPaths
} from "../src/index";

describe("document-workspace-project", () => {
  test("derives a stable default project path from the source filename", () => {
    const cyrillicProject = deriveDefaultDocumentProjectPath(
      "/workspace/Карнаух_Федор_Отчет (1).docx"
    );
    assert.match(cyrillicProject, /^\/workspace\/projects\/doc-[0-9a-f]{8}$/);
    assert.equal(
      deriveDefaultDocumentProjectPath("/workspace/source.pdf"),
      "/workspace/projects/source"
    );
  });

  test("validates render paths stay inside the active project layout", () => {
    const layout = buildDocumentWorkspaceProjectLayout("/workspace/projects/source");
    assert.equal(
      validateDocumentProjectRenderPaths({
        layout,
        projectPath: "/workspace/projects/source",
        outputPath: "/workspace/projects/source/output/report.pdf",
        entrypointPath: "/workspace/projects/source/render/report.html"
      }),
      null
    );
    assert.match(
      validateDocumentProjectRenderPaths({
        layout,
        projectPath: "/workspace/test_pdf_project",
        outputPath: "/workspace/test_pdf_project/test.pdf",
        entrypointPath: "/workspace/test_pdf_project/report.html"
      }) ?? "",
      /active document project/i
    );
  });

  test("builds render scaffold html from extracted text", () => {
    const html = buildDocumentProjectRenderScaffoldHtml({
      sourcePath: "/workspace/report.docx",
      extractedText: "Line one\n\nLine two"
    });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /Line one/);
    assert.match(html, /Line two/);
  });

  test("exposes stable in-memory Office entrypoint paths", () => {
    const layout = buildDocumentWorkspaceProjectLayout("/workspace/projects/source");
    assert.equal(
      buildDocumentProjectPythonRenderEntrypoint(layout),
      "/workspace/projects/source/render/build.py"
    );
    assert.equal(
      buildDocumentProjectPdfExportEntrypoint(layout),
      "/workspace/projects/source/render/export_pdf.py"
    );
  });

  test("builds imported Office runtime scaffolds in memory", () => {
    const docxBuild = buildImportedOfficeRenderScaffold({
      sourceFormat: "docx",
      projectSourcePath: "/workspace/projects/source/source/source.docx"
    });
    assert.match(docxBuild, /from docx import Document/);
    assert.match(docxBuild, /PERSAI_OUTPUT_PATH/);

    const xlsxBuild = buildImportedOfficeRenderScaffold({
      sourceFormat: "xlsx",
      projectSourcePath: "/workspace/projects/source/source/source.xlsx"
    });
    assert.match(xlsxBuild, /from openpyxl import load_workbook/);
    assert.match(xlsxBuild, /PERSAI_OUTPUT_PATH/);

    const exportPdf = buildImportedOfficePdfExportScaffold({
      sourceFormat: "docx",
      projectSourcePath: "/workspace/projects/source/source/source.docx"
    });
    assert.match(exportPdf, /soffice/);
    assert.match(exportPdf, /os\.environ\.get\('PERSAI_OUTPUT_PATH'\)/);
    assert.match(exportPdf, /DEFAULT_OUTPUT_PATH/);
  });
});
