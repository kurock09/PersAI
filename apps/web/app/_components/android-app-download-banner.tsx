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
      className={`inline-flex min-h-11 items-center justify-center gap-2.5 rounded-2xl border border-accent/20 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_46px_rgba(0,0,0,0.16)] backdrop-blur-xl transition-colors hover:bg-accent/15 ${className}`}
      aria-label={copy.cta}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent/10">
        <Smartphone className="h-4 w-4" />
      </span>
      <span>{copy.cta}</span>
    </a>
  );
}
