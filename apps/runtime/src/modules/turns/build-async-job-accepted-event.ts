import type {
  RuntimeAsyncJobAcceptedEvent,
  RuntimeDocumentToolResult,
  RuntimeImageEditToolResult,
  RuntimeImageGenerateToolResult,
  RuntimeSandboxToolResult,
  RuntimeVideoGenerateToolResult
} from "@persai/runtime-contract";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Builds the ADR-152 mid-turn Working continuity event from a successful tool
 * payload that just accepted an opaque jobRef. Returns null when the payload
 * is not an accepted async media/document/sandbox job.
 */
export function buildAsyncJobAcceptedEvent(input: {
  requestId: string;
  sessionId: string;
  payload: unknown;
  isError: boolean;
}): RuntimeAsyncJobAcceptedEvent | null {
  if (input.isError) {
    return null;
  }
  const payload = input.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const row = payload as Record<string, unknown> &
    Partial<
      | RuntimeImageGenerateToolResult
      | RuntimeImageEditToolResult
      | RuntimeVideoGenerateToolResult
      | RuntimeDocumentToolResult
      | RuntimeSandboxToolResult
    >;

  if (!isNonEmptyString(row.jobRef)) {
    return null;
  }
  const opaqueJobRef = row.jobRef.trim();
  const createdAt = nowIso();

  if (
    (row.toolCode === "image_generate" || row.toolCode === "image_edit") &&
    row.action === "pending_delivery" &&
    isNonEmptyString(row.jobId)
  ) {
    const requestedCount =
      typeof row.requestedCount === "number" && Number.isFinite(row.requestedCount)
        ? row.requestedCount
        : null;
    return {
      type: "async_job_accepted",
      requestId: input.requestId,
      sessionId: input.sessionId,
      kind: "media",
      jobRef: opaqueJobRef,
      mediaJob: {
        id: row.jobId,
        kind: "image",
        operation: row.toolCode === "image_edit" ? "image_edit" : "image_generate",
        displayKind: "cinematic",
        ...(requestedCount === null ? {} : { requestedCount }),
        status: "queued",
        createdAt,
        startedAt: null,
        updatedAt: createdAt,
        notifyState: "none"
      }
    };
  }

  if (
    row.toolCode === "video_generate" &&
    row.action === "pending_delivery" &&
    isNonEmptyString(row.jobId)
  ) {
    const videoPayload = row as RuntimeVideoGenerateToolResult;
    const displayKind =
      videoPayload.requestedMode === "talking_avatar" ? "talking_avatar" : "cinematic";
    const requestedCount =
      typeof videoPayload.requestedCount === "number" &&
      Number.isFinite(videoPayload.requestedCount)
        ? videoPayload.requestedCount
        : null;
    return {
      type: "async_job_accepted",
      requestId: input.requestId,
      sessionId: input.sessionId,
      kind: "media",
      jobRef: opaqueJobRef,
      mediaJob: {
        id: videoPayload.jobId!,
        kind: "video",
        operation: "video_generate",
        displayKind,
        ...(requestedCount === null ? {} : { requestedCount }),
        status: "queued",
        createdAt,
        startedAt: null,
        updatedAt: createdAt,
        notifyState: "none"
      }
    };
  }

  if (
    row.toolCode === "document" &&
    row.action === "pending_delivery" &&
    isNonEmptyString(row.jobId) &&
    row.documentType === "presentation" &&
    (row.descriptorMode === "create_presentation" ||
      row.descriptorMode === "revise_document" ||
      row.descriptorMode === "export_or_redeliver")
  ) {
    return {
      type: "async_job_accepted",
      requestId: input.requestId,
      sessionId: input.sessionId,
      kind: "document",
      jobRef: opaqueJobRef,
      documentJob: {
        id: row.jobId,
        documentType: "presentation",
        descriptorMode: row.descriptorMode,
        status: "queued",
        createdAt,
        startedAt: null,
        updatedAt: createdAt,
        notifyState: "none"
      }
    };
  }

  if (
    row.executionMode === "sandbox" &&
    row.action === "background" &&
    (row.toolCode === "shell" || row.toolCode === "exec")
  ) {
    return {
      type: "async_job_accepted",
      requestId: input.requestId,
      sessionId: input.sessionId,
      kind: "sandbox",
      jobRef: opaqueJobRef,
      sandboxJob: {
        jobRef: opaqueJobRef,
        toolCode: row.toolCode,
        status: "detached",
        notifyState: "none",
        createdAt,
        startedAt: createdAt,
        updatedAt: createdAt
      }
    };
  }

  return null;
}
