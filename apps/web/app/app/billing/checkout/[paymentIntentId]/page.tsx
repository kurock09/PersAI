"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { AssistantBillingPaymentIntentState } from "@persai/contracts";
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react";
import { getAssistantBillingPaymentIntent } from "../../../assistant-api-client";
import { cn } from "@/app/lib/utils";

type CloudpaymentsConstructorPayload = {
  schema: "persai.billing.cloudpaymentsConstructorCheckout.v1";
  initializationParams: {
    publicTerminalId: string;
    paymentSchema: "Single" | "Dual";
    description: string;
    amount: number;
    currency: string;
    externalId: string;
    accountId?: string;
    emailBehavior: "Required" | "Hidden" | "Optional";
    language: "ru-RU";
    tokenize?: boolean;
    metadata: Record<string, unknown>;
  };
  customizationParams?: {
    appearance?: {
      colors?: {
        primaryButtonColor?: string;
        primaryHoverButtonColor?: string;
        primaryButtonTextColor?: string;
        primaryButtonHoverTextColor?: string;
        activeInputColor?: string;
        inputBackground?: string;
        inputColor?: string;
        inputBorderColor?: string;
        titleColor?: string;
        textColor?: string;
        errorColor?: string;
        skeletonBackground?: string;
      };
      borders?: {
        radius?: string;
      };
    };
    components?: {
      paymentButton?: {
        text?: string;
      };
      paymentForm?: {
        labelFontSize?: string;
        activeLabelFontSize?: string;
        fontSize?: string;
      };
    };
  };
  expiresAt?: string;
};

type LegacyCloudpaymentsWidgetPayload = {
  schema: "persai.billing.cloudpaymentsWidgetCheckout.v1";
};

declare global {
  interface Window {
    cp?: {
      PaymentBlocks: new (
        initializationParams: CloudpaymentsConstructorPayload["initializationParams"],
        customizationParams?: CloudpaymentsConstructorPayload["customizationParams"]
      ) => {
        mount: (target: HTMLElement) => void;
        unmount: () => void;
        on: (event: "success" | "fail" | "destroy", callback: (result?: unknown) => void) => void;
        off: (event: "success" | "fail" | "destroy") => void;
      };
    };
  }
}

const CLOUDPAYMENTS_CONSTRUCTOR_SCRIPT_SRC =
  "https://widget.cloudpayments.ru/bundles/paymentblocks.js";

let cloudpaymentsConstructorScriptPromise: Promise<void> | null = null;

function isCloudpaymentsConstructorPayload(
  value: unknown
): value is CloudpaymentsConstructorPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  const initializationParams =
    row.initializationParams !== null &&
    typeof row.initializationParams === "object" &&
    !Array.isArray(row.initializationParams)
      ? (row.initializationParams as Record<string, unknown>)
      : null;
  return (
    row.schema === "persai.billing.cloudpaymentsConstructorCheckout.v1" &&
    initializationParams !== null &&
    typeof initializationParams.publicTerminalId === "string" &&
    typeof initializationParams.amount === "number" &&
    Number.isFinite(initializationParams.amount) &&
    typeof initializationParams.currency === "string" &&
    typeof initializationParams.externalId === "string" &&
    (initializationParams.paymentSchema === "Single" ||
      initializationParams.paymentSchema === "Dual")
  );
}

function isLegacyCloudpaymentsWidgetPayload(
  value: unknown
): value is LegacyCloudpaymentsWidgetPayload {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).schema === "persai.billing.cloudpaymentsWidgetCheckout.v1"
  );
}

function loadCloudpaymentsConstructorScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("CloudPayments payment form can only load in the browser."));
  }
  if (window.cp?.PaymentBlocks) {
    return Promise.resolve();
  }
  if (cloudpaymentsConstructorScriptPromise !== null) {
    return cloudpaymentsConstructorScriptPromise;
  }
  cloudpaymentsConstructorScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-persai-cloudpayments-constructor="true"]'
    );
    if (existing !== null) {
      if (window.cp?.PaymentBlocks) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("CloudPayments payment form script failed to load.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CLOUDPAYMENTS_CONSTRUCTOR_SCRIPT_SRC;
    script.async = true;
    script.dataset.persaiCloudpaymentsConstructor = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("CloudPayments payment form script failed to load."));
    document.head.appendChild(script);
  }).finally(() => {
    if (!window.cp?.PaymentBlocks) {
      cloudpaymentsConstructorScriptPromise = null;
    }
  });
  return cloudpaymentsConstructorScriptPromise;
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

function formatPlanCode(planCode: string): string {
  return planCode.replace(/[_-]+/g, " ").trim().toUpperCase();
}

function formatSubscriptionPrice(
  paymentIntent: AssistantBillingPaymentIntentState,
  locale: string,
  t: ReturnType<typeof useTranslations>
): string {
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: paymentIntent.currency,
    maximumFractionDigits: paymentIntent.amountMinor % 100 === 0 ? 0 : 2
  }).format(paymentIntent.amountMinor / 100);
  return paymentIntent.billingPeriod === "year"
    ? t("pricePerYear", { price: formatted })
    : t("pricePerMonth", { price: formatted });
}

function isTerminalPaymentIntentStatus(
  status: AssistantBillingPaymentIntentState["status"]
): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "canceled" ||
    status === "reversed" ||
    status === "expired"
  );
}

function isExpiredCheckout(expiresAt: string | null | undefined): boolean {
  if (typeof expiresAt !== "string" || expiresAt.trim().length === 0) {
    return false;
  }
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

export default function BillingCheckoutPage({ params }: { params?: { paymentIntentId?: string } }) {
  const t = useTranslations("billingCheckout");
  const locale = useLocale();
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
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [mountingPaymentForm, setMountingPaymentForm] = useState(false);
  const [paymentFormVisible, setPaymentFormVisible] = useState(false);
  const embeddedContainerRef = useRef<HTMLDivElement | null>(null);
  const embeddedCompletionHandledRef = useRef(false);

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
          setPaymentError(null);
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

  const checkoutUrl =
    paymentIntent?.checkout.payload &&
    typeof paymentIntent.checkout.payload === "object" &&
    paymentIntent.checkout.payload !== null &&
    "url" in paymentIntent.checkout.payload &&
    typeof paymentIntent.checkout.payload.url === "string"
      ? paymentIntent.checkout.payload.url
      : null;
  const constructorPayload = isCloudpaymentsConstructorPayload(paymentIntent?.checkout.payload)
    ? paymentIntent?.checkout.payload
    : null;
  const legacyWidgetPayload = isLegacyCloudpaymentsWidgetPayload(paymentIntent?.checkout.payload)
    ? paymentIntent.checkout.payload
    : null;

  const planLabel = paymentIntent !== null ? formatPlanCode(paymentIntent.targetPlanCode) : null;
  const priceLabel =
    paymentIntent !== null ? formatSubscriptionPrice(paymentIntent, locale, t) : null;
  const checkoutExpired = isExpiredCheckout(paymentIntent?.checkout.expiresAt);
  const hasTerminalStatus =
    paymentIntent !== null ? isTerminalPaymentIntentStatus(paymentIntent.status) : false;
  const canUseCheckoutSurface =
    paymentIntent !== null &&
    paymentIntent.status === "checkout_ready" &&
    !checkoutExpired &&
    legacyWidgetPayload === null;
  const staticCheckoutState =
    paymentIntent === null
      ? null
      : legacyWidgetPayload !== null
        ? {
            title: t("legacyCheckoutTitle"),
            body: t("legacyCheckoutBody"),
            returnKind: "failed" as const,
            showRetry: true
          }
        : checkoutExpired
          ? {
              title: t("expiredCheckoutTitle"),
              body: t("expiredCheckoutBody"),
              returnKind: "failed" as const,
              showRetry: true
            }
          : paymentIntent.status === "pending_confirmation"
            ? {
                title: t("pendingCheckoutTitle"),
                body: t("pendingCheckoutBody"),
                returnKind: "pending" as const,
                showRetry: false
              }
            : paymentIntent.status === "succeeded"
              ? {
                  title: t("completedCheckoutTitle"),
                  body: t("completedCheckoutBody"),
                  returnKind: "success" as const,
                  showRetry: false
                }
              : hasTerminalStatus
                ? {
                    title: t("closedCheckoutTitle"),
                    body: t("closedCheckoutBody"),
                    returnKind: "failed" as const,
                    showRetry: true
                  }
                : null;

  useEffect(() => {
    if (
      paymentIntent === null ||
      !canUseCheckoutSurface ||
      paymentIntent.checkout.mode !== "embedded" ||
      constructorPayload === null ||
      embeddedContainerRef.current === null
    ) {
      return;
    }
    let cancelled = false;
    let blocksApp: InstanceType<
      NonNullable<NonNullable<typeof window.cp>["PaymentBlocks"]>
    > | null = null;
    let revealTimer: number | null = null;

    embeddedCompletionHandledRef.current = false;
    setMountingPaymentForm(true);
    setPaymentFormVisible(false);
    setPaymentError(null);

    void (async () => {
      try {
        await loadCloudpaymentsConstructorScript();
        const PaymentBlocks = window.cp?.PaymentBlocks;
        if (!PaymentBlocks) {
          throw new Error(t("formUnavailable"));
        }
        if (embeddedContainerRef.current === null) {
          return;
        }

        blocksApp = new PaymentBlocks(
          constructorPayload.initializationParams,
          constructorPayload.customizationParams
        );
        blocksApp.mount(embeddedContainerRef.current);
        revealTimer = window.setTimeout(() => {
          if (!cancelled) {
            setPaymentFormVisible(true);
          }
        }, 180);
        blocksApp.on("success", () => {
          if (embeddedCompletionHandledRef.current) {
            return;
          }
          embeddedCompletionHandledRef.current = true;
          router.replace(buildChatReturnHref(paymentIntent, "pending"));
        });
        blocksApp.on("fail", () => {
          setPaymentError(t("paymentFailed"));
        });
        blocksApp.on("destroy", () => {
          if (!cancelled) {
            setMountingPaymentForm(false);
          }
        });
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error && nextError.message.trim().length > 0
              ? nextError.message
              : t("formUnavailable")
          );
        }
      } finally {
        if (!cancelled) {
          setMountingPaymentForm(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (revealTimer !== null) {
        window.clearTimeout(revealTimer);
      }
      if (blocksApp !== null) {
        blocksApp.off("success");
        blocksApp.off("fail");
        blocksApp.off("destroy");
        blocksApp.unmount();
      }
    };
  }, [canUseCheckoutSurface, constructorPayload, paymentIntent, router, t]);

  return (
    <div className="min-h-dvh bg-chrome text-text">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-4 sm:py-6">
          <div className="rounded-[28px] border border-border/80 bg-surface/85 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur-sm sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-text">
              {paymentIntent ? t("titleWithPlan", { plan: planLabel ?? "" }) : t("title")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-text-muted">{t("subtitle")}</p>

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
                {priceLabel ? (
                  <p className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-text">
                    {priceLabel}
                  </p>
                ) : null}

                {staticCheckoutState !== null ? (
                  <div className="mt-6 space-y-4">
                    <div className="rounded-2xl border border-border/70 bg-bg/60 p-4">
                      <p className="text-sm font-medium text-text">{staticCheckoutState.title}</p>
                      <p className="mt-1 text-sm leading-6 text-text-muted">
                        {staticCheckoutState.body}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          router.replace(
                            buildChatReturnHref(paymentIntent, staticCheckoutState.returnKind)
                          )
                        }
                        className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-border/80 bg-bg/70 px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
                      >
                        {t("returnToChat")}
                      </button>
                      {staticCheckoutState.showRetry ? (
                        <Link
                          href={"/app/pricing" as Route}
                          className="flex min-h-11 w-full items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_0_36px_var(--accent-glow)] transition-all hover:bg-accent-hover"
                        >
                          {t("backToPricing")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : paymentIntent.checkout.mode === "manual_test" ? (
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
                      {t("returnToChat")}
                    </button>
                  </div>
                ) : paymentIntent.checkout.mode === "embedded" && constructorPayload ? (
                  <div className="mt-6 space-y-4">
                    <div className="overflow-hidden rounded-[24px] border border-border/70 bg-surface-raised/80 p-4 sm:p-5">
                      {mountingPaymentForm || !paymentFormVisible ? (
                        <div className="flex min-h-[16rem] items-center justify-center gap-3 text-sm text-text-muted">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("loadingPaymentForm")}
                        </div>
                      ) : null}
                      <div
                        ref={embeddedContainerRef}
                        className={cn(
                          "min-h-[16rem] rounded-[20px] bg-[#1c1b1a] transition-opacity duration-200",
                          mountingPaymentForm || !paymentFormVisible ? "opacity-0" : "opacity-100"
                        )}
                      />
                    </div>

                    {paymentError ? (
                      <div className="rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-text-muted">
                        {paymentError}
                      </div>
                    ) : null}

                    <details className="group rounded-2xl border border-border/70 bg-bg/40 p-4 text-sm text-text-muted">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-text transition-colors hover:text-text-muted">
                        <span>{t("paymentHelpTitle")}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="mt-3 space-y-2 leading-6">
                        <p>{t("paymentHelpBodyCloudpayments")}</p>
                        <p>{t("paymentHelpBodyActivation")}</p>
                        <p>{t("paymentHelpBodyRecurring")}</p>
                      </div>
                    </details>

                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() =>
                          router.replace(
                            buildChatReturnHref(
                              paymentIntent,
                              paymentError !== null ? "failed" : "pending"
                            )
                          )
                        }
                        className="text-sm text-text-muted transition-colors hover:text-text"
                      >
                        {t("returnToChat")}
                      </button>
                    </div>
                  </div>
                ) : canUseCheckoutSurface && checkoutUrl ? (
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
                      className="text-sm text-text-muted transition-colors hover:text-text"
                    >
                      {t("returnToChat")}
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
