import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { cn } from "@/app/lib/utils";
import { LandingSection, SectionEyebrow, SectionLead, SectionTitle } from "./section";
import { AndroidChannelTile } from "./android-channel-tile";

type PillarTone = "rose" | "amber" | "sky" | "sage";

const PILLARS: { key: string; tone: PillarTone }[] = [
  { key: "personality", tone: "rose" },
  { key: "memory", tone: "amber" },
  { key: "action", tone: "sky" },
  { key: "knowledge", tone: "sage" }
];

export async function LandingSystemSection() {
  const t = await getTranslations("landing.system");

  return (
    <LandingSection id="system" className="py-20 sm:py-28">
      <div className="max-w-3xl">
        <SectionEyebrow>{t("eyebrow")}</SectionEyebrow>
        <SectionTitle className="mt-4">{t("title")}</SectionTitle>
        <SectionLead className="mt-5">{t("lead")}</SectionLead>
      </div>

      {/* Four pillars — palette tints picked from the same warm/cool/sage
          family that already lives inside the Workflow scenes, so the page
          reads as one continuous visual idea. */}
      <div className="mt-12 grid gap-4 sm:mt-14 sm:gap-5 lg:grid-cols-4">
        {PILLARS.map((pillar, idx) => (
          <PillarCard
            key={pillar.key}
            number={idx + 1}
            tone={pillar.tone}
            title={t(`pillars.${pillar.key}.title`)}
            body={t(`pillars.${pillar.key}.body`)}
          />
        ))}
      </div>

      {/* Channels — keep the tile surface calm and mostly neutral so the
          branded squircle itself carries the color. Founder feedback: once
          every card gets its own tinted background the row starts reading like
          four unrelated products instead of one PersAI system. */}
      <div className="mt-14 sm:mt-20">
        <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-text-subtle">
          {t("channels.eyebrow")}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ChannelTile
            tone="sage"
            label={t("channels.web.label")}
            sub={t("channels.web.sub")}
            iconSrc="/landing/channels/web.png"
            iconAlt="Web"
          />
          <ChannelTile
            tone="sky"
            label={t("channels.telegram.label")}
            sub={t("channels.telegram.sub")}
            iconSrc="/landing/channels/telegram.png"
            iconAlt="Telegram"
          />
          <AndroidChannelTile
            label={t("channels.android.label")}
            sub={t("channels.android.sub")}
            ariaLabel={t("channels.android.ariaLabel")}
          />
          <ChannelTile
            tone="muted"
            label={t("channels.ios.label")}
            sub={t("channels.ios.sub")}
            iconSrc="/landing/channels/ios.png"
            iconAlt="iOS"
            muted
          />
        </div>
      </div>
    </LandingSection>
  );
}

/* ──────────────────────────────────────────────────────────
   Pillar cards
   ────────────────────────────────────────────────────────── */

function PillarCard(props: { number: number; tone: PillarTone; title: string; body: string }) {
  const dot =
    props.tone === "rose"
      ? "bg-rose-400/85 dark:bg-rose-300/80"
      : props.tone === "amber"
        ? "bg-amber-400/85 dark:bg-amber-300/80"
        : props.tone === "sky"
          ? "bg-sky-400/85 dark:bg-sky-300/80"
          : "bg-accent";
  const hoverBorder =
    props.tone === "rose"
      ? "hover:border-rose-300/45 dark:hover:border-rose-300/30"
      : props.tone === "amber"
        ? "hover:border-amber-300/50 dark:hover:border-amber-300/30"
        : props.tone === "sky"
          ? "hover:border-sky-300/50 dark:hover:border-sky-300/30"
          : "hover:border-accent/35";
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/40 bg-surface-raised/20 p-6 backdrop-blur-sm transition-colors sm:p-7",
        "hover:bg-surface-raised/40",
        hoverBorder
      )}
    >
      <span aria-hidden className={cn("mb-5 inline-block h-1.5 w-1.5 rounded-full", dot)} />
      <span
        aria-hidden
        className="absolute right-5 top-5 text-[10px] font-semibold tracking-[0.22em] text-text-subtle/55"
      >
        {String(props.number).padStart(2, "0")}
      </span>
      <h3 className="text-lg font-semibold leading-snug text-text">{props.title}</h3>
      <p className="mt-3 text-base leading-relaxed text-text-muted md:text-sm">{props.body}</p>
    </article>
  );
}

/* ──────────────────────────────────────────────────────────
   Channel tiles
   ────────────────────────────────────────────────────────── */

function ChannelTile(props: {
  tone: "sage" | "sky" | "muted";
  label: string;
  sub: string;
  iconSrc: string;
  iconAlt: string;
  muted?: boolean;
}) {
  const tone = props.muted ? "muted" : props.tone;
  const wrap =
    tone === "sage"
      ? "border-border/45 bg-surface-raised/18 hover:border-accent/28 hover:bg-surface-raised/28"
      : tone === "sky"
        ? "border-border/45 bg-surface-raised/18 hover:border-sky-300/28 hover:bg-surface-raised/28 dark:hover:border-sky-300/24"
        : "border-border/45 bg-surface-raised/18 hover:border-border/60 hover:bg-surface-raised/28";
  return (
    <div
      className={cn(
        "group relative min-h-[5rem] overflow-hidden rounded-2xl border px-4 py-3.5 backdrop-blur-sm transition-colors",
        wrap,
        props.muted ? "opacity-95" : null
      )}
      aria-label={props.iconAlt}
    >
      <Image
        src={props.iconSrc}
        alt=""
        aria-hidden
        width={384}
        height={384}
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 h-12 w-12 -translate-y-1/2 select-none transition-transform group-hover:scale-[1.03]",
          props.muted ? "opacity-70" : "opacity-100"
        )}
        draggable={false}
      />
      <div className="relative pl-[3.75rem]">
        <p
          className={cn(
            "text-[13px] font-semibold leading-tight",
            props.muted ? "text-text-subtle" : "text-text"
          )}
        >
          {props.label}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-subtle">
          {props.sub}
        </p>
      </div>
    </div>
  );
}
