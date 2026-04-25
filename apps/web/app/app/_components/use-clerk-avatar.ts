"use client";

import { useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_RELOAD_FLAG = "persai-clerk-user-reloaded";

/**
 * Robust Clerk avatar URL resolver.
 *
 * Why this hook exists (founder report 2026-04-25 «аватарка clerk не работает
 * или работает через раз все очень нестабильно»):
 *  1. `user.imageUrl` encodes the org-level "default avatar" customization
 *     (background gradient + foreground silhouette/initials) as part of the
 *     URL itself. After a dashboard change the URL is only refreshed on the
 *     next user fetch — until then the SDK keeps serving the previous image.
 *     We trigger one explicit `user.reload()` per browser session so the
 *     customization becomes visible without sign-out / cache wipe.
 *  2. Clerk's CDN tells browsers to cache `img.clerk.com` responses for ~24h
 *     (`Cache-Control: public, max-age=86400`). We append a per-day cache
 *     buster so a customization change appears within a day on every device
 *     instead of "whenever the cache TTL expires from first-fetch time".
 *  3. The CDN occasionally returns transient 5xx / DNS-blip errors. Falling
 *     straight to initials on the first failure is what the founder saw as
 *     "работает через раз" — we retry once with a fresh buster before
 *     surfacing the initials fallback so the avatar doesn't flicker.
 *
 * Returns the URL the caller should render in `<img src>`, plus an `onError`
 * handler that drives the retry-then-fallback state machine and a `broken`
 * flag the caller uses to render initials when both attempts fail.
 */
export function useClerkAvatar(): {
  imageSrc: string | null;
  broken: boolean;
  onError: () => void;
} {
  const { user } = useUser();
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  const reloadedRef = useRef(false);

  const todayBucket = new Date().toISOString().slice(0, 10);
  const rawImageUrl = user?.imageUrl ?? null;

  useEffect(() => {
    if (!user || reloadedRef.current || typeof window === "undefined") {
      return;
    }
    if (window.sessionStorage.getItem(SESSION_RELOAD_FLAG) === "1") {
      reloadedRef.current = true;
      return;
    }
    window.sessionStorage.setItem(SESSION_RELOAD_FLAG, "1");
    reloadedRef.current = true;
    // `user.reload()` is `Promise<UserResource>` in production; in unit tests
    // `vi.fn()` may return `undefined`, so we coerce through `Promise.resolve`
    // before attaching `.catch`. Reloading is best-effort: if Clerk is
    // unreachable we keep the cached user object — the regular render path
    // still produces a valid URL.
    void Promise.resolve(user.reload?.()).catch(() => {});
  }, [user]);

  useEffect(() => {
    setAttempt(0);
    setBroken(false);
  }, [rawImageUrl, todayBucket]);

  const onError = useCallback(() => {
    setAttempt((current) => {
      if (current === 0) {
        return 1;
      }
      setBroken(true);
      return current;
    });
  }, []);

  if (rawImageUrl === null || rawImageUrl.trim().length === 0 || broken) {
    return { imageSrc: null, broken, onError };
  }

  const updatedAt =
    user?.updatedAt instanceof Date ? user.updatedAt.getTime() : (user?.updatedAt ?? "u");
  const separator = rawImageUrl.includes("?") ? "&" : "?";
  const imageSrc = `${rawImageUrl}${separator}v=${String(updatedAt)}-${todayBucket}-${attempt}`;
  return { imageSrc, broken, onError };
}
