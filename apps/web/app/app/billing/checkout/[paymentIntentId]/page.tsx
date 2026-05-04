"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AssistantBillingPaymentIntentState } from "@persai/contracts";
import { AlertCircle, Loader2 } from "lucide-react";
import { getAssistantBillingPaymentIntent } from "../../../assistant-api-client";
import { PageBackButton } from "../../../../_components/page-back-button";

function buildChatReturnHref(
  paymentIntent: AssistantBillingPaymentIntentState,
  result: "success" | "failed" | "pending"
): Route {
  const params = new URLSearchParams({
    billingReturn: result,
    billingPlan: paymentIntent.targetPlanCode
  });
  return `/app/chat?${params.toString()}` as Route;
}

export default function BillingCheckoutPage({ params }: { params: { paymentIntentId: string } }) {
  const t = useTranslations("billingCheckout");
  const { getToken } = useAuth();
  const router = useRouter();
  const [paymentIntent, setPaymentIntent] = useState<AssistantBillingPaymentIntentState | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) {
          setError(t("sessionExpired"));
          setLoading(false);
        }
        return;
      }
      try {
        const next = await getAssistantBillingPaymentIntent(token, params.paymentIntentId);
        if (!cancelled) {
          setPaymentIntent(next);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error && nextError.message.trim().length > 0
              ? nextError.message
              : t("loadFailed")
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, params.paymentIntentId, t]);

  const modeLabel = useMemo(() => {
    switch (paymentIntent?.checkout.mode) {
      case "manual_test":
        return t("modeManualTest");
      case "widget":
        return t("modeWidget");
      case "redirect":
        return t("modeRedirect");
      case "payment_link":
        return t("modePaymentLink");
      case "qr_code":
        return t("modeQrCode");
      default:
        return t("modePending");
    }
  }, [paymentIntent?.checkout.mode, t]);

  const checkoutUrl =
    paymentIntent?.checkout.payload &&
    typeof paymentIntent.checkout.payload === "object" &&
    paymentIntent.checkout.payload !== null &&
    "url" in paymentIntent.checkout.payload &&
    typeof paymentIntent.checkout.payload.url === "string"
      ? paymentIntent.checkout.payload.url
      : null;

  return (
    <div className="min-h-dvh bg-chrome text-text">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 py-2">
          <PageBackButton fallbackHref={"/app/pricing" as Route} label={t("back")} />
        </div>

        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-8">
          <div className="rounded-[28px] border border-border/80 bg-surface/85 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur-sm sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-text">
              {t("title")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-text-muted">{t("body")}</p>

            {loading ? (
              <div className="mt-8 flex items-center gap-3 rounded-2xl border border-border/70 bg-bg/60 px-4 py-4 text-sm text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loading")}
              </div>
            ) : error ? (
              <div className="mt-8 rounded-2xl border border-danger/25 bg-danger/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-danger">{t("errorTitle")}</p>
                    <p className="mt-1 text-sm leading-6 text-text-muted">{error}</p>
                  </div>
                </div>
                <Link
                  href={"/app/pricing" as Route}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl border border-border/80 bg-bg/70 px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
                >
                  {t("backToPricing")}
                </Link>
              </div>
            ) : paymentIntent ? (
              <>
                <div className="mt-8 space-y-3 rounded-2xl border border-border/70 bg-bg/60 p-4 text-sm text-text-muted">
                  <div className="flex items-center justify-between gap-3">
                    <span>{t("targetPlan")}</span>
                    <span className="font-medium text-text">{paymentIntent.targetPlanCode}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>{t("paymentMethod")}</span>
                    <span className="font-medium text-text">
                      {paymentIntent.paymentMethodClass === "sbp_qr"
                        ? t("paymentMethodSbpQr")
                        : t("paymentMethodCard")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>{t("checkoutMode")}</span>
                    <span className="font-medium text-text">{modeLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>{t("status")}</span>
                    <span className="font-medium text-text">{paymentIntent.status}</span>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-warning/25 bg-warning/10 p-4">
                  <p className="text-sm font-medium text-text">{t("activationTitle")}</p>
                  <p className="mt-1 text-sm leading-6 text-text-muted">{t("activationBody")}</p>
                </div>

                {paymentIntent.checkout.mode === "manual_test" ? (
                  <div className="mt-6 space-y-3">
                    <button
                      type="button"
                      onClick={() => router.replace(buildChatReturnHref(paymentIntent, "success"))}
                      className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_36px_var(--accent-glow)] transition-all hover:bg-accent-hover"
                    >
                      {t("returnSuccess")}
                    </button>
                    <button
                      type="button"
                      onClick={() => router.replace(buildChatReturnHref(paymentIntent, "failed"))}
                      className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-border/80 bg-bg/70 px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
                    >
                      {t("returnFailed")}
                    </button>
                    <button
                      type="button"
                      onClick={() => router.replace(buildChatReturnHref(paymentIntent, "pending"))}
                      className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-border/80 bg-bg/70 px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
                    >
                      {t("returnPending")}
                    </button>
                  </div>
                ) : checkoutUrl ? (
                  <div className="mt-6 space-y-3">
                    <a
                      href={checkoutUrl}
                      className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_36px_var(--accent-glow)] transition-all hover:bg-accent-hover"
                    >
                      {t("openProviderCheckout")}
                    </a>
                    <button
                      type="button"
                      onClick={() => router.replace(buildChatReturnHref(paymentIntent, "pending"))}
                      className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-border/80 bg-bg/70 px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
                    >
                      {t("returnPending")}
                    </button>
                  </div>
                ) : (
                  <div className="mt-6 rounded-2xl border border-border/70 bg-bg/60 p-4 text-sm leading-6 text-text-muted">
                    {t("unsupportedMode")}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
