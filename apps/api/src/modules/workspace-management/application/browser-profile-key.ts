import { __ASSISTANT_HANDLE_INTERNALS, generateAssistantHandle } from "./assistant-handle";

const PROFILE_KEY_MAX_LENGTH = 128;

function applyProfileKeySuffix(base: string, n: number): string {
  if (n <= 0) {
    return base;
  }
  const suffix = `-${n}`;
  const room = PROFILE_KEY_MAX_LENGTH - suffix.length;
  const trimmed = base.slice(0, Math.max(1, room)).replace(/-+$/g, "");
  const safeBase = trimmed.length > 0 ? trimmed : base.slice(0, 1) || "profile";
  return `${safeBase}${suffix}`;
}

export function generateBrowserProfileKeyBase(
  displayName: string | null | undefined,
  fallbackSeed: string
): string {
  const slugified = __ASSISTANT_HANDLE_INTERNALS.slugify(displayName ?? "");
  if (slugified.length > 0) {
    return slugified.slice(0, PROFILE_KEY_MAX_LENGTH).replace(/-+$/g, "");
  }
  return generateAssistantHandle(displayName, fallbackSeed);
}

export function ensureBrowserProfileKeyUnique(
  existingKeys: readonly string[],
  base: string
): string {
  const safeBase = base.slice(0, PROFILE_KEY_MAX_LENGTH) || "profile";
  const taken = new Set(existingKeys);
  if (!taken.has(safeBase)) {
    return safeBase;
  }
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = applyProfileKeySuffix(safeBase, n);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`ensureBrowserProfileKeyUnique exhausted suffixes for base=${safeBase}`);
}

export function parseBrowserLoginOriginHost(loginUrl: string): string {
  const url = new URL(loginUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("loginUrl must use http or https.");
  }
  const hostname = url.hostname.trim().toLowerCase();
  if (hostname.length === 0) {
    throw new Error("loginUrl must include a hostname.");
  }
  return hostname.slice(0, 255);
}
