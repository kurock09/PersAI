import type { MediaPackageCatalogItemState, MediaPackageType } from "./media-package.types";

export const DEFAULT_QUOTA_PACKAGES_PAGE_PATH = "/app/packages" as const;
export const QUOTA_PACKAGE_PAYMENT_METHOD_CLASSES = ["card", "sbp_qr"] as const;

type QuotaPackagePaymentMethodClass = (typeof QUOTA_PACKAGE_PAYMENT_METHOD_CLASSES)[number];

export type QuotaOfferLocalizedText = {
  ru: string | null;
  en: string | null;
};

export type QuotaOfferState = {
  packagesPurchase: {
    path: string;
    url: string | null;
    paymentMethodClasses: QuotaPackagePaymentMethodClass[];
  } | null;
  tools: Array<{
    toolCode: MediaPackageType;
    available: boolean;
    offerableNow: boolean;
    offerReason: "available" | "no_public_packages" | "tool_not_enabled_on_current_plan";
    preferredOfferKind: "none" | "package_only" | "plan_upgrade_only" | "plan_upgrade_or_package";
    preferredPackageIds: string[];
    preferredUpgradePlanCode: string | null;
    upgradePlanCodes: string[];
    offers: Array<{
      id: string;
      toolCode: MediaPackageType;
      units: number;
      amountMinor: number;
      currency: string;
      displayOrder: number;
      highlighted: boolean;
      title: QuotaOfferLocalizedText;
      subtitle: QuotaOfferLocalizedText;
      ctaLabel: QuotaOfferLocalizedText;
    }>;
  }>;
};

type VisiblePlanOfferInput = {
  code: string;
  displayName: string;
  enabledToolCodes: string[];
  amountMinor: number | null;
  limits: {
    imageGenerateMonthlyUnitsLimit: number | null;
    imageEditMonthlyUnitsLimit: number | null;
    videoGenerateMonthlyUnitsLimit: number | null;
  };
};

const PACKAGE_TOOL_CODES = ["image_generate", "image_edit", "video_generate"] as const;

function resolvePublicWebBaseUrl(): string | null {
  const raw = process.env.PERSAI_WEB_BASE_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolvePurchaseUrl(path: string): string | null {
  const baseUrl = resolvePublicWebBaseUrl();
  if (baseUrl === null) {
    return null;
  }
  return new URL(path, `${baseUrl}/`).toString();
}

function resolveCurrentToolLimit(
  toolCode: MediaPackageType,
  currentPlan: VisiblePlanOfferInput | null
): number | null {
  if (currentPlan === null) {
    return null;
  }
  switch (toolCode) {
    case "image_generate":
      return currentPlan.limits.imageGenerateMonthlyUnitsLimit;
    case "image_edit":
      return currentPlan.limits.imageEditMonthlyUnitsLimit;
    case "video_generate":
      return currentPlan.limits.videoGenerateMonthlyUnitsLimit;
  }
}

function sortOffers(
  left: MediaPackageCatalogItemState,
  right: MediaPackageCatalogItemState
): number {
  if (left.displayOrder !== right.displayOrder) {
    return left.displayOrder - right.displayOrder;
  }
  if (left.highlighted !== right.highlighted) {
    return left.highlighted ? -1 : 1;
  }
  if (left.amountMinor !== right.amountMinor) {
    return left.amountMinor - right.amountMinor;
  }
  if (left.units !== right.units) {
    return left.units - right.units;
  }
  return left.id.localeCompare(right.id);
}

function resolvePreferredPackageIds(offers: MediaPackageCatalogItemState[]): string[] {
  if (offers.length === 0) {
    return [];
  }
  const highlighted = offers.filter((offer) => offer.highlighted).map((offer) => offer.id);
  if (highlighted.length > 0) {
    return highlighted;
  }
  return [offers[0]!.id];
}

function resolveOfferKind(input: {
  offerableNow: boolean;
  upgradePlanCodes: string[];
}): QuotaOfferState["tools"][number]["preferredOfferKind"] {
  if (input.offerableNow && input.upgradePlanCodes.length > 0) {
    return "plan_upgrade_or_package";
  }
  if (input.offerableNow) {
    return "package_only";
  }
  if (input.upgradePlanCodes.length > 0) {
    return "plan_upgrade_only";
  }
  return "none";
}

export function buildQuotaOfferState(input: {
  currentPlanCode: string | null;
  visiblePlans: VisiblePlanOfferInput[];
  currentActiveToolCodes: Set<string>;
  publicPackages: MediaPackageCatalogItemState[];
}): QuotaOfferState {
  const currentPlan =
    input.currentPlanCode === null
      ? null
      : (input.visiblePlans.find((plan) => plan.code === input.currentPlanCode) ?? null);
  const currentPlanAmountMinor = currentPlan?.amountMinor ?? null;

  const tools = PACKAGE_TOOL_CODES.map((toolCode) => {
    const offers = input.publicPackages
      .filter((pkg) => pkg.packageType === toolCode)
      .sort(sortOffers);
    const available = offers.length > 0;
    const offerableNow = available && input.currentActiveToolCodes.has(toolCode);
    const currentLimit = resolveCurrentToolLimit(toolCode, currentPlan);
    const upgradePlanCodes = input.visiblePlans
      .filter((plan) => {
        if (!plan.enabledToolCodes.includes(toolCode)) {
          return false;
        }
        if (currentPlanAmountMinor !== null && plan.amountMinor !== null) {
          if (plan.amountMinor <= currentPlanAmountMinor) {
            return false;
          }
        } else if (currentPlanAmountMinor !== null && plan.amountMinor === null) {
          return false;
        }
        const planLimit = resolveCurrentToolLimit(toolCode, plan);
        if (currentLimit === null) {
          return planLimit !== null;
        }
        if (planLimit === null) {
          return false;
        }
        return planLimit > currentLimit;
      })
      .sort((left, right) => {
        const leftAmount = left.amountMinor ?? Number.MAX_SAFE_INTEGER;
        const rightAmount = right.amountMinor ?? Number.MAX_SAFE_INTEGER;
        if (leftAmount !== rightAmount) {
          return leftAmount - rightAmount;
        }
        return left.code.localeCompare(right.code);
      })
      .map((plan) => plan.code);
    const offerReason: QuotaOfferState["tools"][number]["offerReason"] = !available
      ? "no_public_packages"
      : offerableNow
        ? "available"
        : "tool_not_enabled_on_current_plan";

    return {
      toolCode,
      available,
      offerableNow,
      offerReason,
      preferredOfferKind: resolveOfferKind({
        offerableNow,
        upgradePlanCodes
      }),
      preferredPackageIds: offerableNow ? resolvePreferredPackageIds(offers) : [],
      preferredUpgradePlanCode: upgradePlanCodes[0] ?? null,
      upgradePlanCodes,
      offers: offers.map((offer) => ({
        id: offer.id,
        toolCode,
        units: offer.units,
        amountMinor: offer.amountMinor,
        currency: offer.currency,
        displayOrder: offer.displayOrder,
        highlighted: offer.highlighted,
        title: {
          ru: offer.title.ru || null,
          en: offer.title.en || null
        },
        subtitle: {
          ru: offer.subtitle.ru || null,
          en: offer.subtitle.en || null
        },
        ctaLabel: {
          ru: offer.ctaLabel.ru || null,
          en: offer.ctaLabel.en || null
        }
      }))
    };
  });

  const availableTools = tools.filter((tool) => tool.offerableNow).map((tool) => tool.toolCode);

  return {
    packagesPurchase:
      availableTools.length === 0
        ? null
        : {
            path: DEFAULT_QUOTA_PACKAGES_PAGE_PATH,
            url: resolvePurchaseUrl(DEFAULT_QUOTA_PACKAGES_PAGE_PATH),
            paymentMethodClasses: [...QUOTA_PACKAGE_PAYMENT_METHOD_CLASSES]
          },
    tools
  };
}
