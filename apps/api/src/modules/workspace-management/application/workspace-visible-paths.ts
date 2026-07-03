import {
  classifyVisibleWorkspacePath,
  normalizeWorkspacePath as normalizeContractWorkspacePath
} from "@persai/runtime-contract";

const ACTIVE_FILE_KINDS = [
  "sessionDescendant",
  "assistantSharedDescendant",
  "workspaceSharedDescendant"
] as const;

const ACTIVE_DIRECTORY_KINDS = [
  "workspaceRoot",
  "assistantsRoot",
  "assistantRoot",
  "assistantSessionsRoot",
  "sessionRoot",
  "sessionDescendant",
  "assistantSharedRoot",
  "assistantSharedDescendant",
  "workspaceSharedRoot",
  "workspaceSharedDescendant"
] as const;

function normalizeCandidatePath(path: string): string | null {
  const normalized = normalizeContractWorkspacePath(path);
  if (normalized.length === 0 || normalized.includes("..")) {
    return null;
  }
  return normalized;
}

export function normalizeActiveWorkspaceFilePath(path: string): string | null {
  const normalized = normalizeCandidatePath(path);
  if (normalized === null) {
    return null;
  }
  const info = classifyVisibleWorkspacePath(normalized);
  return ACTIVE_FILE_KINDS.includes(info.kind as (typeof ACTIVE_FILE_KINDS)[number])
    ? normalized
    : null;
}

export function normalizeActiveWorkspaceDirectoryPath(path: string): string | null {
  const normalized = normalizeCandidatePath(path);
  if (normalized === null) {
    return null;
  }
  const info = classifyVisibleWorkspacePath(normalized);
  return ACTIVE_DIRECTORY_KINDS.includes(info.kind as (typeof ACTIVE_DIRECTORY_KINDS)[number])
    ? normalized
    : null;
}

export function lastWorkspacePathSegment(path: string): string | null {
  const normalized = normalizeContractWorkspacePath(path);
  if (normalized.length === 0) {
    return null;
  }
  const lastSlash = normalized.lastIndexOf("/");
  const segment = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return segment.length > 0 ? segment : null;
}
