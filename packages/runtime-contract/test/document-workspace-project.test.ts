import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyDocumentProjectPathSuffix,
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
  const sessionRoot = "/workspace/assistants/assistant-1/sessions/chat-1";
  const sourceProjectRoot = `${sessionRoot}/projects/source`;

  test("derives a stable default project path from the source filename", () => {
    const cyrillicProject = deriveDefaultDocumentProjectPath(
      `${sessionRoot}/Карнаух_Федор_Отчет (1).docx`
    );
    assert.match(
      cyrillicProject ?? "",
      /^\/workspace\/assistants\/assistant-1\/sessions\/chat-1\/projects\/doc-[0-9a-f]{8}$/
    );
    assert.equal(deriveDefaultDocumentProjectPath(`${sessionRoot}/source.pdf`), sourceProjectRoot);
  });

  test("validates render paths stay inside the active project layout", () => {
    const layout = buildDocumentWorkspaceProjectLayout(sourceProjectRoot);
    assert.equal(
      validateDocumentProjectRenderPaths({
        layout,
        projectPath: sourceProjectRoot,
        outputPath: `${sourceProjectRoot}/output/report.pdf`,
        entrypointPath: `${sourceProjectRoot}/render/report.html`
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
      sourcePath: `${sessionRoot}/report.docx`,
      extractedText: "Line one\n\nLine two"
    });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /Line one/);
    assert.match(html, /Line two/);
  });

  test("exposes stable in-memory Office entrypoint paths", () => {
    const layout = buildDocumentWorkspaceProjectLayout(sourceProjectRoot);
    assert.equal(
      buildDocumentProjectPythonRenderEntrypoint(layout),
      `${sourceProjectRoot}/render/build.py`
    );
    assert.equal(
      buildDocumentProjectPdfExportEntrypoint(layout),
      `${sourceProjectRoot}/render/export_pdf.py`
    );
  });

  test("builds imported Office runtime scaffolds in memory", () => {
    const docxBuild = buildImportedOfficeRenderScaffold({
      sourceFormat: "docx",
      projectSourcePath: `${sourceProjectRoot}/source/source.docx`
    });
    assert.match(docxBuild, /from docx import Document/);
    assert.match(docxBuild, /PERSAI_OUTPUT_PATH/);

    const xlsxBuild = buildImportedOfficeRenderScaffold({
      sourceFormat: "xlsx",
      projectSourcePath: `${sourceProjectRoot}/source/source.xlsx`
    });
    assert.match(xlsxBuild, /from openpyxl import load_workbook/);
    assert.match(xlsxBuild, /PERSAI_OUTPUT_PATH/);

    const exportPdf = buildImportedOfficePdfExportScaffold({
      sourceFormat: "docx",
      projectSourcePath: `${sourceProjectRoot}/source/source.docx`
    });
    assert.match(exportPdf, /soffice/);
    assert.match(exportPdf, /os\.environ\.get\('PERSAI_OUTPUT_PATH'\)/);
    assert.match(exportPdf, /DEFAULT_OUTPUT_PATH/);
  });

  test("suffixes hierarchical project paths without global fallback", () => {
    assert.equal(
      applyDocumentProjectPathSuffix(sourceProjectRoot, 2),
      `${sessionRoot}/projects/source-2`
    );
  });
});
