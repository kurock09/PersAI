"use client";

import { useEffect, useState } from "react";
import { AndroidAppDownloadBanner } from "./android-app-download-banner";

function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const maybeNative = window as unknown as {
    PersaiNative?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return Boolean(
    maybeNative.PersaiNative ||
    (typeof maybeNative.Capacitor?.isNativePlatform === "function" &&
      maybeNative.Capacitor.isNativePlatform())
  );
}

export function LandingAndroidAppDownload({ cta }: { cta: string }) {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    setShouldShow(!isNativeShell());
  }, []);

  if (!shouldShow) {
    return null;
  }

  return (
    <div className="mb-4 flex justify-center">
      <AndroidAppDownloadBanner
        className="scale-[0.96] border-white/[0.055] bg-surface-raised/25 text-text-subtle/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_28px_rgba(0,0,0,0.14)] hover:bg-surface-raised/40 hover:text-text-muted"
        copy={{ cta }}
      />
    </div>
  );
}
