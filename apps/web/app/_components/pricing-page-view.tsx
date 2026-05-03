"use client";

import Link from "next/link";
import type { Route } from "next";
import { useLocale, useTranslations } from "next-intl";
import type { PublicPricingPlanState } from "@persai/contracts";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { PageBackButton } from "./page-back-button";

function pickLocalizedText(
  locale: string,
  value: { ru: string | null; en: string | null } | null | undefined
): string | null {
  if (!value) return null;
  return locale === "ru" ? (value.ru ?? value.en) : (value.en ?? value.ru);
}

function pickLocalizedList(
  locale: string,
  value: { ru: string[]; en: string[] } | null | undefined
): string[] {
  if (!value) return [];
  const primary = locale === "ru" ? value.ru : value.en;
  const fallback = locale === "ru" ? value.en : value.ru;
  return primary.length > 0 ? primary : fallback;
}

function formatPlanPrice(
  plan: PublicPricingPlanState,
  locale: string,
  t: ReturnType<typeof useTranslations>
) {
  const amount = plan.presentation.price.amount;
  const currency = plan.presentation.price.currency;
  const billingPeriod = plan.presentation.price.billingPeriod;
  if (amount === null || currency === null || billingPeriod === null) {
    return t("priceOnRequest");
  }

  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
  }).format(amount);

  return billingPeriod === "year"
    ? t("pricePerYear", { price: formatted })
    : t("pricePerMonth", { price: formatted });
}

export function derivePlanFacts(
  plan: PublicPricingPlanState,
  t: ReturnType<typeof useTranslations>
): string[] {
  const facts: string[] = [];
  if (plan.quotaLimits.tokenBudgetLimit != null) {
    facts.push(t("factTokens", { count: plan.quotaLimits.tokenBudgetLimit.toLocaleString() }));
  }
  if (plan.quotaLimits.imageGenerateMonthlyUnitsLimit != null) {
    facts.push(t("factImages", { count: plan.quotaLimits.imageGenerateMonthlyUnitsLimit }));
  }
  if (plan.quotaLimits.videoGenerateMonthlyUnitsLimit != null) {
    facts.push(t("factVideos", { count: plan.quotaLimits.videoGenerateMonthlyUnitsLimit }));
  }
  if (plan.skillPolicy.maxEnabledSkills != null) {
    facts.push(t("factSkills", { count: plan.skillPolicy.maxEnabledSkills }));
  }
  if (plan.quotaLimits.activeWebChatsLimit != null) {
    facts.push(t("factChats", { count: plan.quotaLimits.activeWebChatsLimit }));
  }
  return facts.slice(0, 4);
}

export function PricingPageView({
  plans,
  currentPlanCode,
  signedIn,
  backHref
}: {
  plans: PublicPricingPlanState[];
  currentPlanCode?: string | null;
  signedIn: boolean;
  backHref: Route;
}) {
  const t = useTranslations("pricing");
  const locale = useLocale();

  return (
    <div className="min-h-dvh bg-chrome text-text">
      <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 py-2">
          <PageBackButton fallbackHref={backHref} label={t("back")} />
          {signedIn ? (
            <span className="rounded-full border border-border/80 bg-surface/70 px-3 py-1.5 text-[11px] font-medium text-text-subtle">
              {t("signedInContext")}
            </span>
          ) : null}
        </div>

        <header className="mx-auto mt-6 w-full max-w-3xl text-center sm:mt-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-text sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-text-muted sm:text-base">
            {t("subtitle")}
          </p>
        </header>

        {plans.length === 0 ? (
          <div className="mx-auto mt-10 w-full max-w-2xl rounded-3xl border border-border/80 bg-surface/70 p-6 text-center">
            <p className="text-lg font-medium text-text">{t("emptyTitle")}</p>
            <p className="mt-2 text-sm text-text-muted">{t("emptyBody")}</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 pb-8 sm:grid-cols-2 md:mt-10 lg:grid-cols-4 lg:gap-5">
            {plans.map((plan) => {
              const title = pickLocalizedText(locale, plan.presentation.title) ?? plan.displayName;
              const subtitle =
                pickLocalizedText(locale, plan.presentation.subtitle) ?? plan.description;
              const notes = pickLocalizedText(locale, plan.presentation.notes);
              const badge = pickLocalizedText(locale, plan.presentation.badge);
              const ctaLabel =
                pickLocalizedText(locale, plan.presentation.ctaLabel) ??
                (signedIn ? t("contactToChange") : t("signUp"));
              const highlights = pickLocalizedList(locale, plan.presentation.highlightItems);
              const facts = derivePlanFacts(plan, t);
              const isCurrent = currentPlanCode === plan.code;
              const href = signedIn
                ? `mailto:support@persai.app?subject=${encodeURIComponent(
                    `PersAI plan change: ${plan.code}`
                  )}`
                : ("/sign-up" as const);

              return (
                <section
                  key={plan.code}
                  className={cn(
                    "relative flex h-full flex-col overflow-hidden rounded-[32px] border bg-surface/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur-sm sm:p-6 lg:min-h-[40rem]",
                    plan.presentation.highlighted || isCurrent
                      ? "border-accent/40 bg-surface-raised/90"
                      : "border-border/80"
                  )}
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

                  <div className="flex min-h-8 items-start justify-between gap-3">
                    <div className="flex min-h-8 items-center gap-2">
                      {badge ? (
                        <span className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                          {badge}
                        </span>
                      ) : null}
                      {isCurrent ? (
                        <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-success">
                          {t("currentPlan")}
                        </span>
                      ) : null}
                    </div>
                    {plan.presentation.highlighted ? (
                      <Sparkles className="h-4 w-4 shrink-0 text-accent/80" />
                    ) : null}
                  </div>

                  <div className="mt-6">
                    <p className="text-xl font-semibold tracking-[-0.02em] text-text">{title}</p>
                    {subtitle ? (
                      <p className="mt-2 text-sm leading-6 text-text-muted">{subtitle}</p>
                    ) : null}
                  </div>

                  <div className="mt-6 border-t border-border/70 pt-5">
                    <p className="text-3xl font-semibold tracking-[-0.04em] text-text">
                      {formatPlanPrice(plan, locale, t)}
                    </p>
                    {plan.trialEnabled && plan.trialDurationDays !== null ? (
                      <p className="mt-2 text-xs text-text-subtle">
                        {t("trialDays", { days: plan.trialDurationDays })}
                      </p>
                    ) : null}
                  </div>

                  {facts.length > 0 ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {facts.map((fact) => (
                        <span
                          key={fact}
                          className="rounded-full border border-border/70 bg-bg/60 px-3 py-1.5 text-[11px] text-text-muted"
                        >
                          {fact}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <ul className="mt-6 flex-1 space-y-3">
                    {(highlights.length > 0 ? highlights : facts).map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2.5 text-sm leading-6 text-text-muted"
                      >
                        <Check className="mt-1 h-4 w-4 shrink-0 text-accent" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  {notes ? (
                    <p className="mt-6 text-xs leading-5 text-text-subtle">{notes}</p>
                  ) : null}

                  <div className="mt-6">
                    {isCurrent ? (
                      <div className="flex min-h-12 items-center justify-center rounded-2xl border border-border bg-bg/70 px-4 text-sm font-medium text-text-muted">
                        {t("alreadyActive")}
                      </div>
                    ) : signedIn ? (
                      <a
                        href={href}
                        className="flex min-h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_36px_var(--accent-glow)] transition-all hover:bg-accent-hover"
                      >
                        {ctaLabel}
                      </a>
                    ) : (
                      <Link
                        href={href as Route}
                        className="flex min-h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_36px_var(--accent-glow)] transition-all hover:bg-accent-hover"
                      >
                        {ctaLabel}
                      </Link>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
