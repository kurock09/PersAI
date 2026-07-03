import type { AssistantDocumentInspectionSummary } from "./assistant-document-link-metadata";
import {
  normalizeActiveWorkspaceDirectoryPath,
  normalizeActiveWorkspaceFilePath
} from "./workspace-visible-paths";

export type VisibleWorkspaceDocumentOutputFormat = "pdf" | "xlsx" | "docx";

export type DocumentWorkspaceInspectionFacts = {
  sourcePath: string | null;
  format: VisibleWorkspaceDocumentOutputFormat | null;
  summary: AssistantDocumentInspectionSummary | null;
};

export function normalizeWorkspacePath(value: string): string | null {
  return normalizeActiveWorkspaceFilePath(value);
}

export function normalizeWorkspaceDirectory(value: string): string | null {
  return normalizeActiveWorkspaceDirectoryPath(value);
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
