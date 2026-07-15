import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";
import { isSessionInstallLayerPath, normalizeWorkspacePath } from "@persai/runtime-contract";

/**
 * ADR-150 — session install-layer basenames.
 * Basename excludes are only safe when the archive root *is* the session root
 * (session workspace.tar). Full `/workspace` mounts must use session-scoped
 * path excludes + path-aware purge so assistant `shared/.../node_modules`
 * survives pod↔CP tar.
 */
export const SESSION_INSTALL_LAYER_TAR_BASENAMES = [
  ".local",
  ".npm-global",
  "node_modules"
] as const;

/** Basename excludes for archives rooted at the session directory. */
export function buildSessionInstallLayerTarExcludeArgs(): string[] {
  return SESSION_INSTALL_LAYER_TAR_BASENAMES.map((name) => `--exclude=${name}`);
}

export function isSessionInstallLayerBasename(name: string): boolean {
  return (SESSION_INSTALL_LAYER_TAR_BASENAMES as readonly string[]).includes(name);
}

/**
 * Path-scoped excludes for archives rooted at /workspace (or a CP mirror of it).
 * Anchored under assistants/.../sessions/... so shared trees are kept.
 */
export function buildWorkspaceMountInstallLayerTarExcludeArgs(input?: {
  assistantId?: string | null;
  runtimeSessionId?: string | null;
}): string[] {
  const assistantId = input?.assistantId?.trim() ?? "";
  const runtimeSessionId = input?.runtimeSessionId?.trim() ?? "";
  const sessionPrefixes =
    assistantId.length > 0 && runtimeSessionId.length > 0
      ? [`assistants/${assistantId}/sessions/${runtimeSessionId}`]
      : ["assistants/*/sessions/*"];

  const args: string[] = [];
  for (const prefix of sessionPrefixes) {
    for (const name of SESSION_INSTALL_LAYER_TAR_BASENAMES) {
      const relativePath = `${prefix}/${name}`;
      args.push(`--exclude=${relativePath}`);
      args.push(`--exclude=./${relativePath}`);
    }
  }
  return args;
}

/**
 * Basename purge for a tree that is already the session root (snapshot staging
 * / session overlay destination). Every install basename under this root is
 * session install-layer by definition.
 */
export async function purgeSessionInstallLayerTrees(root: string): Promise<void> {
  const visit = async (currentDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const absolutePath = join(currentDir, entry.name);
      if (isSessionInstallLayerBasename(entry.name)) {
        await fs.rm(absolutePath, { recursive: true, force: true });
        continue;
      }
      await visit(absolutePath);
    }
  };
  await visit(root);
}

/**
 * Path-aware purge for a control-plane `/workspace` mount mirror.
 * Only removes directories whose visible `/workspace/...` path is
 * `isSessionInstallLayerPath` — shared `node_modules` is preserved.
 */
export async function purgeSessionInstallLayerInWorkspaceMount(
  workspaceRoot: string
): Promise<void> {
  const visit = async (currentDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const absolutePath = join(currentDir, entry.name);
      if (isSessionInstallLayerBasename(entry.name)) {
        const relativePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
        const visiblePath = normalizeWorkspacePath(
          relativePath.length === 0 ? "/workspace" : `/workspace/${relativePath}`
        );
        if (isSessionInstallLayerPath(visiblePath)) {
          await fs.rm(absolutePath, { recursive: true, force: true });
          continue;
        }
      }
      await visit(absolutePath);
    }
  };
  await visit(workspaceRoot);
}
