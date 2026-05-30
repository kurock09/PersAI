import assert from "node:assert/strict";
import {
  isElevatedAssistantChatMode,
  normalizeAssistantChatModeForPaidLightMode
} from "../src/modules/workspace-management/domain/assistant-chat.entity";

async function run(): Promise<void> {
  assert.equal(isElevatedAssistantChatMode("smart"), true);
  assert.equal(isElevatedAssistantChatMode("project"), true);
  assert.equal(isElevatedAssistantChatMode("normal"), false);

  assert.equal(normalizeAssistantChatModeForPaidLightMode("smart", false), "smart");
  assert.equal(normalizeAssistantChatModeForPaidLightMode("project", true), "normal");
  assert.equal(normalizeAssistantChatModeForPaidLightMode(undefined, true), undefined);
}

void run()
  .then(() => {
    console.log("assistant-chat-light-mode.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
