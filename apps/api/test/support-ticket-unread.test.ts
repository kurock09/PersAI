import assert from "node:assert/strict";
import test from "node:test";
import { computeSupportTicketHasUnread } from "../src/modules/workspace-management/application/support/support.types";

test("computeSupportTicketHasUnread is true when admin message is newer than read cursor", () => {
  const hasUnread = computeSupportTicketHasUnread({
    userLastReadAt: new Date("2026-05-22T10:00:00Z"),
    messages: [
      {
        author: "user",
        createdAt: new Date("2026-05-22T09:00:00Z")
      },
      {
        author: "admin",
        createdAt: new Date("2026-05-22T11:00:00Z")
      }
    ]
  });
  assert.equal(hasUnread, true);
});

test("computeSupportTicketHasUnread is false after user read cursor passes admin reply", () => {
  const hasUnread = computeSupportTicketHasUnread({
    userLastReadAt: new Date("2026-05-22T12:00:00Z"),
    messages: [
      {
        author: "admin",
        createdAt: new Date("2026-05-22T11:00:00Z")
      }
    ]
  });
  assert.equal(hasUnread, false);
});
