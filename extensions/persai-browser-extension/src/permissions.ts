import type { LocalBrowserCommand } from "./contract.js";
import { PERSAI_WEB_ORIGIN_PATTERNS } from "./constants.js";

const SUPPORTED_SCHEMES = new Set(["http:", "https:"]);

export function normalizeApiBaseUrl(input: string): string {
  return input.trim().replace(/\/$/, "").replace(/\/api\/v1$/, "");
}

export function buildOriginPermissionPattern(urlLike: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlLike);
  } catch {
    return null;
  }
  if (!SUPPORTED_SCHEMES.has(parsed.protocol)) {
    return null;
  }
  return `${parsed.origin}/*`;
}

export function listCommandOriginPatterns(
  command: LocalBrowserCommand,
  currentUrl?: string | null
): string[] {
  const patterns = new Set<string>();
  const candidates: string[] = [];
  if (typeof currentUrl === "string" && currentUrl.length > 0) {
    candidates.push(currentUrl);
  }
  if (typeof command.url === "string" && command.url.length > 0) {
    candidates.push(command.url);
  }
  for (const operation of command.operations ?? []) {
    if (operation.kind === "goto") {
      candidates.push(operation.url);
    }
  }
  for (const candidate of candidates) {
    const pattern = buildOriginPermissionPattern(candidate);
    if (pattern !== null) {
      patterns.add(pattern);
    }
  }
  return [...patterns];
}

export function isPersaiWebOrigin(urlLike: string | null | undefined): boolean {
  if (typeof urlLike !== "string" || urlLike.length === 0) {
    return false;
  }
  try {
    const parsed = new URL(urlLike);
    return PERSAI_WEB_ORIGIN_PATTERNS.some((pattern) => {
      const normalized = pattern.replace("/*", "");
      try {
        const allowed = new URL(normalized);
        return allowed.protocol === parsed.protocol && allowed.hostname === parsed.hostname;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
