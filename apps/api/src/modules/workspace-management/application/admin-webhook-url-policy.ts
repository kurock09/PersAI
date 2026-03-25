import { isIP } from "node:net";

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && (second === 0 || second === 168)) {
    return true;
  }
  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }
  if (first >= 224) {
    return true;
  }
  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa")
  ) {
    return true;
  }

  const version = isIP(normalized);
  if (version === 4) {
    return isPrivateIpv4(normalized);
  }
  if (version === 6) {
    return isBlockedIpv6(normalized);
  }

  return false;
}

export function assertPublicWebhookUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Webhook endpointUrl must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook endpointUrl must use http or https.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("Webhook endpointUrl must not embed credentials.");
  }
  if (parsed.hostname.trim().length === 0 || isBlockedHostname(parsed.hostname)) {
    throw new Error("Webhook endpointUrl must target a public host.");
  }
}
