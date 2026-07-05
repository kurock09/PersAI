import {
  buildAssistantSessionRoot,
  buildAssistantSharedRoot,
  classifyVisibleWorkspacePath,
  isValidVisibleWorkspacePath,
  normalizeWorkspacePath,
  type WorkspaceVisiblePathInfo
} from "@persai/runtime-contract";

export type WorkspaceHydrateScopeLabel = "session" | "shared" | "on_demand";

export function toWorkspaceGcsSubPath(workspaceVisiblePath: string): string {
  return normalizeWorkspacePath(workspaceVisiblePath)
    .replace(/^\/workspace\/?/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
}

export function buildBootstrapHydrateSubPaths(input: {
  assistantId: string;
  runtimeSessionId: string;
}): Array<{ scope: Exclude<WorkspaceHydrateScopeLabel, "on_demand">; subPath: string }> {
  return [
    {
      scope: "session",
      subPath: toWorkspaceGcsSubPath(
        buildAssistantSessionRoot(input.assistantId, input.runtimeSessionId)
      )
    },
    {
      scope: "shared",
      subPath: toWorkspaceGcsSubPath(buildAssistantSharedRoot(input.assistantId))
    }
  ];
}

export function buildSharedOnlyHydrateSubPath(assistantId: string): string {
  return toWorkspaceGcsSubPath(buildAssistantSharedRoot(assistantId));
}

export function isWithinBootstrapHydrateScope(
  pathInfo: WorkspaceVisiblePathInfo,
  assistantId: string,
  runtimeSessionId: string
): boolean {
  if (pathInfo.assistantId !== assistantId) {
    return false;
  }
  if (pathInfo.kind === "sessionRoot" || pathInfo.kind === "sessionDescendant") {
    return pathInfo.sessionId === runtimeSessionId;
  }
  if (pathInfo.kind === "assistantSharedRoot" || pathInfo.kind === "assistantSharedDescendant") {
    return true;
  }
  return false;
}

export function collectOnDemandHydratePaths(input: {
  assistantId: string;
  runtimeSessionId: string;
  visiblePaths: readonly string[];
}): string[] {
  const subPaths = new Set<string>();
  for (const rawPath of input.visiblePaths) {
    const normalized = normalizeWorkspacePath(rawPath);
    if (!normalized.startsWith("/workspace/")) {
      continue;
    }
    const info = classifyVisibleWorkspacePath(normalized);
    if (!isValidVisibleWorkspacePath(normalized)) {
      continue;
    }
    const gcsSubPath = toWorkspaceGcsSubPath(normalized);
    if (gcsSubPath.length === 0) {
      continue;
    }
    if (isWithinBootstrapHydrateScope(info, input.assistantId, input.runtimeSessionId)) {
      continue;
    }
    subPaths.add(gcsSubPath);
  }
  return [...subPaths];
}
