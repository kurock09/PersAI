import type { AssistantWebChatMessageAttachmentDocumentLink } from "./web-chat.types";

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
  return {
    docId: link.docId,
    versionId: link.versionId,
    versionNumber: typeof link.versionNumber === "number" ? link.versionNumber : null,
    descriptorMode: typeof link.descriptorMode === "string" ? link.descriptorMode : null,
    documentType: typeof link.documentType === "string" ? link.documentType : null,
    documentStatus: typeof link.documentStatus === "string" ? link.documentStatus : null,
    versionStatus: typeof link.versionStatus === "string" ? link.versionStatus : null,
    isCurrentOutput: link.isCurrentOutput === true
  };
}
