import type {
  AssistantDocumentInspectionSummary,
  AssistantDocumentWorkspaceFacts
} from "./assistant-document-link-metadata";

export type VisibleWorkspaceDocumentOutputFormat = "pdf" | "xlsx" | "docx";

export type DocumentWorkspaceInspectionFacts = {
  sourcePath: string | null;
  format: VisibleWorkspaceDocumentOutputFormat | null;
  summary: AssistantDocumentInspectionSummary | null;
};

export type DocumentWorkspaceDeliverableValidationResult =
  | {
      ok: true;
      outputFormat: VisibleWorkspaceDocumentOutputFormat;
    }
  | {
      ok: false;
      code:
        | "unsupported_output_format"
        | "project_path_required"
        | "project_output_mismatch"
        | "project_manifest_missing"
        | "provenance_missing"
        | "inspect_missing"
        | "inspect_output_mismatch"
        | "inspect_format_mismatch";
      message: string;
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

export function validateVisibleWorkspaceDocumentDeliverable(input: {
  workspaceFacts: AssistantDocumentWorkspaceFacts;
  outputPath: string;
  inspection: DocumentWorkspaceInspectionFacts | null;
}): DocumentWorkspaceDeliverableValidationResult {
  const outputFormat = resolveVisibleWorkspaceOutputFormatFromPath(input.outputPath);
  if (outputFormat !== "pdf" && outputFormat !== "xlsx" && outputFormat !== "docx") {
    return {
      ok: false,
      code: "unsupported_output_format",
      message:
        "Visible document deliverable gating supports only PDF, XLSX, and DOCX project outputs."
    };
  }

  const workspaceProjectPath = input.workspaceFacts.workspaceProjectPath;
  if (workspaceProjectPath === null) {
    return {
      ok: false,
      code: "project_path_required",
      message:
        "Document deliverable output must belong to a visible workspace project with canonical project/source provenance."
    };
  }

  const inferredProjectPath = inferProjectPathFromOutputPath(input.outputPath);
  const outputInsideProject =
    input.outputPath === workspaceProjectPath ||
    input.outputPath.startsWith(`${workspaceProjectPath}/`);
  if (
    (inferredProjectPath !== null && inferredProjectPath !== workspaceProjectPath) ||
    !outputInsideProject
  ) {
    return {
      ok: false,
      code: "project_output_mismatch",
      message: `Document output ${input.outputPath} does not belong to project ${workspaceProjectPath}.`
    };
  }

  const expectedManifestPath = `${workspaceProjectPath}/project.json`;
  if (input.workspaceFacts.projectManifestPath !== expectedManifestPath) {
    return {
      ok: false,
      code: "project_manifest_missing",
      message: `Document project ${workspaceProjectPath} is missing canonical manifest truth at ${expectedManifestPath}.`
    };
  }

  if (
    input.workspaceFacts.sourceKind === null ||
    input.workspaceFacts.sourcePath === null ||
    input.workspaceFacts.sourceFormat === null
  ) {
    return {
      ok: false,
      code: "provenance_missing",
      message:
        "Document deliverable output is missing project/source provenance (sourceKind, sourcePath, or sourceFormat)."
    };
  }

  if (
    input.workspaceFacts.sourceKind === "imported_workspace_file" &&
    (input.workspaceFacts.sourceFormat === "pdf" ||
      input.workspaceFacts.sourceFormat === "docx" ||
      input.workspaceFacts.sourceFormat === "xlsx") &&
    input.workspaceFacts.projectSourcePath === null
  ) {
    return {
      ok: false,
      code: "provenance_missing",
      message:
        "Imported document project outputs require a visible native projectSourcePath before they can be registered or attached."
    };
  }

  if (
    input.workspaceFacts.inspectionPath === null ||
    input.inspection === null ||
    input.inspection.summary === null
  ) {
    return {
      ok: false,
      code: "inspect_missing",
      message:
        "Document deliverable output requires a relevant document.inspect result before document.register_version or files.attach."
    };
  }

  if (input.inspection.sourcePath !== null && input.inspection.sourcePath !== input.outputPath) {
    return {
      ok: false,
      code: "inspect_output_mismatch",
      message: `Inspection sidecar ${input.workspaceFacts.inspectionPath} describes ${input.inspection.sourcePath}, not ${input.outputPath}.`
    };
  }

  const inspectionFormat = input.inspection.format ?? input.inspection.summary.format;
  if (inspectionFormat !== outputFormat) {
    return {
      ok: false,
      code: "inspect_format_mismatch",
      message: `Inspection sidecar ${input.workspaceFacts.inspectionPath} is for ${inspectionFormat ?? "unknown"}, not ${outputFormat}.`
    };
  }

  return {
    ok: true,
    outputFormat
  };
}
