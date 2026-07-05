import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBootstrapHydrateSubPaths,
  buildSharedOnlyHydrateSubPath,
  collectOnDemandHydratePaths,
  isWithinBootstrapHydrateScope,
  toWorkspaceGcsSubPath
} from "../src/workspace-mount-hydrate";
import { classifyVisibleWorkspacePath } from "@persai/runtime-contract";

test("workspace-mount-hydrate: bootstrap subpaths are session + shared only", () => {
  const subPaths = buildBootstrapHydrateSubPaths({
    assistantId: "assistant-1",
    runtimeSessionId: "session-1"
  });
  assert.deepEqual(subPaths, [
    { scope: "session", subPath: "assistants/assistant-1/sessions/session-1" },
    { scope: "shared", subPath: "assistants/assistant-1/shared" }
  ]);
  assert.equal(buildSharedOnlyHydrateSubPath("assistant-1"), "assistants/assistant-1/shared");
});

test("workspace-mount-hydrate: on-demand paths skip bootstrap scope", () => {
  const assistantId = "assistant-1";
  const runtimeSessionId = "session-1";
  const inSession = `/workspace/assistants/${assistantId}/sessions/${runtimeSessionId}/report.txt`;
  const inShared = `/workspace/assistants/${assistantId}/shared/template.md`;
  const otherSession = `/workspace/assistants/${assistantId}/sessions/other-session/data.csv`;

  assert.equal(
    collectOnDemandHydratePaths({
      assistantId,
      runtimeSessionId,
      visiblePaths: [inSession, inShared]
    }).length,
    0
  );

  const onDemand = collectOnDemandHydratePaths({
    assistantId,
    runtimeSessionId,
    visiblePaths: [otherSession]
  });
  assert.deepEqual(onDemand, [toWorkspaceGcsSubPath(otherSession)]);
});

test("workspace-mount-hydrate: empty workspace root is not collected for on-demand hydrate", () => {
  const assistantId = "assistant-1";
  const runtimeSessionId = "session-1";
  assert.deepEqual(
    collectOnDemandHydratePaths({
      assistantId,
      runtimeSessionId,
      visiblePaths: ["/workspace"]
    }),
    []
  );
});

test("workspace-mount-hydrate: bootstrap scope classification", () => {
  const assistantId = "assistant-1";
  const runtimeSessionId = "session-1";
  const sessionInfo = classifyVisibleWorkspacePath(
    `/workspace/assistants/${assistantId}/sessions/${runtimeSessionId}/nested/file.txt`
  );
  const sharedInfo = classifyVisibleWorkspacePath(
    `/workspace/assistants/${assistantId}/shared/asset.png`
  );
  const otherSessionInfo = classifyVisibleWorkspacePath(
    `/workspace/assistants/${assistantId}/sessions/other/file.txt`
  );

  assert.equal(isWithinBootstrapHydrateScope(sessionInfo, assistantId, runtimeSessionId), true);
  assert.equal(isWithinBootstrapHydrateScope(sharedInfo, assistantId, runtimeSessionId), true);
  assert.equal(
    isWithinBootstrapHydrateScope(otherSessionInfo, assistantId, runtimeSessionId),
    false
  );
});
