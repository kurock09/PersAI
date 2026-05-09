"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Check, ChevronLeft, Loader2, ShoppingCart } from "lucide-react";
import {
  getPublicMediaPackages,
  postAssistantBillingPackagePaymentIntent,
  type MediaPackageCatalogItem
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type PackageType = "image_generate" | "image_edit" | "video_generate";

function pickText(locale: string, value: { ru: string; en: string } | null | undefined): string {
  if (!value) return "";
  return locale === "ru" ? value.ru || value.en : value.en || value.ru;
}

function formatPrice(amountMinor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2
    }).format(amountMinor / 100);
  } catch {
    return `${amountMinor / 100} ${currency}`;
  }
}

const PACKAGE_TYPE_META: Record<
  PackageType,
  {
    label: { ru: string; en: string };
    watermark: ReactNode;
  }
> = {
  image_generate: {
    label: { ru: "Генерация изображений", en: "Image generation" },
    watermark: (
      <svg
        viewBox="0 0 120 120"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full transition-opacity duration-300 ease-out"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.7"
      >
        <rect x="14" y="14" width="92" height="92" rx="8" />
        <circle cx="60" cy="52" r="16" />
        <path d="M14 84 L38 58 L58 78 L80 54 L106 84" />
      </svg>
    )
  },
  image_edit: {
    label: { ru: "Редактирование изображений", en: "Image editing" },
    watermark: (
      <svg
        viewBox="0 0 120 120"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full transition-opacity duration-300 ease-out"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.7"
      >
        <rect x="16" y="16" width="88" height="88" rx="8" />
        <path d="M38 82 L54 44 L70 82" />
        <path d="M43 68 H67" />
        <path d="M80 40 L94 26 M94 26 L104 36 L90 50 Z" />
      </svg>
    )
  },
  video_generate: {
    label: { ru: "Генерация видео", en: "Video generation" },
    watermark: (
      <svg
        viewBox="0 0 120 120"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full transition-opacity duration-300 ease-out"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.7"
      >
        <rect x="10" y="30" width="72" height="60" rx="6" />
        <path d="M82 48 L110 36 L110 84 L82 72 Z" />
        <line x1="28" y1="44" x2="28" y2="76" />
        <line x1="44" y1="40" x2="44" y2="80" />
        <line x1="60" y1="44" x2="60" y2="76" />
      </svg>
    )
  }
};

const PACKAGE_TYPE_ORDER: PackageType[] = ["image_generate", "image_edit", "video_generate"];

function PackageCard({
  item,
  selected,
  onClick,
  locale
}: {
  item: MediaPackageCatalogItem;
  selected: boolean;
  onClick: () => void;
  locale: string;
}) {
  const meta = PACKAGE_TYPE_META[item.packageType];
  const title = pickText(locale, item.title);
  const subtitle = pickText(locale, item.subtitle);
  const badge = pickText(locale, item.badge);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-full min-h-[18rem] flex-col overflow-hidden rounded-[28px] border p-5 text-left shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur-sm transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_32px_96px_rgba(0,0,0,0.22)] focus:outline-none focus:ring-2 focus:ring-accent/40 sm:p-6",
        selected
          ? "border-transparent [background:linear-gradient(180deg,rgba(255,238,190,0.16),rgba(255,248,230,0.05))_padding-box,linear-gradient(135deg,rgba(255,226,150,0.82),rgba(214,170,70,0.48),rgba(255,248,230,0.24),rgba(176,132,33,0.58))_border-box] dark:[background:var(--surface)]"
          : "border-border/80 bg-surface/80 hover:border-accent/35"
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-0 text-text transition-opacity",
          selected ? "opacity-[0.11]" : "opacity-[0.045] group-hover:opacity-[0.08]"
        )}
      >
        {meta.watermark}
      </span>

      <div
        className={cn(
          "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
          selected ? "via-[#f0d48a]/80" : "via-accent/40"
        )}
      />

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex min-h-8 items-center justify-between gap-2">
          {badge ? (
            <span className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
              {badge}
            </span>
          ) : (
            <span />
          )}
          {selected ? (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-accent/30 bg-accent/12 text-accent">
              <Check className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>

        <div className="mt-5 text-4xl font-semibold tabular-nums tracking-[-0.04em] text-text">
          {item.units}
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-text-subtle">
          {locale === "ru" ? "единиц" : "units"}
        </div>

        <div className="mt-5">
          {title ? (
            <p className="text-lg font-semibold tracking-[-0.02em] text-text">{title}</p>
          ) : null}
          {subtitle ? <p className="mt-2 text-sm leading-6 text-text-muted">{subtitle}</p> : null}
        </div>

        <div className="mt-auto border-t border-border/70 pt-5">
          <p className="text-2xl font-semibold tracking-[-0.03em] text-text">
            {formatPrice(item.amountMinor, item.currency, locale)}
          </p>
        </div>
      </div>
    </button>
  );
}

function PackageTypeGroup({
  type,
  items,
  selectedIds,
  onToggle,
  locale
}: {
  type: PackageType;
  items: MediaPackageCatalogItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  locale: string;
}) {
  const meta = PACKAGE_TYPE_META[type];
  if (items.length === 0) return null;

  return (
    <section className="rounded-[32px] border border-border/80 bg-surface/55 p-5 backdrop-blur-sm sm:p-6">
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
          {pickText(locale, meta.label)}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        {items.map((item) => (
          <PackageCard
            key={item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            onClick={() => onToggle(item.id)}
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
}

export default function PackagesPage() {
  const { getToken, isLoaded } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settings");
  const [packages, setPackages] = useState<MediaPackageCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [purchasing, setPurchasing] = useState(false);

  const resolveBillingToken = useCallback(async (): Promise<string | null> => {
    if (!isLoaded) {
      return null;
    }
    return (await getToken({ skipCache: true })) ?? (await getToken()) ?? null;
  }, [getToken, isLoaded]);

  const load = useCallback(async () => {
    if (!isLoaded) {
      return;
    }
    const token = await resolveBillingToken();
    if (!token) {
      setError(
        locale === "ru"
          ? "Сессия истекла. Обновите страницу."
          : "Session expired. Refresh the page."
      );
      setLoading(false);
      return;
    }
    try {
      const data = await getPublicMediaPackages(token);
      setPackages(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load packages.");
    } finally {
      setLoading(false);
    }
  }, [isLoaded, locale, resolveBillingToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedItems = useMemo(
    () => packages.filter((p) => selectedIds.has(p.id)),
    [packages, selectedIds]
  );

  const totalAmountMinor = selectedItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const currency = selectedItems[0]?.currency ?? "RUB";
  const hasMixedCurrencies =
    selectedItems.length > 0 && selectedItems.some((item) => item.currency !== currency);

  const handlePurchase = useCallback(async () => {
    if (selectedItems.length === 0 || hasMixedCurrencies) return;
    const token = await resolveBillingToken();
    if (!token) {
      setError(
        locale === "ru"
          ? "Сессия истекла. Обновите страницу."
          : "Session expired. Refresh the page."
      );
      return;
    }
    setPurchasing(true);
    setError(null);
    try {
      const idempotencyKey = `pkg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const returnUrl = `${window.location.origin}/app/packages`;
      const result = await postAssistantBillingPackagePaymentIntent(token, {
        packageItemIds: selectedItems.map((i) => i.id),
        paymentMethodClass: "card",
        idempotencyKey,
        returnUrl
      });
      router.push(`/app/billing/checkout/${encodeURIComponent(result.id)}` as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed.");
    } finally {
      setPurchasing(false);
    }
  }, [selectedItems, hasMixedCurrencies, locale, resolveBillingToken, router]);

  const packagesByType = useMemo(() => {
    const map: Record<PackageType, MediaPackageCatalogItem[]> = {
      image_generate: [],
      image_edit: [],
      video_generate: []
    };
    for (const pkg of packages) {
      if (pkg.packageType in map) {
        map[pkg.packageType].push(pkg);
      }
    }
    return map;
  }, [packages]);

  return (
    <div className="min-h-dvh bg-chrome text-text">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pb-[max(7rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href={"/app/pricing" as Route}
            className="inline-flex items-center gap-1.5 text-[11px] text-text-subtle transition-colors hover:text-text"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {locale === "ru" ? "Тарифы" : "Pricing"}
          </Link>

          <header className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
              {locale === "ru" ? "Дополнительные лимиты" : "Additional limits"}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-text sm:text-5xl">
              {locale === "ru" ? "Пакеты медиа" : "Media packages"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-text-muted sm:text-base">
              {locale === "ru"
                ? "Разовые пакеты дополнительных лимитов. Действуют до конца текущего расчётного периода."
                : "One-time add-on quota boosts. Active until the end of your current billing period."}
            </p>
          </header>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mx-auto mt-8 w-full max-w-3xl rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        {!loading && !error && packages.length === 0 ? (
          <div className="mx-auto mt-10 w-full max-w-2xl rounded-3xl border border-border/80 bg-surface/70 p-6 text-center">
            <p className="text-lg font-medium text-text">
              {locale === "ru"
                ? "Пакеты временно недоступны."
                : "No packages available at this time."}
            </p>
          </div>
        ) : null}

        {!loading && !error && packages.length > 0 ? (
          <div className="mt-10 space-y-5">
            {PACKAGE_TYPE_ORDER.map((type) => (
              <PackageTypeGroup
                key={type}
                type={type}
                items={packagesByType[type]}
                selectedIds={selectedIds}
                onToggle={toggleItem}
                locale={locale}
              />
            ))}
          </div>
        ) : null}
      </div>

      {selectedItems.length > 0 ? (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/80 bg-chrome/92 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">
                {selectedItems.length === 1
                  ? locale === "ru"
                    ? "Выбран 1 пакет"
                    : "1 package selected"
                  : locale === "ru"
                    ? `Выбрано ${selectedItems.length} пакета`
                    : `${selectedItems.length} packages selected`}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {hasMixedCurrencies ? (
                  locale === "ru" ? (
                    "Разные валюты: выберите пакеты в одной валюте"
                  ) : (
                    "Mixed currencies: select one currency"
                  )
                ) : (
                  <>
                    {locale === "ru" ? "Итого: " : "Total: "}
                    <span className="font-medium text-text">
                      {formatPrice(totalAmountMinor, currency, locale)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-1 text-[10px] text-text-subtle">
                {t("monthlyMediaBonusExpiryHint")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handlePurchase()}
              disabled={purchasing || hasMixedCurrencies}
              className={cn(
                "inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-all",
                purchasing || hasMixedCurrencies
                  ? "cursor-not-allowed border border-border/80 bg-surface/60 text-text-subtle"
                  : "bg-accent px-6 text-white shadow-[0_0_36px_var(--accent-glow)] hover:bg-accent-hover"
              )}
            >
              {purchasing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShoppingCart className="h-4 w-4" />
              )}
              {locale === "ru" ? "Купить" : "Buy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
