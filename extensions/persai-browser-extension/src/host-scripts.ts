import type { LocalBrowserCommand } from "./contract.js";

interface HostBrowserScriptRegistryFile {
  hosts?: Record<string, string>;
}

let registryPromise: Promise<Map<string, string>> | null = null;
const scriptCache = new Map<string, string | null>();

function toHostnames(command: LocalBrowserCommand): string[] {
  const hostnames = new Set<string>();
  const addHostname = (urlLike: string | null | undefined): void => {
    if (typeof urlLike !== "string" || urlLike.length === 0) {
      return;
    }
    try {
      hostnames.add(new URL(urlLike).hostname.trim().toLowerCase());
    } catch {
      // Ignore invalid URLs; runtime validation lives elsewhere.
    }
  };
  addHostname(command.url ?? null);
  for (const operation of command.operations ?? []) {
    if (operation.kind === "goto") {
      addHostname(operation.url);
    }
  }
  return [...hostnames];
}

async function readRegistry(): Promise<Map<string, string>> {
  if (registryPromise !== null) {
    return registryPromise;
  }
  registryPromise = (async () => {
    const response = await fetch(chrome.runtime.getURL("browser-sites/registry.json"));
    const json = (await response.json()) as HostBrowserScriptRegistryFile;
    return new Map(
      Object.entries(json.hosts ?? {}).map(([host, filename]) => [host.trim().toLowerCase(), filename.trim()])
    );
  })();
  return registryPromise;
}

export async function resolveHostScriptSource(command: LocalBrowserCommand): Promise<string | null> {
  const registry = await readRegistry();
  for (const hostname of toHostnames(command)) {
    const filename = registry.get(hostname);
    if (!filename) {
      continue;
    }
    const cacheKey = `${hostname}:${filename}`;
    if (scriptCache.has(cacheKey)) {
      return scriptCache.get(cacheKey) ?? null;
    }
    const response = await fetch(chrome.runtime.getURL(`browser-sites/${filename}`));
    if (!response.ok) {
      scriptCache.set(cacheKey, null);
      return null;
    }
    const source = (await response.text()).trim();
    scriptCache.set(cacheKey, source.length > 0 ? source : null);
    return source.length > 0 ? source : null;
  }
  return null;
}
