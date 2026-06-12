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
  saveMedia?: (payloadJson: string) => boolean | void;
}

export interface NativeMediaTransferRequest {
  url: string;
  filename: string;
  title: string;
  userAgent: string;
  mimeType?: string | undefined;
  sessionToken?: string | undefined;
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

function tryNativeMediaAction(
  request: NativeMediaTransferRequest,
  action: "shareMedia" | "saveMedia"
): boolean {
  const native = getNativeBridge();
  if (!native) return false;
  const handler = native[action];
  if (typeof handler !== "function") return false;
  try {
    return Reflect.apply(handler, native, [JSON.stringify(request)]) !== false;
  } catch {
    return false;
  }
}

export function tryNativeMediaShare(request: NativeMediaTransferRequest): boolean {
  return tryNativeMediaAction(request, "shareMedia");
}

export function tryNativeMediaSave(request: NativeMediaTransferRequest): boolean {
  return tryNativeMediaAction(request, "saveMedia");
}
