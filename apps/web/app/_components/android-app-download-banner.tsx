import { Download, Smartphone } from "lucide-react";
import androidRelease from "../_data/android-release.json";

type AndroidAppDownloadBannerCopy = {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  versionLabel: string;
};

export function AndroidAppDownloadBanner({
  copy,
  className = ""
}: {
  copy: AndroidAppDownloadBannerCopy;
  className?: string;
}) {
  const version = `${copy.versionLabel} ${androidRelease.versionName} · build ${String(
    androidRelease.versionCode
  )}`;

  return (
    <section
      className={`rounded-2xl border border-border/70 bg-surface-raised/25 p-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] backdrop-blur-xl ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent/8 text-accent">
          <Smartphone className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
            {copy.eyebrow}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-text">{copy.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{copy.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={androidRelease.downloadUrl}
              download={androidRelease.fileName}
              className="inline-flex min-h-8 items-center gap-2 rounded-xl border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15"
            >
              <Download className="h-3.5 w-3.5" />
              {copy.cta}
            </a>
            <span className="rounded-full border border-border/70 bg-surface-raised/35 px-2.5 py-1 text-[10px] font-medium text-text-subtle">
              {version}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
