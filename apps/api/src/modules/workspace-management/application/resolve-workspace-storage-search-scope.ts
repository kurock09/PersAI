import { buildAssistantSessionRoot } from "@persai/runtime-contract";
import {
  normalizeActiveWorkspaceDirectoryPath,
  normalizeActiveWorkspaceFilePath
} from "./workspace-visible-paths";

export type WorkspaceStorageSearchScope = {
  searchRoot: string;
  listPathPrefix: string;
  singleFilePath: string | null;
};

export type ResolvedWorkspaceStorageSearchScope =
  | { kind: "scope"; scope: WorkspaceStorageSearchScope }
  | { kind: "error"; reason: string; warning: string };

export function resolveWorkspaceStorageSearchScope(input: {
  path: string | null;
  assistantId: string;
  sessionId: string;
}): ResolvedWorkspaceStorageSearchScope {
  const candidate =
    input.path === null || input.path.trim().length === 0
      ? buildAssistantSessionRoot(input.assistantId, input.sessionId)
      : input.path.trim();
  if (candidate === "/tmp" || candidate.startsWith("/tmp/")) {
    return {
      kind: "error",
      reason: "scratch_path_unsupported",
      warning:
        "Scratch paths under /tmp are pod-only during shell/exec; use shell for ephemeral files."
    };
  }
  const filePath = normalizeActiveWorkspaceFilePath(candidate);
  if (filePath !== null) {
    const lastSlash = filePath.lastIndexOf("/");
    const searchRoot = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "/workspace";
    return {
      kind: "scope",
      scope: {
        searchRoot,
        listPathPrefix: `${filePath}/`,
        singleFilePath: filePath
      }
    };
  }
  const directoryPath = normalizeActiveWorkspaceDirectoryPath(candidate);
  if (directoryPath === null) {
    return {
      kind: "error",
      reason: "path_not_found",
      warning: `Workspace path ${candidate} is not an active hierarchical /workspace/... path.`
    };
  }
  const searchRoot = directoryPath.replace(/\/+$/, "") || "/workspace";
  return {
    kind: "scope",
    scope: {
      searchRoot,
      listPathPrefix: `${searchRoot}/`,
      singleFilePath: null
    }
  };
}
