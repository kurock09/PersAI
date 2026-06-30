import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
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
});
