import assert from "node:assert/strict";
import test from "node:test";
import {
  supportPushReplyMessage,
  truncateSupportNotificationExcerpt
} from "../src/modules/workspace-management/application/support/support-user-messages";

test("supportPushReplyMessage includes reply excerpt when body is present", () => {
  assert.match(
    supportPushReplyMessage("en", "AB12", "Please reconnect Telegram in settings."),
    /Support · #AB12: Please reconnect Telegram/
  );
  assert.match(
    supportPushReplyMessage("ru", "AB12", "Попробуйте переподключить Telegram."),
    /Поддержка · #AB12: Попробуйте переподключить/
  );
});

test("supportPushReplyMessage falls back to settings hint when body is empty", () => {
  assert.match(supportPushReplyMessage("en", "AB12", ""), /assistant settings/i);
  assert.match(supportPushReplyMessage("ru", "AB12", "   "), /настройки ассистента/i);
});

test("truncateSupportNotificationExcerpt caps long replies", () => {
  const long = "a".repeat(300);
  const excerpt = truncateSupportNotificationExcerpt(long, 50);
  assert.equal(excerpt.length, 50);
  assert.ok(excerpt.endsWith("…"));
});
