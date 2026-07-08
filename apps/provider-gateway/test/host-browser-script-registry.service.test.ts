import assert from "node:assert/strict";
import { HostBrowserScriptRegistryService } from "../src/modules/providers/host-browser-script-registry.service";

export async function runHostBrowserScriptRegistryServiceTest(): Promise<void> {
  const registry = new HostBrowserScriptRegistryService();
  const hosts = registry.listRegisteredHosts();
  assert.ok(hosts.includes("lavka.yandex.ru"));

  const lavkaScript = registry.resolveScriptSourceForHostname("lavka.yandex.ru");
  assert.ok(typeof lavkaScript === "string" && lavkaScript.length > 0);
  assert.match(lavkaScript, /product-card/);
  assert.match(lavkaScript, /return \{ elements \}/);

  const fromUrl = registry.resolveScriptSourceForUrl("https://lavka.yandex.ru/search?text=test");
  assert.equal(fromUrl, lavkaScript);

  const fromGoto = registry.resolveScriptSourceForBrowserAction("https://example.com/", [
    { kind: "goto", url: "https://lavka.yandex.ru/catalog" }
  ]);
  assert.equal(fromGoto, lavkaScript);

  assert.equal(registry.resolveScriptSourceForHostname("example.com"), null);
}
