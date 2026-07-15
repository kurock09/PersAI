import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildSessionInstallLayerTarExcludeArgs,
  buildWorkspaceMountInstallLayerTarExcludeArgs,
  purgeSessionInstallLayerInWorkspaceMount,
  purgeSessionInstallLayerTrees
} from "../src/session-install-layer-tar";

test("buildSessionInstallLayerTarExcludeArgs covers ADR-150 basenames for session-root archives", () => {
  assert.deepEqual(buildSessionInstallLayerTarExcludeArgs(), [
    "--exclude=.local",
    "--exclude=.npm-global",
    "--exclude=node_modules"
  ]);
});

test("buildWorkspaceMountInstallLayerTarExcludeArgs anchors under session roots only", () => {
  assert.deepEqual(
    buildWorkspaceMountInstallLayerTarExcludeArgs({
      assistantId: "assistant-1",
      runtimeSessionId: "session-1"
    }),
    [
      "--exclude=assistants/assistant-1/sessions/session-1/.local",
      "--exclude=./assistants/assistant-1/sessions/session-1/.local",
      "--exclude=assistants/assistant-1/sessions/session-1/.npm-global",
      "--exclude=./assistants/assistant-1/sessions/session-1/.npm-global",
      "--exclude=assistants/assistant-1/sessions/session-1/node_modules",
      "--exclude=./assistants/assistant-1/sessions/session-1/node_modules"
    ]
  );
  const wild = buildWorkspaceMountInstallLayerTarExcludeArgs();
  assert.ok(wild.some((arg) => arg.includes("assistants/*/sessions/*/.local")));
  assert.ok(!wild.some((arg) => arg === "--exclude=node_modules"));
});

test("purgeSessionInstallLayerTrees removes install dirs under a session-root archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "persai-adr150-purge-"));
  try {
    await mkdir(join(root, ".local", "lib"), { recursive: true });
    await writeFile(join(root, ".local", "lib", "x.py"), "x");
    await mkdir(join(root, "pkg", "node_modules", "dep"), { recursive: true });
    await writeFile(join(root, "pkg", "node_modules", "dep", "index.js"), "1");
    await mkdir(join(root, "work"), { recursive: true });
    await writeFile(join(root, "work", "report.pdf"), "pdf");

    await purgeSessionInstallLayerTrees(root);

    await assert.rejects(() => access(join(root, ".local")), /ENOENT/);
    await assert.rejects(() => access(join(root, "pkg", "node_modules")), /ENOENT/);
    await access(join(root, "work", "report.pdf"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("purgeSessionInstallLayerInWorkspaceMount keeps shared node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "persai-adr150-mount-"));
  try {
    const sessionLocal = join(
      root,
      "assistants",
      "assistant-1",
      "sessions",
      "session-1",
      ".local",
      "lib"
    );
    const sessionNestedModules = join(
      root,
      "assistants",
      "assistant-1",
      "sessions",
      "session-1",
      "pkg",
      "node_modules",
      "dep"
    );
    const sharedModules = join(
      root,
      "assistants",
      "assistant-1",
      "shared",
      "project",
      "node_modules",
      "dep"
    );
    await mkdir(sessionLocal, { recursive: true });
    await writeFile(join(sessionLocal, "x.py"), "x");
    await mkdir(sessionNestedModules, { recursive: true });
    await writeFile(join(sessionNestedModules, "index.js"), "1");
    await mkdir(sharedModules, { recursive: true });
    await writeFile(join(sharedModules, "index.js"), "shared");

    await purgeSessionInstallLayerInWorkspaceMount(root);

    await assert.rejects(
      () => access(join(root, "assistants", "assistant-1", "sessions", "session-1", ".local")),
      /ENOENT/
    );
    await assert.rejects(
      () =>
        access(
          join(root, "assistants", "assistant-1", "sessions", "session-1", "pkg", "node_modules")
        ),
      /ENOENT/
    );
    await access(join(sharedModules, "index.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
