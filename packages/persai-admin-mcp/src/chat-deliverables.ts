import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function mapAttachmentSummary(attachment: unknown): Record<string, unknown> | null {
  const row = asRecord(attachment);
  if (row === null) {
    return null;
  }
  return {
    id: row.id ?? null,
    path: row.path ?? null,
    mimeType: row.mimeType ?? null,
    originalFilename: row.originalFilename ?? null,
    sizeBytes: row.sizeBytes ?? null,
    processingStatus: row.processingStatus ?? null,
    attachmentType: row.attachmentType ?? null
  };
}

export function mapMessageDeliverable(message: unknown): Record<string, unknown> | null {
  const row = asRecord(message);
  if (row === null) {
    return null;
  }
  const attachments = Array.isArray(row.attachments)
    ? row.attachments
        .map((item) => mapAttachmentSummary(item))
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
  const toolInvocations = Array.isArray(row.toolInvocations) ? row.toolInvocations : [];
  return {
    id: row.id ?? null,
    author: row.author ?? null,
    createdAt: row.createdAt ?? null,
    contentPreview: typeof row.content === "string" ? row.content.slice(0, 400) : "",
    attachments,
    toolInvocations: toolInvocations.map((item) => {
      const tool = asRecord(item);
      if (tool === null) {
        return item;
      }
      return {
        name: tool.name ?? null,
        ok: tool.ok ?? null,
        iteration: tool.iteration ?? null
      };
    })
  };
}

export function extensionForMime(mimeType: string, originalFilename: string | null): string {
  if (typeof originalFilename === "string" && originalFilename.includes(".")) {
    return basename(originalFilename);
  }
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) return "file.png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "file.jpg";
  if (normalized.includes("webp")) return "file.webp";
  if (normalized.includes("pdf")) return "file.pdf";
  if (normalized.includes("text")) return "file.txt";
  return "file.bin";
}

export function buildChatFileUrl(params: {
  chatId: string;
  path: string;
  variant: "preview" | "full";
}): string {
  const encodedPath = encodeURIComponent(params.path);
  if (params.variant === "preview") {
    return `/api/v1/assistant/chats/web/${params.chatId}/files/preview?path=${encodedPath}`;
  }
  return `/api/v1/assistant/chats/web/${params.chatId}/files?path=${encodedPath}`;
}

export async function saveAttachmentBytes(params: {
  artifactRoot: string;
  chatId: string;
  attachmentId: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename: string | null;
}): Promise<string> {
  const dir = join(params.artifactRoot, params.chatId);
  await mkdir(dir, { recursive: true });
  const filename = `${params.attachmentId}-${extensionForMime(params.mimeType, params.originalFilename)}`;
  const localPath = join(dir, filename);
  await writeFile(localPath, params.buffer);
  return localPath;
}

export const SMOKE_DELIVERY_AGENT_GUIDE = [
  "PersAI smoke delivery check (async media matches web UI — do not block chat_smoke on jobs).",
  "1) chat_smoke → note thread.chatId, toolSignals.image_generate/image_edit, activeMediaJobs.",
  "2) When jobs finish, chat_list_deliverables(chatId) → assistant messages with attachments.",
  "3) chat_inspect_attachments(chatId) → saves full files locally; open localPath with Read for vision QA.",
  "4) For scenario slides: verify each slide path, readable on-image copy, visual continuity.",
  "5) PASS/FAIL: compare visuals + assistant text to goal; skillActivation + plan.todos for workflow."
].join("\n");
