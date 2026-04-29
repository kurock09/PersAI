"use client";

import type { ResolvedTheme } from "./use-theme";

/**
 * Native bridge exposed by the persai-mobile shell.
 *
 * Desktop/browser web leaves this undefined; mobile shells can implement only
 * the methods they need while the web app keeps one capability-detected entry
 * point.
 */
export interface PersaiNativeBridge {
  setTheme?: (theme: string) => void;
  shareMedia?: (payloadJson: string) => boolean | void;
}

interface NativeMediaShareRequest {
  url: string;
  filename: string;
  title: string;
  userAgent: string;
}

function getNativeBridge(): PersaiNativeBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { PersaiNative?: PersaiNativeBridge }).PersaiNative;
}

export function syncNativeSystemBars(resolved: ResolvedTheme): void {
  const native = getNativeBridge();
  if (!native?.setTheme) return;
  try {
    native.setTheme(resolved);
  } catch {
    /* non-critical: bridge may not be ready immediately on cold-boot */
  }
}

export function tryNativeMediaShare(request: NativeMediaShareRequest): boolean {
  const native = getNativeBridge();
  if (!native?.shareMedia) return false;
  try {
    return native.shareMedia(JSON.stringify(request)) !== false;
  } catch {
    return false;
  }
}
