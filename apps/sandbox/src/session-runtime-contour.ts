import { buildAssistantSessionRoot, normalizeWorkspacePath } from "@persai/runtime-contract";

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

export function isSessionDependencyVisiblePath(
  visiblePath: string,
  assistantId: string,
  runtimeSessionId: string
): boolean {
  const normalized = normalizeWorkspacePath(visiblePath);
  const sessionRoot = buildAssistantSessionRoot(assistantId, runtimeSessionId);
  if (normalized === `${sessionRoot}/.local` || normalized.startsWith(`${sessionRoot}/.local/`)) {
    return true;
  }
  if (
    normalized === `${sessionRoot}/.npm-global` ||
    normalized.startsWith(`${sessionRoot}/.npm-global/`)
  ) {
    return true;
  }
  if (normalized === `${sessionRoot}/node_modules`) {
    return true;
  }
  const sessionPrefix = `${sessionRoot}/`;
  if (!normalized.startsWith(sessionPrefix)) {
    return false;
  }
  const sessionRelative = normalized.slice(sessionPrefix.length);
  return (
    sessionRelative === "node_modules" ||
    sessionRelative.startsWith("node_modules/") ||
    sessionRelative.includes("/node_modules/")
  );
}
