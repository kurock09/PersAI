import test from "node:test";
import assert from "node:assert/strict";
import { buildChatFileUrl, extensionForMime } from "../src/chat-deliverables.js";

void test("buildChatFileUrl uses full download path", () => {
  assert.equal(
    buildChatFileUrl({
      chatId: "c1",
      path: "/workspace/foo.png",
      variant: "full"
    }),
    "/api/v1/assistant/chats/web/c1/files?path=%2Fworkspace%2Ffoo.png"
  );
});

void test("extensionForMime maps png", () => {
  assert.equal(extensionForMime("image/png", "slide.png"), "slide.png");
});
