"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { PublicPricingPlanState } from "@persai/contracts";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  getAssistantBillingSubscription,
  postAssistantBillingChangePlan,
  type AssistantBillingSubscriptionManagementState
} from "../app/assistant-api-client";

type PricingReviewState = {
  kind: "free_downgrade" | "upgrade";
  plan: PublicPricingPlanState;
  currentPlanName: string | null;
  targetPlanName: string;
  targetPriceLabel: string;
  effectiveDateLabel: string | null;
};

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
  if (amount === 0) {
    return t("freePrice");
  }
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

function readPaidPlanPrice(plan: PublicPricingPlanState | null): {
  amountMinor: number;
  currency: string;
  billingPeriod: "month" | "year";
} | null {
  const price = plan?.presentation.price;
  if (
    price === undefined ||
    price === null ||
    typeof price.amount !== "number" ||
    price.amount <= 0 ||
    price.currency === null ||
    (price.billingPeriod !== "month" && price.billingPeriod !== "year")
  ) {
    return null;
  }
  return {
    amountMinor: Math.round(price.amount * 100),
    currency: price.currency,
    billingPeriod: price.billingPeriod
  };
}

function resolvePricingErrorMessage(error: unknown, t: ReturnType<typeof useTranslations>): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Session expired")) {
    return t("sessionExpired");
  }
  if (
    message.includes("Selected plan is already active") ||
    message.includes("Visible purchasable plan was not found")
  ) {
    return t("planUnavailable");
  }
  if (
    message.includes("Only card binding is supported") ||
    message.includes("paymentMethodClass") ||
    message.includes("unsupported")
  ) {
    return t("paymentMethodUnavailable");
  }
  if (message.includes("Scheduled paid downgrade requires")) {
    return t("checkoutStartFailed");
  }
  return t("checkoutStartFailed");
}

export function derivePlanFacts(
  plan: PublicPricingPlanState,
  t: ReturnType<typeof useTranslations>
): string[] {
  const enabledTools = new Set(plan.enabledToolCodes);
  const facts: string[] = [];
  if (plan.quotaLimits.tokenBudgetLimit != null && plan.quotaLimits.tokenBudgetLimit > 0) {
    facts.push(t("factTokens", { count: plan.quotaLimits.tokenBudgetLimit.toLocaleString() }));
  }
  if (
    enabledTools.has("image_generate") &&
    plan.quotaLimits.imageGenerateMonthlyUnitsLimit != null &&
    plan.quotaLimits.imageGenerateMonthlyUnitsLimit > 0
  ) {
    facts.push(t("factImages", { count: plan.quotaLimits.imageGenerateMonthlyUnitsLimit }));
  }
  if (enabledTools.has("video_generate") && plan.videoVcoinMonthlyGrant > 0) {
    const approxVideos = plan.videoVcoinApproxVideosPerMonth;
    facts.push(
      typeof approxVideos === "number"
        ? t("factVideosVcWithApprox", { vc: plan.videoVcoinMonthlyGrant, count: approxVideos })
        : t("factVideosVc", { vc: plan.videoVcoinMonthlyGrant })
    );
  }
  if (plan.skillPolicy.maxEnabledSkills != null && plan.skillPolicy.maxEnabledSkills > 0) {
    facts.push(t("factSkills", { count: plan.skillPolicy.maxEnabledSkills }));
  }
  return facts.slice(0, 4);
}

export function PricingPageView({
  plans,
  currentPlanCode,
  signedIn,
  containedScroll = false,
  embedded = false
}: {
  plans: PublicPricingPlanState[];
  currentPlanCode?: string | null;
  signedIn: boolean;
  containedScroll?: boolean;
  embedded?: boolean;
}) {
  const t = useTranslations("pricing");
  const locale = useLocale();
  const router = useRouter();
  const { getToken, isLoaded } = useAuth();
  const [submittingPlanKey, setSubmittingPlanKey] = useState<string | null>(null);
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({});
  const [pricingFeedback, setPricingFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [billingSubscriptionLoadState, setBillingSubscriptionLoadState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >(signedIn ? "idle" : "ready");
  const [billingSubscription, setBillingSubscription] =
    useState<AssistantBillingSubscriptionManagementState | null>(null);
  const [reviewState, setReviewState] = useState<PricingReviewState | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const effectiveCurrentPlanCode = billingSubscription?.planCode ?? currentPlanCode ?? null;

  const resolveBillingToken = useCallback(async (): Promise<string | null> => {
    if (!isLoaded) {
      return null;
    }
    return (await getToken({ skipCache: true })) ?? (await getToken()) ?? null;
  }, [getToken, isLoaded]);

  const loadBillingSubscription = useCallback(
    async (token: string): Promise<AssistantBillingSubscriptionManagementState | null> => {
      try {
        const nextState = await getAssistantBillingSubscription(token);
        setBillingSubscription(nextState);
        return nextState;
      } catch {
        return null;
      }
    },
    []
  );

  useEffect(() => {
    if (
      !signedIn ||
      !isLoaded ||
      billingSubscription !== null ||
      billingSubscriptionLoadState !== "idle"
    ) {
      return;
    }
    setBillingSubscriptionLoadState("loading");
    void (async () => {
      const token = await resolveBillingToken();
      if (!token) {
        setBillingSubscriptionLoadState("failed");
        return;
      }
      const nextState = await loadBillingSubscription(token);
      setBillingSubscriptionLoadState(nextState === null ? "failed" : "ready");
    })();
  }, [
    billingSubscription,
    billingSubscriptionLoadState,
    isLoaded,
    loadBillingSubscription,
    resolveBillingToken,
    signedIn
  ]);

  const submitPlanChange = useCallback(
    async (plan: PublicPricingPlanState, token: string): Promise<void> => {
      const requestKey = plan.code;
      setSubmittingPlanKey(requestKey);
      setReviewError(null);
      setPricingFeedback(null);
      setPlanErrors((prev) => {
        const next = { ...prev };
        delete next[plan.code];
        return next;
      });
      try {
        const result = await postAssistantBillingChangePlan(token, {
          planCode: plan.code,
          paymentMethodClass: "card",
          idempotencyKey: `pricing:${plan.code}:card:${Date.now()}`,
          returnUrl: "/app/chat"
        });
        if (result.mode === "checkout") {
          setReviewState(null);
          router.push(`/app/billing/checkout/${result.paymentIntent.id}` as Route);
          return;
        }
        setBillingSubscription(result.subscription);
        setReviewState(null);
        setPricingFeedback({
          type: "ok",
          text:
            result.subscription.scheduledPlanChange?.changeKind === "free"
              ? t("switchToFreeScheduled")
              : t("downgradeScheduled")
        });
        router.refresh();
      } catch (error) {
        const message = resolvePricingErrorMessage(error, t);
        setPlanErrors((prev) => ({
          ...prev,
          [plan.code]: message
        }));
        setReviewError(message);
      } finally {
        setSubmittingPlanKey((current) => (current === requestKey ? null : current));
      }
    },
    [router, t]
  );

  const startCheckout = async (plan: PublicPricingPlanState): Promise<void> => {
    if (!signedIn) return;
    const token = await resolveBillingToken();
    if (!token) {
      if (!isLoaded) {
        return;
      }
      setPlanErrors((prev) => ({
        ...prev,
        [plan.code]: t("sessionExpired")
      }));
      return;
    }
    try {
      const subscription = billingSubscription ?? (await loadBillingSubscription(token));
      if (subscription === null) {
        setPlanErrors((prev) => ({
          ...prev,
          [plan.code]: t("billingStateUnavailable")
        }));
        return;
      }
      const currentPlan =
        subscription.planCode !== null && subscription.planCode !== undefined
          ? (plans.find((candidate) => candidate.code === subscription.planCode) ?? null)
          : null;
      const currentPrice = readPaidPlanPrice(currentPlan);
      const targetPrice = readPaidPlanPrice(plan);
      if (currentPrice === null) {
        await submitPlanChange(plan, token);
        return;
      }
      if (targetPrice === null) {
        if (!subscription.canSwitchToFree) {
          setPlanErrors((prev) => ({
            ...prev,
            [plan.code]: t("planChangeNotSupported")
          }));
          return;
        }
        setReviewError(null);
        setReviewState({
          kind: "free_downgrade",
          plan,
          currentPlanName:
            pickLocalizedText(locale, currentPlan?.presentation.title) ??
            currentPlan?.displayName ??
            null,
          targetPlanName: pickLocalizedText(locale, plan.presentation.title) ?? plan.displayName,
          targetPriceLabel: formatPlanPrice(plan, locale, t),
          effectiveDateLabel:
            subscription.currentPeriodEndsAt !== null
              ? new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short"
                }).format(new Date(subscription.currentPeriodEndsAt))
              : null
        });
        return;
      }
      if (
        targetPrice.currency !== currentPrice.currency ||
        targetPrice.billingPeriod !== currentPrice.billingPeriod
      ) {
        setPlanErrors((prev) => ({
          ...prev,
          [plan.code]: t("planChangeNotSupported")
        }));
        return;
      }
      if (targetPrice.amountMinor > currentPrice.amountMinor) {
        setReviewError(null);
        setReviewState({
          kind: "upgrade",
          plan,
          currentPlanName:
            pickLocalizedText(locale, currentPlan?.presentation.title) ??
            currentPlan?.displayName ??
            null,
          targetPlanName: pickLocalizedText(locale, plan.presentation.title) ?? plan.displayName,
          targetPriceLabel: formatPlanPrice(plan, locale, t),
          effectiveDateLabel: new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short"
          }).format(new Date())
        });
        return;
      }
      if (targetPrice.amountMinor < currentPrice.amountMinor) {
        if (!subscription.canScheduleDowngrade) {
          setPlanErrors((prev) => ({
            ...prev,
            [plan.code]: t("planChangeNotSupported")
          }));
          return;
        }
        setReviewError(null);
        setReviewState({
          kind: "free_downgrade",
          plan,
          currentPlanName:
            pickLocalizedText(locale, currentPlan?.presentation.title) ??
            currentPlan?.displayName ??
            null,
          targetPlanName: pickLocalizedText(locale, plan.presentation.title) ?? plan.displayName,
          targetPriceLabel: formatPlanPrice(plan, locale, t),
          effectiveDateLabel:
            subscription.currentPeriodEndsAt !== null
              ? new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short"
                }).format(new Date(subscription.currentPeriodEndsAt))
              : null
        });
        return;
      }
      setPlanErrors((prev) => ({
        ...prev,
        [plan.code]: t("planChangeNotSupported")
      }));
    } catch (error) {
      setPlanErrors((prev) => ({
        ...prev,
        [plan.code]: resolvePricingErrorMessage(error, t)
      }));
    }
  };

  return (
    <div
      className={cn(
        "w-full text-text",
        embedded
          ? "flex min-h-0 flex-1 flex-col"
          : containedScroll
            ? "flex h-dvh flex-col overflow-hidden bg-chrome"
            : "min-h-dvh bg-chrome"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8",
          containedScroll ? "h-full" : embedded ? "min-h-0" : "min-h-dvh"
        )}
      >
        <div className={cn("min-h-0", containedScroll && "flex-1 overflow-y-auto pr-1")}>
          <header className="mx-auto mt-2 w-full max-w-3xl text-center sm:mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-text sm:text-5xl">
              {t("title")}
            </h1>
          </header>

          {plans.length === 0 ? (
            <div className="mx-auto mt-10 w-full max-w-2xl rounded-3xl border border-border/80 bg-surface/70 p-6 text-center">
              <p className="text-lg font-medium text-text">{t("emptyTitle")}</p>
              <p className="mt-2 text-sm text-text-muted">{t("emptyBody")}</p>
            </div>
          ) : (
            <>
              {pricingFeedback ? (
                <div
                  className={cn(
                    "mx-auto mt-6 w-full max-w-3xl rounded-2xl border px-4 py-3 text-sm",
                    pricingFeedback.type === "ok"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-text"
                      : "border-danger/20 bg-danger/10 text-danger"
                  )}
                >
                  {pricingFeedback.text}
                </div>
              ) : null}
              <div className="mt-8 grid gap-4 pb-8 sm:grid-cols-2 md:mt-10 lg:grid-cols-4 lg:gap-5">
                {plans.map((plan) => {
                  const title =
                    pickLocalizedText(locale, plan.presentation.title) ?? plan.displayName;
                  const subtitle =
                    pickLocalizedText(locale, plan.presentation.subtitle) ?? plan.description;
                  const notes = pickLocalizedText(locale, plan.presentation.notes);
                  const badge = pickLocalizedText(locale, plan.presentation.badge);
                  const localizedPlanCtaLabel =
                    pickLocalizedText(locale, plan.presentation.ctaLabel) ??
                    (signedIn ? t("connect") : t("signUp"));
                  const highlights = pickLocalizedList(locale, plan.presentation.highlightItems);
                  const facts = derivePlanFacts(plan, t);
                  const isCurrent = effectiveCurrentPlanCode === plan.code;
                  const isPremiumHighlighted = plan.presentation.highlighted && !isCurrent;
                  const signUpHref = "/sign-up" as const;
                  const freeSettingsHref = "/app/chat?settings=limits" as const;
                  const isSubmitting = submittingPlanKey === plan.code;
                  const planError = planErrors[plan.code] ?? null;
                  const currentPlan = plans.find(
                    (candidate) => candidate.code === effectiveCurrentPlanCode
                  );
                  const currentPrice = readPaidPlanPrice(currentPlan ?? null);
                  const targetPrice = readPaidPlanPrice(plan);
                  const isTrialingSubscription =
                    billingSubscription?.subscriptionStatus === "trialing";
                  const hasScheduledFreeChange =
                    billingSubscription?.scheduledPlanChange?.changeKind === "free";
                  const isZeroPriceTarget = targetPrice === null;
                  const showFreeSettingsHint =
                    signedIn &&
                    isZeroPriceTarget &&
                    billingSubscriptionLoadState === "ready" &&
                    billingSubscription !== null &&
                    currentPrice !== null &&
                    !isTrialingSubscription &&
                    !hasScheduledFreeChange;
                  const showScheduledFreeHint =
                    signedIn &&
                    isZeroPriceTarget &&
                    billingSubscriptionLoadState === "ready" &&
                    billingSubscription !== null &&
                    currentPrice !== null &&
                    hasScheduledFreeChange;
                  const showTrialFreeHint =
                    signedIn &&
                    isZeroPriceTarget &&
                    billingSubscriptionLoadState === "ready" &&
                    billingSubscription !== null &&
                    isTrialingSubscription === true;
                  const showFreePlanBillingLoadingHint =
                    signedIn &&
                    isZeroPriceTarget &&
                    (billingSubscriptionLoadState === "idle" ||
                      billingSubscriptionLoadState === "loading");
                  const showFreePlanBillingUnavailableHint =
                    signedIn && isZeroPriceTarget && billingSubscriptionLoadState === "failed";
                  const ctaLabel = localizedPlanCtaLabel;

                  return (
                    <section
                      key={plan.code}
                      className={cn(
                        "relative flex h-full flex-col overflow-hidden rounded-[30px] border bg-surface/84 p-5 shadow-[0_12px_36px_rgba(0,0,0,0.10)] transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(0,0,0,0.14)] sm:p-6 lg:min-h-[40rem]",
                        isCurrent
                          ? "border-border/85 bg-surface-raised/82 hover:border-border"
                          : isPremiumHighlighted
                            ? "border-accent-premium/30 bg-surface-raised/68 hover:border-accent-premium/45"
                            : "border-border/80 hover:border-accent/35"
                      )}
                    >
                      <div
                        className={cn(
                          "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
                          isPremiumHighlighted
                            ? "via-accent-premium/60"
                            : isCurrent
                              ? "via-text-subtle/25"
                              : "via-accent/40"
                        )}
                      />

                      {badge ? (
                        <div className="flex min-h-8 items-center gap-2">
                          {badge ? (
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
                                isPremiumHighlighted
                                  ? "border border-accent-premium/25 bg-accent-premium/10 text-accent-premium"
                                  : "border border-accent/25 bg-accent/10 text-accent"
                              )}
                            >
                              {badge}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <div
                        className={cn("flex items-start justify-between gap-3", badge && "mt-4")}
                      >
                        <p className="text-xl font-semibold tracking-[-0.02em] text-text">
                          {title}
                        </p>
                        {plan.presentation.highlighted ? (
                          <Sparkles
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              isPremiumHighlighted ? "text-accent-premium/80" : "text-accent/80"
                            )}
                          />
                        ) : null}
                      </div>

                      <div className="mt-3">
                        {subtitle ? (
                          <p className="text-sm leading-6 text-text-muted">{subtitle}</p>
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
                            <Check
                              className={cn(
                                "mt-1 h-4 w-4 shrink-0",
                                isPremiumHighlighted ? "text-accent-premium" : "text-accent"
                              )}
                            />
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
                        ) : showFreeSettingsHint ? (
                          <p className="rounded-2xl border border-border/70 bg-bg/60 px-4 py-3 text-sm leading-6 text-text-muted">
                            {t("freePlanSettingsHint")}{" "}
                            <Link
                              href={freeSettingsHref}
                              className="font-medium text-text underline decoration-border underline-offset-4 transition-colors hover:text-accent"
                            >
                              {t("freePlanSettingsLink")}
                            </Link>
                          </p>
                        ) : showScheduledFreeHint ? (
                          <p className="rounded-2xl border border-border/70 bg-bg/60 px-4 py-3 text-sm leading-6 text-text-muted">
                            {t("switchToFreeScheduled")}
                          </p>
                        ) : showTrialFreeHint ? (
                          <p className="rounded-2xl border border-border/70 bg-bg/60 px-4 py-3 text-sm leading-6 text-text-muted">
                            {t("trialFreePlanHint")}
                          </p>
                        ) : showFreePlanBillingLoadingHint ? (
                          <p className="rounded-2xl border border-border/70 bg-bg/60 px-4 py-3 text-sm leading-6 text-text-muted">
                            {t("freePlanBillingLoadingHint")}
                          </p>
                        ) : showFreePlanBillingUnavailableHint ? (
                          <p className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm leading-6 text-danger">
                            {t("billingStateUnavailable")}
                          </p>
                        ) : signedIn ? (
                          <div className="space-y-2.5">
                            <button
                              type="button"
                              disabled={submittingPlanKey !== null}
                              onClick={() => void startCheckout(plan)}
                              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_18px_var(--accent-glow)] transition-all hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
                            >
                              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                              {isSubmitting ? t("startingCheckout") : ctaLabel}
                            </button>
                            {planError ? (
                              <p className="text-xs leading-5 text-danger">{planError}</p>
                            ) : null}
                          </div>
                        ) : (
                          <Link
                            href={signUpHref as Route}
                            className="flex min-h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_18px_var(--accent-glow)] transition-all hover:bg-accent-hover"
                          >
                            {ctaLabel}
                          </Link>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      {reviewState ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-border/85 bg-[color:var(--surface)] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
            <div className="border-b border-border/70 px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-subtle">
                    {t("reviewEyebrow")}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-text">
                    {reviewState.kind === "upgrade"
                      ? t("reviewUpgradeTitle")
                      : t("reviewDowngradeTitle")}
                  </h3>
                  <p className="mt-1 text-sm text-text-muted">
                    {reviewState.kind === "upgrade"
                      ? t("reviewUpgradeBody", {
                          currentPlan: reviewState.currentPlanName ?? t("dateUnavailable"),
                          targetPlan: reviewState.targetPlanName,
                          date: reviewState.effectiveDateLabel ?? t("dateUnavailable")
                        })
                      : reviewState.plan.presentation.price.amount === 0
                        ? t("reviewFreeBody", {
                            date: reviewState.effectiveDateLabel ?? t("dateUnavailable")
                          })
                        : t("reviewDowngradeBody", {
                            targetPlan: reviewState.targetPlanName,
                            price: reviewState.targetPriceLabel,
                            date: reviewState.effectiveDateLabel ?? t("dateUnavailable")
                          })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReviewState(null);
                    setReviewError(null);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface-raised/60 text-text-muted transition-colors hover:text-text"
                  aria-label={t("reviewClose")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-4 px-5 py-5 sm:px-6">
              <div className="rounded-2xl border border-border/80 bg-surface-raised/40 p-4 text-sm text-text-muted">
                {reviewState.kind === "upgrade"
                  ? t("reviewUpgradeHelp", {
                      targetPlan: reviewState.targetPlanName,
                      price: reviewState.targetPriceLabel
                    })
                  : t("reviewDowngradeHelp")}
              </div>
              {reviewError ? <p className="text-sm text-danger">{reviewError}</p> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setReviewState(null);
                    setReviewError(null);
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-border/80 bg-transparent px-4 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                >
                  {t("reviewCancel")}
                </button>
                <button
                  type="button"
                  disabled={submittingPlanKey === reviewState.plan.code}
                  onClick={async () => {
                    const token = await resolveBillingToken();
                    if (!token) {
                      if (!isLoaded) {
                        return;
                      }
                      setReviewError(t("sessionExpired"));
                      return;
                    }
                    await submitPlanChange(reviewState.plan, token);
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_18px_var(--accent-glow)] transition-all hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
                >
                  {submittingPlanKey === reviewState.plan.code ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {reviewState.kind === "upgrade"
                    ? t("reviewUpgradeConfirm")
                    : t("reviewDowngradeConfirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
