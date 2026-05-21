import assert from "node:assert/strict";
import test from "node:test";
import renderSupportReply from "../src/modules/workspace-management/application/notifications/templates/support/support-reply.template";

test("support.reply template renders ru subject and billing-style html shell", () => {
  const rendered = renderSupportReply(
    {
      locale: "ru",
      ticketShortId: "AB12CD34",
      replyBody: "Попробуйте переподключить Telegram."
    },
    "ru"
  );
  assert.match(rendered.subject, /Ответ поддержки PersAI/);
  assert.match(rendered.subject, /AB12CD34/);
  assert.match(rendered.plainText, /Попробуйте переподключить Telegram/);
  assert.match(rendered.html, /fefbf7/);
  assert.match(rendered.html, /PersAI/);
});

test("support.reply template renders en copy", () => {
  const rendered = renderSupportReply(
    {
      locale: "en",
      ticketShortId: "AB12CD34",
      replyBody: "Please reconnect Telegram."
    },
    "en"
  );
  assert.match(rendered.subject, /PersAI support reply/);
  assert.match(rendered.plainText, /Please reconnect Telegram/);
  assert.match(rendered.html, /Support replied to your request/);
});
