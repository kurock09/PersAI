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
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/[0.09] bg-surface-raised/50 px-4 py-2 text-[12px] font-medium text-text/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-colors hover:border-white/[0.13] hover:bg-surface-raised/65 hover:text-text ${className}`}
      aria-label={copy.cta}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-text/80">
        <Smartphone className="h-3 w-3" />
      </span>
      <span>{copy.cta}</span>
    </a>
  );
}
