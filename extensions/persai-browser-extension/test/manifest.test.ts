import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("manifest optional host permissions support runtime per-origin grants", async () => {
  const manifestPath = resolve(import.meta.dirname, "..", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    optional_host_permissions?: string[];
    permissions?: string[];
  };

  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
  assert.equal(manifest.optional_host_permissions?.includes("<all_urls>"), false);
  assert.equal(manifest.permissions?.includes("<all_urls>"), false);
});
