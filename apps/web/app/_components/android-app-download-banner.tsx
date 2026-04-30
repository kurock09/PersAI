import { Smartphone } from "lucide-react";
import androidRelease from "../_data/android-release.json";

type AndroidAppDownloadBannerCopy = {
  cta: string;
};

export function AndroidAppDownloadBanner({
  copy,
  className = ""
}: {
  copy: AndroidAppDownloadBannerCopy;
  className?: string;
}) {
  return (
    <a
      href={androidRelease.downloadUrl}
      download={androidRelease.fileName}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/[0.07] bg-surface-raised/35 px-4 py-2 text-[12px] font-semibold text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-colors hover:border-accent/18 hover:bg-surface-raised/50 hover:text-text ${className}`}
      aria-label={copy.cta}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/12 bg-accent/[0.07] text-accent/80">
        <Smartphone className="h-3.5 w-3.5" />
      </span>
      <span>{copy.cta}</span>
    </a>
  );
}
