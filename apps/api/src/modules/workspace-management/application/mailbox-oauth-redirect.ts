const CALLBACK_PATH = "/api/v1/public/integrations/email-mailbox/callback";
const APP_RETURN_PATH = "/app/chat";

/**
 * ADR-169 D11 — the redirect_uri sent in the authorization request must be
 * byte-identical to the one used at token-exchange time, and must match what
 * is registered with the provider console per environment. Resolved once
 * from a single env var so connect and callback can never drift apart.
 */
export function resolveMailboxOAuthCallbackRedirectUri(): string | null {
  // `PERSAI_PUBLIC_API_BASE_URL` is the one name actually wired in
  // `infra/helm` (`values.yaml`/`values-dev.yaml`) — a second accepted name
  // here would silently read as unset in every real environment.
  const raw = process.env.PERSAI_PUBLIC_API_BASE_URL?.trim() ?? "";
  if (!raw) {
    return null;
  }
  try {
    const base = new URL(raw);
    return new URL(CALLBACK_PATH, base).toString();
  } catch {
    return null;
  }
}

function resolveWebAppBaseUrl(): string | null {
  const raw = process.env.PERSAI_WEB_BASE_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

/**
 * Best-effort return target for the browser after the callback finishes.
 * Never throws: an unset PERSAI_WEB_BASE_URL degrades to an app-relative
 * redirect rather than stranding the OAuth round trip on a 500.
 */
export function buildMailboxConnectAppRedirectUrl(
  outcome: "success" | "smtp_access_required" | "error"
): string {
  const base = resolveWebAppBaseUrl();
  const path = `${APP_RETURN_PATH}?mailboxConnect=${outcome}`;
  return base === null ? path : `${base}${path}`;
}
