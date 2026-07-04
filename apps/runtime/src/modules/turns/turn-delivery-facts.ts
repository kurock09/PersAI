import type {
  RuntimeDocumentToolResult,
  RuntimeFileHandle,
  RuntimeFileVisibilityTier,
  RuntimeFilesToolResult,
  RuntimeImageEditToolResult,
  RuntimeImageGenerateToolResult,
  RuntimeSandboxToolResult,
  RuntimeTurnDeliveryFacts,
  RuntimeTurnShellDocumentRegistration,
  RuntimeVideoGenerateToolResult
} from "@persai/runtime-contract";
import { classifyVisibleWorkspacePath } from "@persai/runtime-contract";

export type RuntimeTurnDeliveryFactsTracker = RuntimeTurnDeliveryFacts;

export type RuntimeMediaToolCode = RuntimeTurnDeliveryFacts["mediaToolCalls"][number];

const BINARY_OUTPUT_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".docx",
  ".xlsx",
  ".pptx",
  ".zip"
]);

export function createEmptyTurnDeliveryFacts(): RuntimeTurnDeliveryFactsTracker {
  return {
    producedPaths: [],
    attachedPaths: [],
    pendingMediaJobIds: [],
    pendingDocumentJobIds: [],
    mediaToolCalls: [],
    shellDocumentRegistrations: []
  };
}

export function resolveUndeliveredProducedPaths(
  facts: Pick<RuntimeTurnDeliveryFacts, "producedPaths" | "attachedPaths">
): string[] {
  const attached = new Set(facts.attachedPaths);
  return facts.producedPaths.filter((path) => !attached.has(path));
}

export function resolveShellAutoAttachPaths(
  registrations: readonly RuntimeTurnShellDocumentRegistration[],
  attachedPaths: readonly string[]
): string[] {
  const attached = new Set(attachedPaths);
  const v1New = registrations.filter(
    (entry) => !entry.isOverwrite && entry.versionNumber === 1 && !attached.has(entry.path)
  );
  const paths: string[] = [];
  for (const entry of registrations) {
    if (entry.isOverwrite && !attached.has(entry.path)) {
      paths.push(entry.path);
    }
  }
  if (v1New.length === 1) {
    paths.push(v1New[0]!.path);
  }
  return paths;
}

export function resolveAutoAttachCandidatePaths(
  facts: Pick<
    RuntimeTurnDeliveryFacts,
    "producedPaths" | "attachedPaths" | "shellDocumentRegistrations"
  >
): string[] {
  const shellPaths = new Set(facts.shellDocumentRegistrations.map((entry) => entry.path));
  const shellCandidates = resolveShellAutoAttachPaths(
    facts.shellDocumentRegistrations,
    facts.attachedPaths
  );
  const otherUndelivered = resolveUndeliveredProducedPaths(facts).filter(
    (path) => !shellPaths.has(path)
  );
  return [...shellCandidates, ...otherUndelivered];
}

export function appendUniquePath(paths: string[], path: string | null | undefined): void {
  if (typeof path !== "string" || path.trim().length === 0) {
    return;
  }
  const normalized = path.trim();
  if (!paths.includes(normalized)) {
    paths.push(normalized);
  }
}

function isLikelyBinaryDeliverablePath(path: string): boolean {
  const lowered = path.toLowerCase();
  for (const extension of BINARY_OUTPUT_EXTENSIONS) {
    if (lowered.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

export function recordTurnDeliveryFactsFromToolOutcome(input: {
  tracker: RuntimeTurnDeliveryFactsTracker;
  toolName: string;
  payload: unknown;
  isError: boolean;
}): void {
  if (input.isError || input.payload === null || typeof input.payload !== "object") {
    return;
  }

  if (input.toolName === "files") {
    recordFilesToolDeliveryFacts(input.tracker, input.payload as RuntimeFilesToolResult);
    return;
  }
  if (input.toolName === "document") {
    recordDocumentToolDeliveryFacts(input.tracker, input.payload as RuntimeDocumentToolResult);
    return;
  }
  if (input.toolName === "image_generate") {
    recordMediaToolDeliveryFacts(input.tracker, "image_generate", input.payload);
    return;
  }
  if (input.toolName === "image_edit") {
    recordMediaToolDeliveryFacts(input.tracker, "image_edit", input.payload);
    return;
  }
  if (input.toolName === "video_generate") {
    recordMediaToolDeliveryFacts(input.tracker, "video_generate", input.payload);
    return;
  }
  if (input.toolName === "shell") {
    recordShellToolDeliveryFacts(input.tracker, input.payload as RuntimeSandboxToolResult);
  }
}

function recordFilesToolDeliveryFacts(
  tracker: RuntimeTurnDeliveryFactsTracker,
  payload: RuntimeFilesToolResult
): void {
  if (payload.action === "attached" && typeof payload.path === "string") {
    appendUniquePath(tracker.attachedPaths, payload.path);
    return;
  }
  if (payload.action === "written" && typeof payload.path === "string") {
    if (isLikelyBinaryDeliverablePath(payload.path)) {
      appendUniquePath(tracker.producedPaths, payload.path);
    }
  }
}

function recordDocumentToolDeliveryFacts(
  tracker: RuntimeTurnDeliveryFactsTracker,
  payload: RuntimeDocumentToolResult
): void {
  if (payload.action === "rendered" && payload.render !== undefined && payload.render !== null) {
    appendUniquePath(tracker.producedPaths, payload.render.outputPath);
    return;
  }
  if (payload.action === "converted" && payload.convert !== undefined && payload.convert !== null) {
    appendUniquePath(tracker.producedPaths, payload.convert.outputPath);
    return;
  }
  if (payload.action === "pending_delivery" && typeof payload.jobId === "string") {
    appendUniquePath(tracker.pendingDocumentJobIds, payload.jobId);
  }
}

function recordShellToolDeliveryFacts(
  tracker: RuntimeTurnDeliveryFactsTracker,
  payload: RuntimeSandboxToolResult
): void {
  if (payload.action !== "completed" || payload.documentSync === undefined) {
    return;
  }
  for (const outcome of payload.documentSync) {
    if (!outcome.registered || outcome.versionNumber === null) {
      continue;
    }
    appendUniquePath(tracker.producedPaths, outcome.path);
    const existing = tracker.shellDocumentRegistrations.find(
      (entry) => entry.path === outcome.path
    );
    const registration: RuntimeTurnShellDocumentRegistration = {
      path: outcome.path,
      versionNumber: outcome.versionNumber,
      isOverwrite: outcome.isOverwrite
    };
    if (existing === undefined) {
      tracker.shellDocumentRegistrations.push(registration);
      continue;
    }
    existing.versionNumber = registration.versionNumber;
    existing.isOverwrite = registration.isOverwrite;
  }
}

function recordMediaToolDeliveryFacts(
  tracker: RuntimeTurnDeliveryFactsTracker,
  toolCode: RuntimeMediaToolCode,
  payload: unknown
): void {
  const row = payload as
    | RuntimeImageGenerateToolResult
    | RuntimeImageEditToolResult
    | RuntimeVideoGenerateToolResult;
  if (row.action === "pending_delivery" && typeof row.jobId === "string") {
    appendUniquePath(tracker.pendingMediaJobIds, row.jobId);
  }
  if (row.action === "pending_delivery" || row.action === "generated") {
    if (!tracker.mediaToolCalls.includes(toolCode)) {
      tracker.mediaToolCalls.push(toolCode);
    }
  }
}

export function buildRuntimeFileHandleFromDocumentRender(input: {
  render: NonNullable<RuntimeDocumentToolResult["render"]>;
  workspaceId: string;
}): RuntimeFileHandle {
  const basename = input.render.outputPath.split("/").pop() ?? "document";
  return {
    storagePath: input.render.outputPath,
    mimeType: input.render.mimeType,
    sizeBytes: input.render.sizeBytes,
    displayName: basename,
    workspaceId: input.workspaceId,
    authorLabel: "model",
    sourceToolCode: "document",
    visibilityTier: "session",
    createdAt: new Date().toISOString()
  };
}

export function buildRuntimeFileHandleFromDocumentConvert(input: {
  convert: NonNullable<RuntimeDocumentToolResult["convert"]>;
  workspaceId: string;
}): RuntimeFileHandle {
  const basename = input.convert.outputPath.split("/").pop() ?? "document";
  return {
    storagePath: input.convert.outputPath,
    mimeType: input.convert.mimeType,
    sizeBytes: input.convert.sizeBytes,
    displayName: basename,
    workspaceId: input.workspaceId,
    authorLabel: "model",
    sourceToolCode: "document",
    visibilityTier: "session",
    createdAt: new Date().toISOString()
  };
}

export function resolveRuntimeFileVisibilityTier(input: {
  storagePath: string;
  currentChatId: string | null;
  producedPathsThisTurn: ReadonlySet<string>;
  authorLabel?: RuntimeFileHandle["authorLabel"];
  originChatId?: string | null;
}): RuntimeFileVisibilityTier {
  if (input.producedPathsThisTurn.has(input.storagePath)) {
    return "session";
  }
  if (
    input.originChatId !== undefined &&
    input.originChatId !== null &&
    input.currentChatId !== null &&
    input.originChatId === input.currentChatId
  ) {
    return "session";
  }
  if (input.authorLabel === "user") {
    return "session";
  }
  const visiblePath = classifyVisibleWorkspacePath(input.storagePath);
  if (visiblePath.kind === "sessionRoot" || visiblePath.kind === "sessionDescendant") {
    return "session";
  }
  if (
    visiblePath.kind === "assistantRoot" ||
    visiblePath.kind === "assistantSessionsRoot" ||
    visiblePath.kind === "assistantSharedRoot" ||
    visiblePath.kind === "assistantSharedDescendant"
  ) {
    return "assistant";
  }
  if (
    visiblePath.kind === "workspaceRoot" ||
    visiblePath.kind === "assistantsRoot" ||
    visiblePath.kind === "workspaceSharedRoot" ||
    visiblePath.kind === "workspaceSharedDescendant"
  ) {
    return "workspace";
  }
  return "assistant";
}

export function finalizeTurnDeliveryFacts(
  tracker: RuntimeTurnDeliveryFactsTracker
): RuntimeTurnDeliveryFacts {
  return {
    producedPaths: [...tracker.producedPaths],
    attachedPaths: [...tracker.attachedPaths],
    pendingMediaJobIds: [...tracker.pendingMediaJobIds],
    pendingDocumentJobIds: [...tracker.pendingDocumentJobIds],
    mediaToolCalls: [...tracker.mediaToolCalls],
    shellDocumentRegistrations: [...tracker.shellDocumentRegistrations]
  };
}
