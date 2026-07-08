import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type { RuntimeBrowserOperation } from "@persai/runtime-contract";

interface HostBrowserScriptRegistryFile {
  version?: number;
  hosts?: Record<string, string>;
}

@Injectable()
export class HostBrowserScriptRegistryService {
  private readonly logger = new Logger(HostBrowserScriptRegistryService.name);
  private loaded = false;
  private scriptsRoot: string | null = null;
  private hostToFilename = new Map<string, string>();
  private scriptCache = new Map<string, string>();

  resolveScriptSourceForUrl(url: string): string | null {
    const hostname = this.readHostname(url);
    return hostname === null ? null : this.resolveScriptSourceForHostname(hostname);
  }

  resolveScriptSourceForBrowserAction(
    url: string,
    operations: RuntimeBrowserOperation[]
  ): string | null {
    const hostnames = new Set<string>();
    const primary = this.readHostname(url);
    if (primary !== null) {
      hostnames.add(primary);
    }
    for (const operation of operations) {
      if (operation.kind !== "goto") {
        continue;
      }
      const hostname = this.readHostname(operation.url);
      if (hostname !== null) {
        hostnames.add(hostname);
      }
    }
    for (const hostname of hostnames) {
      const script = this.resolveScriptSourceForHostname(hostname);
      if (script !== null) {
        return script;
      }
    }
    return null;
  }

  resolveScriptSourceForHostname(hostname: string): string | null {
    this.ensureLoaded();
    const normalizedHost = hostname.trim().toLowerCase();
    const filename = this.hostToFilename.get(normalizedHost);
    if (filename === undefined || this.scriptsRoot === null) {
      return null;
    }
    const cacheKey = `${normalizedHost}:${filename}`;
    const cached = this.scriptCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const scriptPath = join(this.scriptsRoot, filename);
    if (!existsSync(scriptPath)) {
      this.logger.warn(`Host browser script missing for ${normalizedHost}: ${scriptPath}`);
      return null;
    }
    const source = readFileSync(scriptPath, "utf8").trim();
    if (source.length === 0) {
      return null;
    }
    this.scriptCache.set(cacheKey, source);
    return source;
  }

  listRegisteredHosts(): string[] {
    this.ensureLoaded();
    return [...this.hostToFilename.keys()].sort();
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const root = this.resolveScriptsRoot();
    if (root === null) {
      this.logger.warn("Host browser scripts root not found; host page.elements hook disabled.");
      return;
    }
    const registryPath = join(root, "registry.json");
    if (!existsSync(registryPath)) {
      this.logger.warn(`Host browser script registry missing: ${registryPath}`);
      return;
    }
    let parsed: HostBrowserScriptRegistryFile;
    try {
      parsed = JSON.parse(readFileSync(registryPath, "utf8")) as HostBrowserScriptRegistryFile;
    } catch (error) {
      this.logger.warn(
        `Host browser script registry parse failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      return;
    }
    const hosts = parsed.hosts ?? {};
    for (const [host, filename] of Object.entries(hosts)) {
      const normalizedHost = host.trim().toLowerCase();
      const normalizedFilename = filename.trim();
      if (normalizedHost.length === 0 || normalizedFilename.length === 0) {
        continue;
      }
      this.hostToFilename.set(normalizedHost, normalizedFilename);
    }
    this.scriptsRoot = root;
    this.logger.log(
      `Host browser script registry loaded (${String(this.hostToFilename.size)} hosts) from ${root}`
    );
  }

  private resolveScriptsRoot(): string | null {
    const candidates = [
      join(process.cwd(), "scripts/browser-sites"),
      join(process.cwd(), "../../scripts/browser-sites"),
      join(__dirname, "../../../../../scripts/browser-sites"),
      join(__dirname, "../../../../../../scripts/browser-sites")
    ];
    for (const candidate of candidates) {
      if (existsSync(join(candidate, "registry.json"))) {
        return candidate;
      }
    }
    return null;
  }

  private readHostname(url: string): string | null {
    try {
      return new URL(url).hostname.trim().toLowerCase();
    } catch {
      return null;
    }
  }
}
