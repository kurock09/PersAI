import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMissingProfileWindow,
  consumePendingCompletion,
  createEmptyState,
  listAwaitingCompletionProfiles,
  resolvePendingCompletion,
  setAwaitingCompletion,
  setProfileVisibility,
  storeRegistration,
  upsertProfileRecord
} from "../src/profile-state.js";

test("upsertProfileRecord stores window and tab mapping", () => {
  const next = upsertProfileRecord(createEmptyState(), "lavka", {
    windowId: 41,
    tabId: 73,
    lastKnownUrl: "https://lavka.yandex.ru/",
    visible: false,
    updatedAt: 1
  });
  assert.deepEqual(next.profiles.lavka, {
    profileKey: "lavka",
    windowId: 41,
    tabId: 73,
    lastKnownUrl: "https://lavka.yandex.ru/",
    visible: false,
    updatedAt: 1
  });
  assert.equal(next.lastProfileKey, "lavka");
});

test("setProfileVisibility preserves mapping while toggling visibility", () => {
  const seeded = upsertProfileRecord(createEmptyState(), "lavka", {
    windowId: 12,
    tabId: 13,
    visible: false,
    updatedAt: 1
  });
  const visible = setProfileVisibility(seeded, "lavka", true, 2);
  assert.equal(visible.profiles.lavka?.windowId, 12);
  assert.equal(visible.profiles.lavka?.tabId, 13);
  assert.equal(visible.profiles.lavka?.visible, true);
  assert.equal(visible.profiles.lavka?.updatedAt, 2);
});

test("clearMissingProfileWindow clears stale window references", () => {
  const seeded = upsertProfileRecord(createEmptyState(), "lavka", {
    windowId: 12,
    tabId: 13,
    visible: true,
    updatedAt: 1
  });
  const cleared = clearMissingProfileWindow(seeded, "lavka", 9);
  assert.equal(cleared.profiles.lavka?.windowId, null);
  assert.equal(cleared.profiles.lavka?.tabId, null);
  assert.equal(cleared.profiles.lavka?.visible, false);
  assert.equal(cleared.profiles.lavka?.updatedAt, 9);
});

test("setAwaitingCompletion marks a profile and clears any stale pending action", () => {
  const seeded = resolvePendingCompletion(
    upsertProfileRecord(createEmptyState(), "lavka", { visible: true, updatedAt: 1 }),
    "lavka",
    "cancel",
    2
  );
  assert.equal(seeded.profiles.lavka?.pendingCompletionAction, "cancel");

  const awaiting = setAwaitingCompletion(seeded, "lavka", true, 3);
  assert.equal(awaiting.profiles.lavka?.awaitingCompletion, true);
  assert.equal(awaiting.profiles.lavka?.pendingCompletionAction, null);
  assert.deepEqual(listAwaitingCompletionProfiles(awaiting), [
    { profileKey: "lavka", lastKnownUrl: null }
  ]);
});

test("resolvePendingCompletion records the popup decision and clears awaiting state", () => {
  const awaiting = setAwaitingCompletion(
    upsertProfileRecord(createEmptyState(), "lavka", {
      lastKnownUrl: "https://lavka.yandex.ru/",
      updatedAt: 1
    }),
    "lavka",
    true,
    2
  );
  const resolved = resolvePendingCompletion(awaiting, "lavka", "complete", 3);
  assert.equal(resolved.profiles.lavka?.awaitingCompletion, false);
  assert.equal(resolved.profiles.lavka?.pendingCompletionAction, "complete");
  assert.deepEqual(listAwaitingCompletionProfiles(resolved), []);
});

test("consumePendingCompletion reads the action once and clears it", () => {
  const resolved = resolvePendingCompletion(createEmptyState(), "lavka", "complete", 1);
  const first = consumePendingCompletion(resolved, "lavka");
  assert.equal(first.action, "complete");
  assert.equal(first.state.profiles.lavka?.pendingCompletionAction, null);

  const second = consumePendingCompletion(first.state, "lavka");
  assert.equal(second.action, null);
});

test("storeRegistration keeps the latest bridge device details", () => {
  const next = storeRegistration(createEmptyState(), {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    bridgeDeviceId: "device-1",
    deviceKind: "extension",
    deviceToken: "token-1",
    websocketUrl: "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws",
    updatedAt: 10
  });
  assert.equal(next.registration?.bridgeDeviceId, "device-1");
  assert.equal(next.registration?.deviceToken, "token-1");
});
