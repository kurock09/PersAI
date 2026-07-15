import {
  buildAssistantSessionRoot,
  isSessionInstallLayerPath,
  normalizeWorkspacePath
} from "@persai/runtime-contract";

export const SESSION_DEPENDENCY_CONTOUR_LIMITS = {
  maxAddedFilesPerJob: 20_000,
  maxAddedDirectoriesPerJob: 4_000,
  maxAddedBytesPerJob: 512 * 1024 * 1024
} as const;

export type SessionRuntimeEnvironmentPaths = {
  home: string;
  pythonUserBase: string;
  npmPrefix: string;
  pathPrefix: string;
  writableDirs: string[];
};

export function buildSessionRuntimeEnvironmentPaths(
  assistantId: string,
  runtimeSessionId: string
): SessionRuntimeEnvironmentPaths {
  const sessionRoot = buildAssistantSessionRoot(assistantId, runtimeSessionId);
  const pythonUserBase = `${sessionRoot}/.local`;
  const npmPrefix = `${sessionRoot}/.npm-global`;
  return {
    home: sessionRoot,
    pythonUserBase,
    npmPrefix,
    pathPrefix: `${npmPrefix}/bin:${pythonUserBase}/bin:/opt/venv/bin`,
    writableDirs: [
      sessionRoot,
      pythonUserBase,
      `${pythonUserBase}/bin`,
      npmPrefix,
      `${npmPrefix}/bin`
    ]
  };
}

/** ADR-148 quota contour — same trees as ADR-150 install-layer. */
export function isSessionDependencyVisiblePath(
  visiblePath: string,
  assistantId: string,
  runtimeSessionId: string
): boolean {
  if (!isSessionInstallLayerPath(visiblePath)) {
    return false;
  }
  const sessionRoot = buildAssistantSessionRoot(assistantId, runtimeSessionId);
  const normalized = normalizeWorkspacePath(visiblePath);
  return normalized === sessionRoot || normalized.startsWith(`${sessionRoot}/`);
}
