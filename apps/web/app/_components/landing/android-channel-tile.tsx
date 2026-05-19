"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import androidRelease from "../../_data/android-release.json";

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

export function AndroidChannelTile({
  label,
  sub,
  ariaLabel
}: {
  label: string;
  sub: string;
  ariaLabel: string;
}) {
  const [shouldShow, setShouldShow] = useState(false);
  useEffect(() => {
    setShouldShow(!isNativeShell());
  }, []);
  if (!shouldShow) {
    return null;
  }
  return (
    <a
      href={androidRelease.downloadUrl}
      download={androidRelease.fileName}
      aria-label={ariaLabel}
      className="group relative min-h-[5rem] overflow-hidden rounded-2xl border border-border/45 bg-surface-raised/18 px-4 py-3.5 backdrop-blur-sm transition-colors hover:border-accent-premium/28 hover:bg-surface-raised/28 dark:hover:border-accent-premium/24"
    >
      <Image
        src="/landing/channels/android.png"
        alt=""
        aria-hidden
        width={384}
        height={384}
        className="pointer-events-none absolute left-3 top-1/2 h-12 w-12 -translate-y-1/2 select-none transition-transform group-hover:scale-[1.03]"
        draggable={false}
      />
      <div className="relative pl-[3.75rem] pr-9">
        <p className="text-[13px] font-semibold leading-tight text-text">{label}</p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-subtle">{sub}</p>
      </div>
      {/* Arrow-chip keeps the download affordance, but the tile surface itself
          stays close to the rest of the row so Android reads as the active
          action inside one family, not as a separate bright banner. */}
      <span
        aria-hidden
        className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-accent-premium/28 bg-accent-premium/10 text-accent-premium transition-all group-hover:translate-y-[calc(-50%+0.125rem)] group-hover:border-accent-premium/42 group-hover:bg-accent-premium/14 dark:border-accent-premium/24 dark:bg-accent-premium/12 dark:text-accent-premium dark:group-hover:border-accent-premium/34 dark:group-hover:bg-accent-premium/18"
      >
        ↓
      </span>
    </a>
  );
}
