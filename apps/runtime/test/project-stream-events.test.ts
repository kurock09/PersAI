import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import {
  createProjectModeBootstrapStreamEvents,
  createProjectModeReplanStreamEvents,
  createProjectModeSynthesisStreamEvents,
  isProjectChatMode
} from "../src/modules/turns/project-execution-profile";

function createRequest(chatMode: NonNullable<RuntimeTurnRequest["chatMode"]>): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    idempotencyKey: "idem-1",
    runtimeTier: "paid_shared_restricted",
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "conversation-1",
      externalUserKey: null,
      mode: "direct"
    },
    bundle: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bundleId: "bundle-1",
      bundleHash: "bundle-hash-1",
      publishedVersionId: "version-1",
      compiledAt: "2026-04-18T12:00:00.000Z"
    },
    message: {
      text: "Analyze the project pack.",
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-04-18T12:00:00.000Z"
    },
    deepMode: true,
    chatMode
  };
}

describe("project stream events", () => {
  test("emits bounded project activity and reasoning summary events for project mode helpers", () => {
    const identity = { requestId: "request-1", sessionId: "session-1" };
    const bootstrap = createProjectModeBootstrapStreamEvents(identity);
    assert.ok(
      bootstrap.some((event) => event.type === "project_activity" && event.stage === "plan")
    );
    assert.equal(bootstrap.length, 1);

    const replan = createProjectModeReplanStreamEvents({ identity, pass: 2 });
    assert.ok(
      replan.some((event) => event.type === "project_activity" && event.stage === "replan")
    );
    assert.ok(
      replan.some(
        (event) => event.type === "project_activity" && event.summary === "Gathering more evidence"
      )
    );

    const synthesis = createProjectModeSynthesisStreamEvents(identity);
    assert.ok(
      synthesis.some((event) => event.type === "project_activity" && event.stage === "synthesize")
    );
    assert.equal(synthesis.length, 1);
  });

  test("does not treat ordinary chat modes as project mode", () => {
    assert.equal(isProjectChatMode(createRequest("normal")), false);
    assert.equal(isProjectChatMode(createRequest("smart")), false);
    assert.equal(isProjectChatMode(createRequest("project")), true);
  });
});
