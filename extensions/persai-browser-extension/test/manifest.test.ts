import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("manifest keeps broad screenshot access optional and user-granted", async () => {
  const manifestPath = resolve(import.meta.dirname, "..", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    optional_host_permissions?: string[];
    permissions?: string[];
  };

  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  assert.equal(manifest.permissions?.includes("<all_urls>"), false);
});
