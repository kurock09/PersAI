"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import type { UserPlanVisibilityState } from "@persai/contracts";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Check, Loader2, ShoppingCart } from "lucide-react";
import {
  getAssistantPlanVisibility,
  getPublicMediaPackages,
  postAssistantBillingPackagePaymentIntent,
  type MediaPackageCatalogItem
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type PackageType = "image_generate" | "image_edit" | "video_generate";

type SelectedByType = Record<PackageType, string | null>;

const PACKAGE_TYPE_ORDER: PackageType[] = ["image_generate", "image_edit", "video_generate"];

const PACKAGE_TYPE_META: Record<
  PackageType,
  {
    title: { ru: string; en: string };
    disabledHint: { ru: string; en: string };
    emptyHint: { ru: string; en: string };
  }
> = {
  image_generate: {
    title: { ru: "Генерация изображений", en: "Image generation" },
    disabledHint: {
      ru: "Перейдите на тариф, где включена генерация изображений, чтобы купить пакет.",
      en: "Switch to a plan with image generation enabled to buy this package."
    },
    emptyHint: {
      ru: "Для этого типа пока нет доступных пакетов.",
      en: "No packages available for this type yet."
    }
  },
  image_edit: {
    title: { ru: "Редактирование изображений", en: "Image editing" },
    disabledHint: {
      ru: "Перейдите на тариф, где включено редактирование изображений, чтобы купить пакет.",
      en: "Switch to a plan with image editing enabled to buy this package."
    },
    emptyHint: {
      ru: "Для этого типа пока нет доступных пакетов.",
      en: "No packages available for this type yet."
    }
  },
  video_generate: {
    title: { ru: "Генерация видео", en: "Video generation" },
    disabledHint: {
      ru: "Перейдите на тариф, где включена генерация видео, чтобы купить пакет.",
      en: "Switch to a plan with video generation enabled to buy this package."
    },
    emptyHint: {
      ru: "Для этого типа пока нет доступных пакетов.",
      en: "No packages available for this type yet."
    }
  }
};

function pickText(locale: string, value: { ru: string; en: string } | null | undefined): string {
  if (!value) return "";
  return locale === "ru" ? value.ru || value.en : value.en || value.ru;
}

function pickMetaText(locale: string, value: { ru: string; en: string }): string {
  return locale === "ru" ? value.ru : value.en;
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

function formatPackageLabel(locale: string, item: MediaPackageCatalogItem): string {
  const title = pickText(locale, item.title).trim();
  if (title.length > 0) {
    return title;
  }
  if (locale === "ru") {
    return `${item.units} единиц`;
  }
  return `${item.units} units`;
}

function resolveToolAvailability(
  visibility: UserPlanVisibilityState | null
): Record<PackageType, boolean> {
  const fallback: Record<PackageType, boolean> = {
    image_generate: true,
    image_edit: true,
    video_generate: true
  };
  if (!visibility) {
    return fallback;
  }
  const toolLimits = visibility.limits.toolDailyLimits;
  return {
    image_generate:
      toolLimits.find((tool) => tool.toolCode === "image_generate")?.active ??
      fallback.image_generate,
    image_edit:
      toolLimits.find((tool) => tool.toolCode === "image_edit")?.active ?? fallback.image_edit,
    video_generate:
      toolLimits.find((tool) => tool.toolCode === "video_generate")?.active ??
      fallback.video_generate
  };
}

function PackageChoiceRow({
  item,
  selected,
  disabled,
  locale,
  onSelect
}: {
  item: MediaPackageCatalogItem;
  selected: boolean;
  disabled: boolean;
  locale: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all",
        selected
          ? "border-accent/40 bg-accent/10 text-text shadow-[0_0_0_1px_rgba(0,0,0,0.02)]"
          : "border-border/80 bg-bg/55 text-text hover:border-border hover:bg-surface-hover/70",
        disabled && "cursor-not-allowed opacity-45 hover:border-border/80 hover:bg-bg/55"
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">{formatPackageLabel(locale, item)}</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-text-subtle">
          {item.units} {locale === "ru" ? "единиц" : "units"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-text">
          {formatPrice(item.amountMinor, item.currency, locale)}
        </span>
        <span
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
            selected
              ? "border-accent/40 bg-accent text-white"
              : "border-border/80 bg-surface text-transparent"
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

function PackageTypeCard({
  type,
  items,
  selectedId,
  toolEnabled,
  locale,
  onSelect
}: {
  type: PackageType;
  items: MediaPackageCatalogItem[];
  selectedId: string | null;
  toolEnabled: boolean;
  locale: string;
  onSelect: (id: string) => void;
}) {
  const meta = PACKAGE_TYPE_META[type];

  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-[32px] border border-border/80 bg-surface/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.12)] backdrop-blur-sm sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-text/10 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-28 w-28 rounded-full bg-white/10 blur-3xl"
      />
      <div className="relative z-10">
        <p className="min-h-[2.7rem] text-[11px] font-semibold uppercase leading-5 tracking-[0.2em] text-text-subtle">
          {pickMetaText(locale, meta.title)}
        </p>
        <div className="mt-3 h-px w-full bg-gradient-to-r from-border/80 via-border/40 to-transparent" />
      </div>
      <div className="mt-6 flex-1 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-border/80 bg-bg/50 px-4 py-4 text-sm text-text-muted">
            {pickMetaText(locale, meta.emptyHint)}
          </div>
        ) : (
          items.map((item) => (
            <PackageChoiceRow
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              disabled={!toolEnabled}
              locale={locale}
              onSelect={() => onSelect(item.id)}
            />
          ))
        )}
      </div>
      {!toolEnabled ? (
        <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-text-muted">
          {pickMetaText(locale, meta.disabledHint)}
        </div>
      ) : null}
    </section>
  );
}

function SummaryCard({
  selectedItems,
  purchasing,
  hasMixedCurrencies,
  locale,
  expiryHint,
  onPurchase
}: {
  selectedItems: Array<MediaPackageCatalogItem | null>;
  purchasing: boolean;
  hasMixedCurrencies: boolean;
  locale: string;
  expiryHint: string;
  onPurchase: () => void;
}) {
  const chosenItems = selectedItems.filter(
    (item): item is MediaPackageCatalogItem => item !== null
  );
  const totalAmountMinor = chosenItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const currency = chosenItems[0]?.currency ?? "RUB";

  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-[32px] border border-border/80 bg-surface/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.12)] backdrop-blur-sm sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-text/10 to-transparent"
      />
      <div className="relative z-10">
        <p className="min-h-[2.7rem] text-[11px] font-semibold uppercase leading-5 tracking-[0.2em] text-text-subtle">
          {locale === "ru" ? "Итог" : "Summary"}
        </p>
        <div className="mt-3 h-px w-full bg-gradient-to-r from-border/80 via-border/40 to-transparent" />
      </div>
      <div className="mt-6 flex-1 space-y-3">
        {PACKAGE_TYPE_ORDER.map((type, index) => {
          const item = selectedItems[index] ?? null;
          return (
            <div key={type} className="rounded-2xl border border-border/80 bg-bg/55 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">
                {pickMetaText(locale, PACKAGE_TYPE_META[type].title)}
              </p>
              <p className="mt-2 text-sm font-semibold text-text">
                {item
                  ? formatPackageLabel(locale, item)
                  : locale === "ru"
                    ? "Не выбрано"
                    : "Not selected"}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {item ? formatPrice(item.amountMinor, item.currency, locale) : "—"}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-6 rounded-2xl border border-border/80 bg-bg/55 px-4 py-4">
        <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">
          {locale === "ru" ? "Сумма" : "Total"}
        </p>
        <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-text">
          {chosenItems.length === 0
            ? "—"
            : hasMixedCurrencies
              ? locale === "ru"
                ? "Разные валюты"
                : "Mixed currencies"
              : formatPrice(totalAmountMinor, currency, locale)}
        </p>
        <p className="mt-2 text-xs text-text-subtle">{expiryHint}</p>
      </div>
      <button
        type="button"
        onClick={onPurchase}
        disabled={purchasing || chosenItems.length === 0 || hasMixedCurrencies}
        className={cn(
          "mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-all",
          purchasing || chosenItems.length === 0 || hasMixedCurrencies
            ? "cursor-not-allowed border border-border/80 bg-surface/60 text-text-subtle"
            : "bg-accent text-white shadow-[0_0_36px_var(--accent-glow)] hover:bg-accent-hover"
        )}
      >
        {purchasing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ShoppingCart className="h-4 w-4" />
        )}
        {locale === "ru" ? "Купить" : "Buy"}
      </button>
    </section>
  );
}

export default function PackagesPage() {
  const { getToken, isLoaded } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settings");
  const [packages, setPackages] = useState<MediaPackageCatalogItem[]>([]);
  const [planVisibility, setPlanVisibility] = useState<UserPlanVisibilityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedByType, setSelectedByType] = useState<SelectedByType>({
    image_generate: null,
    image_edit: null,
    video_generate: null
  });
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
      const [catalog, visibility] = await Promise.all([
        getPublicMediaPackages(token),
        getAssistantPlanVisibility(token)
      ]);
      setPackages(catalog);
      setPlanVisibility(visibility);
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
    for (const type of PACKAGE_TYPE_ORDER) {
      map[type].sort((a, b) => {
        if (a.displayOrder !== b.displayOrder) {
          return a.displayOrder - b.displayOrder;
        }
        return a.units - b.units;
      });
    }
    return map;
  }, [packages]);

  const toolAvailability = useMemo(() => resolveToolAvailability(planVisibility), [planVisibility]);

  const selectedItems = useMemo(
    () =>
      PACKAGE_TYPE_ORDER.map((type) => {
        const selectedId = selectedByType[type];
        return selectedId ? (packages.find((item) => item.id === selectedId) ?? null) : null;
      }),
    [packages, selectedByType]
  );

  const chosenItems = selectedItems.filter(
    (item): item is MediaPackageCatalogItem => item !== null
  );
  const currency = chosenItems[0]?.currency ?? "RUB";
  const hasMixedCurrencies =
    chosenItems.length > 0 && chosenItems.some((item) => item.currency !== currency);

  const handleSelect = useCallback(
    (type: PackageType, id: string) => {
      if (!toolAvailability[type]) {
        return;
      }
      setSelectedByType((prev) => ({
        ...prev,
        [type]: prev[type] === id ? null : id
      }));
    },
    [toolAvailability]
  );

  const handlePurchase = useCallback(async () => {
    if (chosenItems.length === 0 || hasMixedCurrencies) return;
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
        packageItemIds: chosenItems.map((item) => item.id),
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
  }, [chosenItems, hasMixedCurrencies, locale, resolveBillingToken, router]);

  return (
    <div className="min-h-dvh bg-chrome text-text">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl text-center">
          <header className="pt-4 sm:pt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-subtle">
              {locale === "ru" ? "Дополнительные лимиты" : "Additional limits"}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-text sm:text-5xl">
              {locale === "ru" ? "Пакеты медиа" : "Media packages"}
            </h1>
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
          <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-4">
            {PACKAGE_TYPE_ORDER.map((type) => (
              <PackageTypeCard
                key={type}
                type={type}
                items={packagesByType[type]}
                selectedId={selectedByType[type]}
                toolEnabled={toolAvailability[type]}
                locale={locale}
                onSelect={(id) => handleSelect(type, id)}
              />
            ))}
            <SummaryCard
              selectedItems={selectedItems}
              purchasing={purchasing}
              hasMixedCurrencies={hasMixedCurrencies}
              locale={locale}
              expiryHint={t("monthlyMediaBonusExpiryHint")}
              onPurchase={() => void handlePurchase()}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
