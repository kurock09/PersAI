"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AndroidAppDownloadBanner } from "../../_components/android-app-download-banner";

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

export function AssistantSettingsApkFooter() {
  const t = useTranslations("settings");
  const [nativeShell, setNativeShell] = useState(false);

  useEffect(() => {
    setNativeShell(isNativeShell());
  }, []);

  return (
    <AndroidAppDownloadBanner
      tone="utility"
      className="w-full"
      copy={{
        cta: nativeShell ? t("androidAppUpdateCta") : t("androidAppCta")
      }}
    />
  );
}
