import type {
  AssistantDocumentDescriptorMode,
  AssistantDocumentOutputFormat,
  AssistantDocumentStatus,
  AssistantDocumentType,
  AssistantDocumentVersionStatus
} from "@prisma/client";
import type { AssistantWebChatMessageAttachmentDocumentLink } from "./web-chat.types";

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
  outputPath: string | null;
  sourceManifestPath: string | null;
  sourceManifest: Record<string, unknown> | null;
  inspectionPath: string | null;
  inspectionSummary: AssistantDocumentInspectionSummary | null;
};

export function normalizeDocumentWorkspaceFacts(value: unknown): AssistantDocumentWorkspaceFacts {
  const row = asRecord(value);
  return {
    workspaceProjectPath: readOptionalString(row?.workspaceProjectPath),
    outputPath: readOptionalString(row?.outputPath),
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
  outputFormat: AssistantDocumentOutputFormat | null;
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
    descriptorMode: input.descriptorMode,
    documentType: input.documentType,
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
    link.sourceManifestPath = workspaceFacts.sourceManifestPath;
    link.inspectionPath = workspaceFacts.inspectionPath;
    link.inspectionSummary = workspaceFacts.inspectionSummary;
  }
  return link;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
