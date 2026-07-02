import type { AssistantDocumentInspectionSummary } from "./assistant-document-link-metadata";

export type VisibleWorkspaceDocumentOutputFormat = "pdf" | "xlsx" | "docx";

export type DocumentWorkspaceInspectionFacts = {
  sourcePath: string | null;
  format: VisibleWorkspaceDocumentOutputFormat | null;
  summary: AssistantDocumentInspectionSummary | null;
};

export function normalizeWorkspacePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed.startsWith("/workspace/") || trimmed.includes("..")) {
    return null;
  }
  if (
    trimmed === "/workspace/input" ||
    trimmed.startsWith("/workspace/input/") ||
    trimmed === "/workspace/outbound" ||
    trimmed.startsWith("/workspace/outbound/")
  ) {
    return null;
  }
  return trimmed;
}

export function normalizeWorkspaceDirectory(value: string): string | null {
  const path = normalizeWorkspacePath(value);
  if (path === null) {
    return null;
  }
  const normalized = path.replace(/\/+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

export function resolveVisibleWorkspaceOutputFormatFromPath(
  path: string
): VisibleWorkspaceDocumentOutputFormat | "pptx" | null {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowered.endsWith(".pptx")) {
    return "pptx";
  }
  if (lowered.endsWith(".xlsx")) {
    return "xlsx";
  }
  if (lowered.endsWith(".docx")) {
    return "docx";
  }
  return null;
}

export function inferProjectPathFromOutputPath(outputPath: string): string | null {
  const marker = "/output/";
  const markerIndex = outputPath.lastIndexOf(marker);
  if (markerIndex <= 0) {
    return null;
  }
  return normalizeWorkspaceDirectory(outputPath.slice(0, markerIndex));
}

export function buildDefaultInspectionPath(outputPath: string): string | null {
  const format = resolveVisibleWorkspaceOutputFormatFromPath(outputPath);
  if (format !== "pdf" && format !== "xlsx" && format !== "docx") {
    return null;
  }
  return outputPath.slice(0, -`.${format}`.length) + ".inspect.json";
}
