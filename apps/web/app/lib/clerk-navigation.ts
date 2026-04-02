/**
 * After Clerk sign-in/up, use a full document navigation so session cookies are
 * included on the next HTTP request. Client `router.push` can race ahead of
 * cookie persistence (especially on mobile), causing server `auth()` on `/app` to
 * redirect to sign-in while the client already considers the user signed in.
 */
export function navigateAfterClerkAuth(url: string, mode: "assign" | "replace" = "assign"): void {
  if (typeof window === "undefined") return;
  if (mode === "replace") {
    window.location.replace(url);
  } else {
    window.location.assign(url);
  }
}

/** Safe in-app path from `?redirect_url=` (open redirect hardening). */
export function getSafeRedirectPathFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("redirect_url");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const pathOnly = raw.split("?")[0] ?? "";
  if (pathOnly.includes("\\") || pathOnly.includes("//")) return null;
  if (!pathOnly.startsWith("/app") && !pathOnly.startsWith("/admin")) return null;
  return raw;
}
