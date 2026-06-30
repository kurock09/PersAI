import type { AssistantDocumentStatus, AssistantDocumentVersionStatus } from "@prisma/client";
import type { AssistantWebChatMessageAttachmentDocumentLink } from "./web-chat.types";
import {
  buildAssistantDocumentLinkMetadata,
  normalizeDocumentWorkspaceFacts
} from "./assistant-document-link-metadata";

/**
 * Read the persisted `documentLink` metadata block off a chat attachment row's
 * `metadata` JSON, normalising it into the shape consumed by the web client.
 *
 * The `documentLink` block is written by the document delivery pipeline AFTER
 * the live SSE turn has ended (see `AssistantDocumentJobDeliveryService`), so
 * there are several read paths that must agree on how to surface it back to
 * the UI:
 *
 *  - the live SSE turn stream
 *  - the SSE replay path
 *  - the synchronous send-turn response
 *  - the chat-history list endpoint used after page reload
 *
 * Previously the chat-history list endpoint silently dropped this block, so a
 * presentation rendered asynchronously came back to the UI without any
 * indication that it was a presentation, which in turn hid the PPTX
 * companion-download button next to the PDF banner. Centralising the helper
 * here prevents that drift from happening again.
 */
export function readPersistedDocumentLinkMetadata(
  metadata: Record<string, unknown> | null | undefined
): AssistantWebChatMessageAttachmentDocumentLink | null {
  if (metadata === null || metadata === undefined) {
    return null;
  }
  const row = metadata.documentLink;
  if (row === null || row === undefined || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }
  const link = row as Record<string, unknown>;
  if (typeof link.docId !== "string" || typeof link.versionId !== "string") {
    return null;
  }
  return buildAssistantDocumentLinkMetadata({
    docId: link.docId,
    versionId: link.versionId,
    versionNumber: typeof link.versionNumber === "number" ? link.versionNumber : null,
    descriptorMode:
      link.descriptorMode === "create_pdf_document" ||
      link.descriptorMode === "create_document" ||
      link.descriptorMode === "create_presentation" ||
      link.descriptorMode === "revise_document" ||
      link.descriptorMode === "export_or_redeliver" ||
      link.descriptorMode === "create_data_document"
        ? link.descriptorMode
        : null,
    documentType:
      link.documentType === "pdf_document" ||
      link.documentType === "workspace_document" ||
      link.documentType === "presentation" ||
      link.documentType === "data_document"
        ? link.documentType
        : null,
    outputFormat:
      link.outputFormat === "pdf" ||
      link.outputFormat === "pptx" ||
      link.outputFormat === "xlsx" ||
      link.outputFormat === "docx"
        ? link.outputFormat
        : null,
    documentStatus: readDocumentStatus(link.documentStatus),
    versionStatus: readVersionStatus(link.versionStatus),
    renderJobId: typeof link.renderJobId === "string" ? link.renderJobId : null,
    isCurrentOutput: link.isCurrentOutput === true,
    workspaceFacts: normalizeDocumentWorkspaceFacts(link)
  });
}

function readDocumentStatus(value: unknown): AssistantDocumentStatus | null {
  return value === "drafting" ||
    value === "rendering" ||
    value === "ready" ||
    value === "failed" ||
    value === "archived"
    ? value
    : null;
}

function readVersionStatus(value: unknown): AssistantDocumentVersionStatus | null {
  return value === "draft" ||
    value === "render_requested" ||
    value === "rendering" ||
    value === "ready" ||
    value === "failed" ||
    value === "superseded"
    ? value
    : null;
}
