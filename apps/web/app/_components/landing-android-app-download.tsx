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
        className="scale-[0.94] bg-surface-raised/20 text-text-subtle/70"
        copy={{ cta }}
      />
    </div>
  );
}
