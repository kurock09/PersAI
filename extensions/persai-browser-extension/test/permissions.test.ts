import test from "node:test";
import assert from "node:assert/strict";
import { buildOriginPermissionPattern, isPersaiWebOrigin, listCommandOriginPatterns, normalizeApiBaseUrl } from "../src/permissions.js";

test("normalizeApiBaseUrl trims trailing api path", () => {
  assert.equal(normalizeApiBaseUrl("https://persai.dev/api/v1/"), "https://persai.dev");
  assert.equal(normalizeApiBaseUrl("http://localhost:3001"), "http://localhost:3001");
});

test("buildOriginPermissionPattern accepts http and https URLs", () => {
  assert.equal(buildOriginPermissionPattern("https://lavka.yandex.ru/catalog"), "https://lavka.yandex.ru/*");
  assert.equal(buildOriginPermissionPattern("http://localhost:3000/app"), "http://localhost:3000/*");
  assert.equal(buildOriginPermissionPattern("chrome://settings"), null);
});

test("listCommandOriginPatterns includes root URL and goto operations", () => {
  const patterns = listCommandOriginPatterns({
    commandId: "cmd-1",
    profileKey: "lavka",
    action: "act",
    url: "https://lavka.yandex.ru/",
    operations: [
      { kind: "goto", url: "https://example.com/path" },
      { kind: "click", selector: "button.buy" }
    ]
  });
  assert.deepEqual(patterns, ["https://lavka.yandex.ru/*", "https://example.com/*"]);
});

test("isPersaiWebOrigin only accepts configured PersAI web hosts", () => {
  assert.equal(isPersaiWebOrigin("https://persai.dev/app"), true);
  assert.equal(isPersaiWebOrigin("http://localhost:3000/app"), true);
  assert.equal(isPersaiWebOrigin("https://api.persai.dev/api/v1"), false);
});
