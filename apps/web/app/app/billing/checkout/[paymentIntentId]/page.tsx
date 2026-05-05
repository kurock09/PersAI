"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AssistantBillingPaymentIntentState } from "@persai/contracts";
import { AlertCircle, Loader2 } from "lucide-react";
import { getAssistantBillingPaymentIntent } from "../../../assistant-api-client";

type CloudpaymentsWidgetPayload = {
  schema: "persai.billing.cloudpaymentsWidgetCheckout.v1";
  publicTerminalId: string;
  amount: number;
  currency: string;
  culture?: string;
  description?: string;
  externalId: string;
  paymentSchema: "Single" | "Dual";
  accountId?: string;
  emailBehavior?: "Required" | "Hidden" | "Optional";
  retryPayment?: boolean;
  autoClose?: number;
  restrictedPaymentMethods?: string[];
  metadata?: Record<string, unknown>;
  expiresAt?: string;
};

type CloudpaymentsWidgetResult = {
  type?: "cancel" | "payment" | "installment" | "error";
  status?: "success" | "fail" | "appointment" | "reject" | "cancel";
};

declare global {
  interface Window {
    cp?: {
      CloudPayments: new () => {
        oncomplete?: (result: CloudpaymentsWidgetResult) => void;
        start: (params: CloudpaymentsWidgetPayload) => Promise<unknown>;
      };
    };
  }
}

const CLOUDPAYMENTS_WIDGET_SCRIPT_SRC = "https://widget.cloudpayments.ru/bundles/cloudpayments.js";

let cloudpaymentsWidgetScriptPromise: Promise<void> | null = null;

function isCloudpaymentsWidgetPayload(value: unknown): value is CloudpaymentsWidgetPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    row.schema === "persai.billing.cloudpaymentsWidgetCheckout.v1" &&
    typeof row.publicTerminalId === "string" &&
    typeof row.amount === "number" &&
    Number.isFinite(row.amount) &&
    typeof row.currency === "string" &&
    typeof row.externalId === "string" &&
    (row.paymentSchema === "Single" || row.paymentSchema === "Dual")
  );
}

function loadCloudpaymentsWidgetScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("CloudPayments widget can only load in the browser."));
  }
  if (window.cp?.CloudPayments) {
    return Promise.resolve();
  }
  if (cloudpaymentsWidgetScriptPromise !== null) {
    return cloudpaymentsWidgetScriptPromise;
  }
  cloudpaymentsWidgetScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-persai-cloudpayments-widget="true"]'
    );
    if (existing !== null) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("CloudPayments widget script failed to load.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CLOUDPAYMENTS_WIDGET_SCRIPT_SRC;
    script.async = true;
    script.dataset.persaiCloudpaymentsWidget = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("CloudPayments widget script failed to load."));
    document.head.appendChild(script);
  }).finally(() => {
    if (!window.cp?.CloudPayments) {
      cloudpaymentsWidgetScriptPromise = null;
    }
  });
  return cloudpaymentsWidgetScriptPromise;
}

function buildChatReturnHref(
  paymentIntent: AssistantBillingPaymentIntentState,
  result: "success" | "failed" | "pending"
): Route {
  const params = new URLSearchParams({
    billingReturn: result,
    billingPlan: paymentIntent.targetPlanCode,
    billingPaymentIntentId: paymentIntent.id
  });
  return `/app/chat?${params.toString()}` as Route;
}

export default function BillingCheckoutPage({ params }: { params?: { paymentIntentId?: string } }) {
  const t = useTranslations("billingCheckout");
  const { getToken } = useAuth();
  const router = useRouter();
  const routeParams = useParams<{ paymentIntentId?: string | string[] }>();
  const paymentIntentId =
    params?.paymentIntentId ??
    (typeof routeParams.paymentIntentId === "string"
      ? routeParams.paymentIntentId
      : Array.isArray(routeParams.paymentIntentId)
        ? routeParams.paymentIntentId[0]
        : undefined);
  const [paymentIntent, setPaymentIntent] = useState<AssistantBillingPaymentIntentState | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launchingWidget, setLaunchingWidget] = useState(false);
  const widgetCompletionHandledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof paymentIntentId !== "string" || paymentIntentId.trim().length === 0) {
        if (!cancelled) {
          setError(t("loadFailed"));
          setLoading(false);
        }
        return;
      }
      const token = await getToken();
      if (!token) {
        if (!cancelled) {
          setError(t("sessionExpired"));
          setLoading(false);
        }
        return;
      }
      try {
        const next = await getAssistantBillingPaymentIntent(token, paymentIntentId);
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
  }, [getToken, paymentIntentId, t]);

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
  const widgetPayload = isCloudpaymentsWidgetPayload(paymentIntent?.checkout.payload)
    ? paymentIntent?.checkout.payload
    : null;

  async function launchCloudpaymentsWidget(): Promise<void> {
    if (paymentIntent === null || widgetPayload === null || launchingWidget) {
      return;
    }
    widgetCompletionHandledRef.current = false;
    setLaunchingWidget(true);
    setError(null);
    try {
      await loadCloudpaymentsWidgetScript();
      const CloudPayments = window.cp?.CloudPayments;
      if (!CloudPayments) {
        throw new Error(t("widgetUnavailable"));
      }
      const widget = new CloudPayments();
      widget.oncomplete = (result) => {
        if (widgetCompletionHandledRef.current) {
          return;
        }
        widgetCompletionHandledRef.current = true;
        const outcome =
          result.status === "success"
            ? "success"
            : result.type === "cancel" || result.status === "cancel"
              ? "failed"
              : result.status === "fail" || result.status === "reject" || result.type === "error"
                ? "failed"
                : "pending";
        router.replace(buildChatReturnHref(paymentIntent, outcome));
      };
      await widget.start(widgetPayload);
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message.trim().length > 0
          ? nextError.message
          : t("widgetStartFailed")
      );
    } finally {
      setLaunchingWidget(false);
    }
  }

  return (
    <div className="min-h-dvh bg-chrome text-text">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-4 sm:py-6">
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
                ) : paymentIntent.checkout.mode === "widget" && widgetPayload ? (
                  <div className="mt-6 space-y-3">
                    <button
                      type="button"
                      onClick={() => void launchCloudpaymentsWidget()}
                      disabled={launchingWidget}
                      className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_36px_var(--accent-glow)] transition-all hover:bg-accent-hover disabled:opacity-60"
                    >
                      {launchingWidget ? t("startingWidget") : t("openProviderCheckout")}
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
