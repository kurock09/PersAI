"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import type { UserPlanVisibilityState } from "@persai/contracts";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Check, Info, Loader2, ShoppingCart } from "lucide-react";
import {
  getAssistantPlanVisibility,
  postAssistantBillingPackagePaymentIntent
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type PackageType = "image_generate" | "image_edit" | "video_generate";
type PackageOfferItem = UserPlanVisibilityState["packageOffers"]["tools"][number]["offers"][number];
type PackageToolState = UserPlanVisibilityState["packageOffers"]["tools"][number];

type SelectedByType = Record<PackageType, string | null>;

const PACKAGE_TYPE_ORDER: PackageType[] = ["image_generate", "image_edit", "video_generate"];

const PACKAGE_TYPE_META: Record<
  PackageType,
  {
    eyebrow: { ru: string; en: string };
    headline: { ru: string; en: string };
    summaryLabel: { ru: string; en: string };
    disabledHint: { ru: string; en: string };
    emptyHint: { ru: string; en: string };
    info: { ru: string; en: string };
  }
> = {
  image_generate: {
    eyebrow: { ru: "Изображения", en: "Images" },
    headline: { ru: "Создание", en: "Generation" },
    summaryLabel: { ru: "Изображения · Создание", en: "Images · Generation" },
    disabledHint: {
      ru: "Перейдите на тариф, где включена генерация изображений, чтобы купить пакет.",
      en: "Switch to a plan with image generation enabled to buy this package."
    },
    emptyHint: {
      ru: "Для этого типа пока нет доступных пакетов.",
      en: "No packages available for this type yet."
    },
    info: {
      ru: "Создаём изображение по описанию (промту).",
      en: "We create an image from your prompt."
    }
  },
  image_edit: {
    eyebrow: { ru: "Изображения", en: "Images" },
    headline: { ru: "Редактирование", en: "Editing" },
    summaryLabel: { ru: "Изображения · Редактирование", en: "Images · Editing" },
    disabledHint: {
      ru: "Перейдите на тариф, где включено редактирование изображений, чтобы купить пакет.",
      en: "Switch to a plan with image editing enabled to buy this package."
    },
    emptyHint: {
      ru: "Для этого типа пока нет доступных пакетов.",
      en: "No packages available for this type yet."
    },
    info: {
      ru: "Меняем готовое изображение по описанию.",
      en: "We edit an existing image based on your description."
    }
  },
  video_generate: {
    eyebrow: { ru: "Видео", en: "Video" },
    headline: { ru: "Генерация", en: "Generation" },
    summaryLabel: { ru: "Видео · Генерация", en: "Video · Generation" },
    disabledHint: {
      ru: "Перейдите на тариф, где включена генерация видео, чтобы купить пакет.",
      en: "Switch to a plan with video generation enabled to buy this package."
    },
    emptyHint: {
      ru: "Для этого типа пока нет доступных пакетов.",
      en: "No packages available for this type yet."
    },
    info: {
      ru: "Создаём и редактируем видео по описанию.",
      en: "We create and edit videos based on your description."
    }
  }
};

function pickText(
  locale: string,
  value: { ru: string | null; en: string | null } | null | undefined
): string {
  if (!value) return "";
  return locale === "ru" ? value.ru || value.en || "" : value.en || value.ru || "";
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

function formatPackageLabel(locale: string, item: PackageOfferItem): string {
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
    image_generate: false,
    image_edit: false,
    video_generate: false
  };
  if (!visibility) {
    return fallback;
  }
  const packageTools = visibility.packageOffers.tools;
  return {
    image_generate:
      packageTools.find((tool) => tool.toolCode === "image_generate")?.offerableNow ??
      fallback.image_generate,
    image_edit:
      packageTools.find((tool) => tool.toolCode === "image_edit")?.offerableNow ??
      fallback.image_edit,
    video_generate:
      packageTools.find((tool) => tool.toolCode === "video_generate")?.offerableNow ??
      fallback.video_generate
  };
}

function resolvePackageToolStates(
  visibility: UserPlanVisibilityState | null
): Record<PackageType, PackageToolState | null> {
  const tools = visibility?.packageOffers.tools ?? [];
  return {
    image_generate: tools.find((tool) => tool.toolCode === "image_generate") ?? null,
    image_edit: tools.find((tool) => tool.toolCode === "image_edit") ?? null,
    video_generate: tools.find((tool) => tool.toolCode === "video_generate") ?? null
  };
}

function resolveDisabledHint(
  locale: string,
  type: PackageType,
  toolState: PackageToolState | null
): string {
  const meta = PACKAGE_TYPE_META[type];
  if (toolState?.offerReason === "no_public_packages") {
    return locale === "ru"
      ? "Для этого типа сейчас нет публичных пакетов."
      : "There are no public packages for this type right now.";
  }
  return pickMetaText(locale, meta.disabledHint);
}

function PackageChoiceRow({
  item,
  selected,
  disabled,
  locale,
  onSelect
}: {
  item: PackageOfferItem;
  selected: boolean;
  disabled: boolean;
  locale: string;
  onSelect: () => void;
}) {
  const subtitle = pickText(locale, item.subtitle).trim();
  const highlighted = item.highlighted;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all",
        "border-border/80 bg-bg/55 text-text hover:border-border hover:bg-surface-hover/70",
        // User selection: quiet accent border on top of the default surface.
        selected && "border-accent/60 bg-accent/5 hover:border-accent/70",
        disabled && "cursor-not-allowed opacity-45 hover:border-border/80 hover:bg-bg/55"
      )}
    >
      {/* Admin-controlled premium hint: a thin gold rail on the left edge.
          Quiet by default, independent of user selection — the row stays the
          same surface as its neighbors so the rail reads as an "indicator"
          rather than a highlighted block. */}
      {highlighted ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-full bg-gradient-to-b from-[rgba(214,170,70,0.95)] via-[rgba(255,226,150,0.95)] to-[rgba(176,132,33,0.95)]"
        />
      ) : null}
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected
              ? "border-accent bg-accent text-white"
              : "border-border/80 bg-surface text-transparent group-hover:border-border"
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{formatPackageLabel(locale, item)}</p>
          {subtitle.length > 0 ? (
            <p className="mt-0.5 text-xs text-text-subtle">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          highlighted ? "text-[rgba(140,98,18,1)] dark:text-[rgba(232,196,118,1)]" : "text-text"
        )}
      >
        {formatPrice(item.amountMinor, item.currency, locale)}
      </span>
    </button>
  );
}

function PackageTypeCard({
  type,
  items,
  selectedId,
  toolState,
  locale,
  onSelect
}: {
  type: PackageType;
  items: PackageOfferItem[];
  selectedId: string | null;
  toolState: PackageToolState | null;
  locale: string;
  onSelect: (id: string) => void;
}) {
  const meta = PACKAGE_TYPE_META[type];
  const toolEnabled = toolState?.offerableNow === true;

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
        <p className="text-[10px] font-semibold uppercase leading-4 tracking-[0.22em] text-text-subtle">
          {pickMetaText(locale, meta.eyebrow)}
        </p>
        <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.01em] text-text">
          {pickMetaText(locale, meta.headline)}
        </h2>
        <div className="mt-4 h-px w-full bg-gradient-to-r from-border/80 via-border/40 to-transparent" />
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
          {resolveDisabledHint(locale, type, toolState)}
        </div>
      ) : null}
      <div
        className="mt-5 flex items-start gap-2 border-t border-border/40 pt-4 text-xs leading-relaxed text-text-subtle"
        title={pickMetaText(locale, meta.info)}
      >
        <Info className="mt-0.5 h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
        <span>{pickMetaText(locale, meta.info)}</span>
      </div>
    </section>
  );
}

function SummaryBlock({
  selectedItems,
  purchasing,
  hasMixedCurrencies,
  canPurchase,
  locale,
  expiryHint,
  onPurchase
}: {
  selectedItems: Array<PackageOfferItem | null>;
  purchasing: boolean;
  hasMixedCurrencies: boolean;
  canPurchase: boolean;
  locale: string;
  expiryHint: string;
  onPurchase: () => void;
}) {
  const chosenWithType: Array<{ type: PackageType; item: PackageOfferItem }> = [];
  PACKAGE_TYPE_ORDER.forEach((type, index) => {
    const item = selectedItems[index];
    if (item) {
      chosenWithType.push({ type, item });
    }
  });

  const totalAmountMinor = chosenWithType.reduce((sum, { item }) => sum + item.amountMinor, 0);
  const currency = chosenWithType[0]?.item.currency ?? "RUB";
  const hasSelection = chosenWithType.length > 0;
  const buyDisabled = purchasing || !hasSelection || hasMixedCurrencies || !canPurchase;

  const totalLabel = !hasSelection
    ? "—"
    : hasMixedCurrencies
      ? locale === "ru"
        ? "Разные валюты"
        : "Mixed currencies"
      : formatPrice(totalAmountMinor, currency, locale);

  return (
    <section className="relative overflow-hidden rounded-[32px] border border-border/80 bg-surface/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.12)] backdrop-blur-sm sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-text/10 to-transparent"
      />
      <div className="relative z-10">
        <p className="text-[10px] font-semibold uppercase leading-4 tracking-[0.22em] text-text-subtle">
          {locale === "ru" ? "Ваш выбор" : "Your selection"}
        </p>
        <div className="mt-4 h-px w-full bg-gradient-to-r from-border/80 via-border/40 to-transparent" />
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <div className="flex-1">
          {!hasSelection ? (
            <p className="text-sm text-text-muted">
              {locale === "ru"
                ? "Выберите хотя бы один пакет в категориях выше."
                : "Pick at least one package from the categories above."}
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {chosenWithType.map(({ type, item }) => (
                <li
                  key={type}
                  className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-sm text-text">
                    <span className="text-text-subtle">
                      {pickMetaText(locale, PACKAGE_TYPE_META[type].summaryLabel)}
                    </span>{" "}
                    <span className="font-semibold text-text">·</span>{" "}
                    <span className="font-semibold text-text">
                      {formatPackageLabel(locale, item)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
                    {formatPrice(item.amountMinor, item.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-4 lg:w-[300px] lg:shrink-0 lg:border-l lg:border-border/40 lg:pl-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-subtle">
              {locale === "ru" ? "Сумма" : "Total"}
            </p>
            <p className="mt-1.5 text-2xl font-semibold tracking-[-0.03em] text-text">
              {totalLabel}
            </p>
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-text-subtle">
              <Info className="mt-px h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
              <span>{expiryHint}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onPurchase}
            disabled={buyDisabled}
            className={cn(
              "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-all",
              buyDisabled
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
        </div>
      </div>
    </section>
  );
}

export default function PackagesPage() {
  const { getToken, isLoaded } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("settings");
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
      const visibility = await getAssistantPlanVisibility(token);
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
    const map: Record<PackageType, PackageOfferItem[]> = {
      image_generate: [],
      image_edit: [],
      video_generate: []
    };
    for (const tool of planVisibility?.packageOffers.tools ?? []) {
      if (tool.toolCode in map) {
        map[tool.toolCode as PackageType] = [...tool.offers];
      }
    }
    return map;
  }, [planVisibility]);

  const toolAvailability = useMemo(() => resolveToolAvailability(planVisibility), [planVisibility]);
  const packageToolStates = useMemo(
    () => resolvePackageToolStates(planVisibility),
    [planVisibility]
  );
  const offersById = useMemo(
    () =>
      new Map(
        Object.values(packagesByType)
          .flat()
          .map((offer) => [offer.id, offer])
      ),
    [packagesByType]
  );

  const selectedItems = useMemo(
    () =>
      PACKAGE_TYPE_ORDER.map((type) => {
        const selectedId = selectedByType[type];
        return selectedId ? (offersById.get(selectedId) ?? null) : null;
      }),
    [offersById, selectedByType]
  );

  const chosenItems = selectedItems.filter((item): item is PackageOfferItem => item !== null);
  const currency = chosenItems[0]?.currency ?? "RUB";
  const hasMixedCurrencies =
    chosenItems.length > 0 && chosenItems.some((item) => item.currency !== currency);
  const canPurchasePackages =
    (planVisibility?.packageOffers.packagesPurchase?.paymentMethodClasses.length ?? 0) > 0;

  useEffect(() => {
    setSelectedByType((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const type of PACKAGE_TYPE_ORDER) {
        const selectedId = prev[type];
        const toolState = packageToolStates[type];
        const offerStillPresent =
          selectedId !== null && packagesByType[type].some((offer) => offer.id === selectedId);
        if (selectedId !== null && (!offerStillPresent || toolState?.offerableNow !== true)) {
          next[type] = null;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [packageToolStates, packagesByType]);

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
    if (chosenItems.length === 0 || hasMixedCurrencies || !canPurchasePackages) return;
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
      const paymentMethodClass =
        planVisibility?.packageOffers.packagesPurchase?.paymentMethodClasses[0];
      if (!paymentMethodClass) {
        setError(
          locale === "ru" ? "Покупка сейчас недоступна." : "Purchase is unavailable right now."
        );
        return;
      }
      const result = await postAssistantBillingPackagePaymentIntent(token, {
        packageItemIds: chosenItems.map((item) => item.id),
        paymentMethodClass,
        idempotencyKey,
        returnUrl
      });
      router.push(`/app/billing/checkout/${encodeURIComponent(result.id)}` as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed.");
    } finally {
      setPurchasing(false);
    }
  }, [
    canPurchasePackages,
    chosenItems,
    hasMixedCurrencies,
    locale,
    planVisibility,
    resolveBillingToken,
    router
  ]);

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

        {!loading &&
        !error &&
        Object.values(packagesByType).every((items) => items.length === 0) ? (
          <div className="mx-auto mt-10 w-full max-w-2xl rounded-3xl border border-border/80 bg-surface/70 p-6 text-center">
            <p className="text-lg font-medium text-text">
              {locale === "ru"
                ? "Пакеты временно недоступны."
                : "No packages available at this time."}
            </p>
          </div>
        ) : null}

        {!loading && !error && Object.values(packagesByType).some((items) => items.length > 0) ? (
          <div className="mt-10 space-y-5">
            <div className="grid items-stretch gap-5 lg:grid-cols-3">
              {PACKAGE_TYPE_ORDER.map((type) => (
                <PackageTypeCard
                  key={type}
                  type={type}
                  items={packagesByType[type]}
                  selectedId={selectedByType[type]}
                  toolState={packageToolStates[type]}
                  locale={locale}
                  onSelect={(id) => handleSelect(type, id)}
                />
              ))}
            </div>
            <SummaryBlock
              selectedItems={selectedItems}
              purchasing={purchasing}
              hasMixedCurrencies={hasMixedCurrencies}
              canPurchase={canPurchasePackages}
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
