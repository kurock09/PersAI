import assert from "node:assert/strict";
import test from "node:test";
import { supportPushReplyMessage } from "../src/modules/workspace-management/application/support/support-user-messages";

test("supportPushReplyMessage localizes push copy", () => {
  assert.match(supportPushReplyMessage("en", "AB12"), /assistant settings/i);
  assert.match(supportPushReplyMessage("ru", "AB12"), /настройки ассистента/i);
});
