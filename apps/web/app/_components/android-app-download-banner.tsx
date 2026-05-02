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
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-white/[0.055] bg-surface-raised/25 px-3.5 py-1.5 text-[12px] font-medium text-text-subtle/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] backdrop-blur-xl transition-colors hover:border-white/[0.09] hover:bg-surface-raised/35 hover:text-text-muted ${className}`}
      aria-label={copy.cta}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025] text-text-subtle/70">
        <Smartphone className="h-3 w-3" />
      </span>
      <span>{copy.cta}</span>
    </a>
  );
}
