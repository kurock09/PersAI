import assert from "node:assert/strict";
import { extractAssistantWebChatPlatformNotice } from "../src/modules/workspace-management/application/web-chat-message-state.mapper";

function run(): void {
  assert.deepEqual(
    extractAssistantWebChatPlatformNotice({
      kind: "safety_inbound_warn",
      reasonCode: "hack_abuse",
      moderationCaseId: "case-1"
    }),
    { kind: "safety_inbound_warn", reasonCode: "hack_abuse" }
  );
  assert.equal(extractAssistantWebChatPlatformNotice(null), null);
  assert.equal(extractAssistantWebChatPlatformNotice({ kind: "other" }), null);
}

run();
console.log("web-chat-message-state.mapper.test.ts: ok");
