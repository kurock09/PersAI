export const DOCUMENT_WORKSPACE_PROJECT_SCHEMA = "persai.document.project.v1" as const;

export const DOCUMENT_WORKSPACE_PROJECTS_ROOT = "/workspace/projects";

export type DocumentWorkspaceProjectLayout = {
  projectPath: string;
  extractDir: string;
  renderDir: string;
  outputDir: string;
  projectManifestPath: string;
  defaultRenderEntrypoint: string;
  defaultPdfOutputPath: string;
};

export function slugifyDocumentProjectStem(sourcePath: string): string {
  const basename = sourcePath.replace(/\\/g, "/").split("/").pop() ?? "document";
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const slug = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  if (slug.length > 0 && /[a-z]/.test(slug)) {
    return slug;
  }
  let hash = 0;
  for (const char of sourcePath) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `doc-${hash.toString(16).slice(0, 8)}`;
}

export function buildDocumentWorkspaceProjectLayout(
  projectPath: string
): DocumentWorkspaceProjectLayout {
  const normalized = projectPath.replace(/\/+$/g, "");
  return {
    projectPath: normalized,
    extractDir: `${normalized}/extract`,
    renderDir: `${normalized}/render`,
    outputDir: `${normalized}/output`,
    projectManifestPath: `${normalized}/project.json`,
    defaultRenderEntrypoint: `${normalized}/render/report.html`,
    defaultPdfOutputPath: `${normalized}/output/report.pdf`
  };
}

export function deriveDefaultDocumentProjectPath(sourcePath: string): string {
  return `${DOCUMENT_WORKSPACE_PROJECTS_ROOT}/${slugifyDocumentProjectStem(sourcePath)}`;
}

export function applyDocumentProjectPathSuffix(projectPath: string, suffix: number): string {
  if (suffix <= 1) {
    return projectPath;
  }
  const normalized = projectPath.replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  const parent = lastSlash >= 0 ? normalized.slice(0, lastSlash) : DOCUMENT_WORKSPACE_PROJECTS_ROOT;
  const basename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return `${parent}/${basename}-${String(suffix)}`;
}

export function isWorkspacePathUnderPrefix(path: string, prefix: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedPrefix = prefix.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

export function validateDocumentProjectRenderPaths(input: {
  layout: DocumentWorkspaceProjectLayout;
  projectPath: string;
  outputPath: string;
  entrypointPath: string;
}): string | null {
  const normalizedProjectPath = input.projectPath.replace(/\/+$/g, "");
  if (normalizedProjectPath !== input.layout.projectPath) {
    return `document.render projectPath must be ${input.layout.projectPath}, the active document project from document.extract.`;
  }
  if (!isWorkspacePathUnderPrefix(input.outputPath, input.layout.outputDir)) {
    return `document.render outputPath must stay under ${input.layout.outputDir}/.`;
  }
  if (!isWorkspacePathUnderPrefix(input.entrypointPath, input.layout.renderDir)) {
    return `document.render entrypoint must stay under ${input.layout.renderDir}/.`;
  }
  return null;
}

export function shouldScaffoldDocumentProjectRenderHtml(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    normalized === "application/pdf" ||
    normalized === "application/x-pdf" ||
    normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/xml" ||
    normalized === "application/yaml" ||
    normalized === "application/x-yaml"
  );
}

export function buildDocumentProjectManifest(input: {
  layout: DocumentWorkspaceProjectLayout;
  sourcePath: string;
  extractManifestPath: string;
  mimeType: string;
}): Record<string, unknown> {
  return {
    schema: DOCUMENT_WORKSPACE_PROJECT_SCHEMA,
    projectPath: input.layout.projectPath,
    sourcePath: input.sourcePath,
    extractDir: input.layout.extractDir,
    renderDir: input.layout.renderDir,
    outputDir: input.layout.outputDir,
    extractManifestPath: input.extractManifestPath,
    defaultRenderEntrypoint: input.layout.defaultRenderEntrypoint,
    defaultPdfOutputPath: input.layout.defaultPdfOutputPath,
    mimeType: input.mimeType
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function extractedTextToHtmlBody(extractedText: string): string {
  const paragraphs = extractedText.replace(/\r\n/g, "\n").split(/\n{2,}/);
  if (paragraphs.length === 0) {
    return "<p></p>";
  }
  return paragraphs
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) {
        return "";
      }
      const lines = trimmed.split("\n").map((line) => escapeHtml(line));
      return `<p>${lines.join("<br/>")}</p>`;
    })
    .filter((paragraph) => paragraph.length > 0)
    .join("\n");
}

export function buildDocumentProjectRenderScaffoldHtml(input: {
  sourcePath: string;
  extractedText: string;
}): string {
  const body = extractedTextToHtmlBody(input.extractedText);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Document render scaffold</title>
  <style>
    @page { size: A4; margin: 20mm 18mm 22mm 18mm; }
    body {
      font-family: "Times New Roman", Georgia, serif;
      font-size: 12pt;
      line-height: 1.45;
      color: #1f1f1f;
      background: #f7f3ea;
    }
    main { max-width: 100%; }
    h1.doc-title {
      font-size: 18pt;
      letter-spacing: 0.04em;
      margin: 0 0 12mm 0;
      color: #2f5496;
    }
    p { margin: 0 0 6pt 0; text-align: justify; }
  </style>
</head>
<body>
  <main>
    <h1 class="doc-title">${escapeHtml(input.sourcePath.split("/").pop() ?? "Document")}</h1>
    ${body}
  </main>
</body>
</html>
`;
}
