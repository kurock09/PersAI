import type {
  AssistantDocumentDescriptorMode,
  AssistantDocumentStatus,
  AssistantDocumentType,
  AssistantDocumentVersionStatus
} from "@prisma/client";
import {
  DOCUMENT_WORKSPACE_PROJECT_SOURCE_FORMATS,
  DOCUMENT_WORKSPACE_PROJECT_SOURCE_KINDS,
  type DocumentWorkspaceProjectSourceFormat,
  type DocumentWorkspaceProjectSourceKind
} from "@persai/runtime-contract";
import type { AssistantWebChatMessageAttachmentDocumentLink } from "./web-chat.types";

// document_link.outputFormat spans both deferred presentation jobs (pdf/pptx)
// and visible workspace documents (pdf/xlsx/docx), so we keep the chat-attachment
// surface union wider than the Prisma render-job enum, which is narrowed to the
// deferred (presentation) pipeline only after the ADR-129 hard cutover.
type AssistantDocumentLinkOutputFormat = "pdf" | "pptx" | "xlsx" | "docx";

type MutableDocumentLink = AssistantWebChatMessageAttachmentDocumentLink & {
  renderJobId?: string | null;
  outputPath?: string | null;
  workspaceProjectPath?: string | null;
  sourceManifestPath?: string | null;
  inspectionPath?: string | null;
  inspectionSummary?: AssistantDocumentInspectionSummary | null;
};

export type AssistantDocumentInspectionSummary = NonNullable<
  AssistantWebChatMessageAttachmentDocumentLink["inspectionSummary"]
>;

export type AssistantDocumentWorkspaceFacts = {
  workspaceProjectPath: string | null;
  projectManifestPath: string | null;
  projectSourcePath: string | null;
  sourceKind: DocumentWorkspaceProjectSourceKind | null;
  outputPath: string | null;
  sourcePath: string | null;
  sourceFormat: DocumentWorkspaceProjectSourceFormat | null;
  sourceMimeType: string | null;
  sourceManifestPath: string | null;
  sourceManifest: Record<string, unknown> | null;
  inspectionPath: string | null;
  inspectionSummary: AssistantDocumentInspectionSummary | null;
};

export function normalizeDocumentWorkspaceFacts(value: unknown): AssistantDocumentWorkspaceFacts {
  const row = asRecord(value);
  return {
    workspaceProjectPath: readOptionalString(row?.workspaceProjectPath),
    projectManifestPath: readOptionalString(row?.projectManifestPath),
    projectSourcePath: readOptionalString(row?.projectSourcePath),
    sourceKind: readOptionalSourceKind(row?.sourceKind),
    outputPath: readOptionalString(row?.outputPath),
    sourcePath: readOptionalString(row?.sourcePath),
    sourceFormat: readOptionalSourceFormat(row?.sourceFormat),
    sourceMimeType: readOptionalString(row?.sourceMimeType),
    sourceManifestPath: readOptionalString(row?.sourceManifestPath),
    sourceManifest: asRecord(row?.sourceManifest),
    inspectionPath: readOptionalString(row?.inspectionPath),
    inspectionSummary: normalizeInspectionSummary(row?.inspectionSummary)
  };
}

export function buildAssistantDocumentLinkMetadata(input: {
  docId: string;
  versionId: string;
  versionNumber: number | null;
  descriptorMode: AssistantDocumentDescriptorMode | null;
  documentType: AssistantDocumentType | null;
  outputFormat: AssistantDocumentLinkOutputFormat | null;
  documentStatus: AssistantDocumentStatus | null;
  versionStatus: AssistantDocumentVersionStatus | null;
  renderJobId?: string | null;
  isCurrentOutput: boolean;
  workspaceFacts?: AssistantDocumentWorkspaceFacts | null;
}): AssistantWebChatMessageAttachmentDocumentLink {
  const workspaceFacts = input.workspaceFacts ?? null;
  const link: MutableDocumentLink = {
    docId: input.docId,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    descriptorMode: normalizeDocumentLinkDescriptorMode(input.descriptorMode),
    documentType: normalizeDocumentLinkType(input.documentType),
    outputFormat: input.outputFormat,
    documentStatus: input.documentStatus,
    versionStatus: input.versionStatus,
    isCurrentOutput: input.isCurrentOutput
  };
  if (input.renderJobId !== undefined) {
    link.renderJobId = input.renderJobId;
  }
  if (workspaceFacts !== null) {
    link.outputPath = workspaceFacts.outputPath;
    link.workspaceProjectPath = workspaceFacts.workspaceProjectPath;
    link.projectManifestPath = workspaceFacts.projectManifestPath;
    link.projectSourcePath = workspaceFacts.projectSourcePath;
    link.sourceKind = workspaceFacts.sourceKind;
    link.sourcePath = workspaceFacts.sourcePath;
    link.sourceFormat = workspaceFacts.sourceFormat;
    link.sourceMimeType = workspaceFacts.sourceMimeType;
    link.sourceManifestPath = workspaceFacts.sourceManifestPath;
    link.inspectionPath = workspaceFacts.inspectionPath;
    link.inspectionSummary = workspaceFacts.inspectionSummary;
  }
  return link;
}

function normalizeDocumentLinkDescriptorMode(
  value: AssistantDocumentDescriptorMode | null
): AssistantWebChatMessageAttachmentDocumentLink["descriptorMode"] {
  if (
    value === "create_pdf_document" ||
    value === "create_data_document" ||
    value === "create_document"
  ) {
    return "create_document";
  }
  if (
    value === "create_presentation" ||
    value === "revise_document" ||
    value === "export_or_redeliver"
  ) {
    return value;
  }
  return null;
}

function normalizeDocumentLinkType(
  value: AssistantDocumentType | null
): AssistantWebChatMessageAttachmentDocumentLink["documentType"] {
  if (value === "pdf_document" || value === "data_document" || value === "workspace_document") {
    return "workspace_document";
  }
  return value === "presentation" ? value : null;
}

function normalizeInspectionSummary(value: unknown): AssistantDocumentInspectionSummary | null {
  const row = asRecord(value);
  if (row === null) {
    return null;
  }
  return {
    format:
      row.format === "pdf" || row.format === "xlsx" || row.format === "docx" ? row.format : null,
    counts: {
      pageCount: readOptionalNumber(row.counts, "pageCount"),
      sheetCount: readOptionalNumber(row.counts, "sheetCount"),
      formulaCount: readOptionalNumber(row.counts, "formulaCount"),
      blankSheetCount: readOptionalNumber(row.counts, "blankSheetCount"),
      paragraphCount: readOptionalNumber(row.counts, "paragraphCount"),
      headingCount: readOptionalNumber(row.counts, "headingCount"),
      tableCount: readOptionalNumber(row.counts, "tableCount"),
      textCharCount: readOptionalNumber(row.counts, "textCharCount")
    },
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

function readOptionalNumber(value: unknown, key: string): number | null {
  const row = asRecord(value);
  return typeof row?.[key] === "number" ? row[key] : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalSourceKind(value: unknown): DocumentWorkspaceProjectSourceKind | null {
  return typeof value === "string" &&
    (DOCUMENT_WORKSPACE_PROJECT_SOURCE_KINDS as readonly string[]).includes(value)
    ? (value as DocumentWorkspaceProjectSourceKind)
    : null;
}

function readOptionalSourceFormat(value: unknown): DocumentWorkspaceProjectSourceFormat | null {
  return typeof value === "string" &&
    (DOCUMENT_WORKSPACE_PROJECT_SOURCE_FORMATS as readonly string[]).includes(value)
    ? (value as DocumentWorkspaceProjectSourceFormat)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
