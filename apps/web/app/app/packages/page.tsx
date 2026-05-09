"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ChevronLeft, Loader2, ShoppingCart } from "lucide-react";
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
  const badge = pickText(locale, item.badge);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-zinc-400",
        selected
          ? "border-zinc-300/40 bg-zinc-800/80 shadow-lg shadow-zinc-900/60"
          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-850"
      )}
    >
      {/* Watermark */}
      <span
        className={cn(
          "pointer-events-none absolute inset-0 text-zinc-400",
          selected ? "opacity-[0.12]" : "opacity-[0.05] group-hover:opacity-[0.09]"
        )}
      >
        {meta.watermark}
      </span>

      {/* Selection indicator */}
      {selected && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300/30 bg-zinc-300/10">
          <span className="h-2 w-2 rounded-full bg-zinc-200" />
        </span>
      )}

      <div className="relative z-10">
        {/* Units headline */}
        <div className="text-4xl font-semibold tabular-nums tracking-tight text-zinc-100">
          {item.units}
        </div>
        <div className="mt-0.5 text-[11px] uppercase tracking-widest text-zinc-500">
          {locale === "ru" ? "единиц" : "units"}
        </div>

        {/* Title */}
        {title && <div className="mt-3 text-sm font-medium text-zinc-300">{title}</div>}

        {/* Badge */}
        {badge && (
          <div className="mt-1.5">
            <span className="inline-block rounded-full border border-zinc-600/60 px-2 py-0.5 text-[10px] text-zinc-400">
              {badge}
            </span>
          </div>
        )}

        {/* Price */}
        <div className="mt-4 text-lg font-semibold text-zinc-100">
          {formatPrice(item.amountMinor, item.currency, locale)}
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
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
        {pickText(locale, meta.label)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
    </div>
  );
}

export default function PackagesPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settings");
  const [packages, setPackages] = useState<MediaPackageCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [purchasing, setPurchasing] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await getPublicMediaPackages(token);
      setPackages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load packages.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

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
    const token = await getToken();
    if (!token) return;
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
  }, [selectedItems, hasMixedCurrencies, getToken, router]);

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
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href={"/app/pricing" as Route}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {locale === "ru" ? "Тарифы" : "Pricing"}
        </Link>
      </div>

      {/* Heading */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          {locale === "ru" ? "Пакеты медиа" : "Media packages"}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          {locale === "ru"
            ? "Разовые пакеты дополнительных лимитов. Действуют до конца текущего расчётного периода."
            : "One-time add-on quota boosts. Active until the end of your current billing period."}
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-900/40 bg-red-950/30 p-4 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && packages.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500">
          {locale === "ru" ? "Пакеты временно недоступны." : "No packages available at this time."}
        </div>
      )}

      {!loading && packages.length > 0 && (
        <div className="space-y-8">
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
      )}

      {/* Sticky purchase bar */}
      {selectedItems.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-200">
                {selectedItems.length === 1
                  ? locale === "ru"
                    ? "1 пакет выбран"
                    : "1 package selected"
                  : locale === "ru"
                    ? `${selectedItems.length} пакета выбрано`
                    : `${selectedItems.length} packages selected`}
              </div>
              {hasMixedCurrencies ? (
                <div className="mt-0.5 text-xs text-amber-500/80">
                  {locale === "ru"
                    ? "Разные валюты — выберите одну"
                    : "Mixed currencies — select one"}
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-zinc-500">
                  {locale === "ru" ? "Итого: " : "Total: "}
                  <span className="text-zinc-300">
                    {formatPrice(totalAmountMinor, currency, locale)}
                  </span>
                </div>
              )}
              <div className="mt-0.5 text-[10px] text-zinc-600">
                {t("monthlyMediaBonusExpiryHint")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handlePurchase()}
              disabled={purchasing || hasMixedCurrencies}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
                purchasing || hasMixedCurrencies
                  ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                  : "bg-zinc-100 text-zinc-900 hover:bg-white active:bg-zinc-200"
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
      )}

      {/* Bottom padding for sticky bar */}
      {selectedItems.length > 0 && <div className="h-24" />}
    </div>
  );
}
