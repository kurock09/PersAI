export const MEDIA_PACKAGE_TYPES = ["image_generate", "image_edit", "video_generate"] as const;
export type MediaPackageType = (typeof MEDIA_PACKAGE_TYPES)[number];

export const SUPPORTED_PACKAGE_CURRENCIES = ["RUB", "USD"] as const;
export type PackageCurrency = (typeof SUPPORTED_PACKAGE_CURRENCIES)[number];

export type MediaPackageCatalogItemState = {
  id: string;
  packageType: MediaPackageType;
  units: number;
  amountMinor: number;
  currency: PackageCurrency;
  isActive: boolean;
  displayOrder: number;
  title: { ru: string; en: string };
  subtitle: { ru: string; en: string };
  badge: { ru: string; en: string };
  ctaLabel: { ru: string; en: string };
  createdAt: string;
  updatedAt: string;
};

export type CreateMediaPackageCatalogItemInput = {
  packageType: MediaPackageType;
  units: number;
  amountMinor: number;
  currency: PackageCurrency;
  isActive: boolean;
  displayOrder: number;
  titleRu: string;
  titleEn: string;
  subtitleRu?: string;
  subtitleEn?: string;
  badgeRu?: string;
  badgeEn?: string;
  ctaLabelRu?: string;
  ctaLabelEn?: string;
};

export type UpdateMediaPackageCatalogItemInput = Partial<CreateMediaPackageCatalogItemInput>;

export type WorkspaceMediaPackageGrantState = {
  id: string;
  workspaceId: string;
  packageCatalogItemId: string;
  toolCode: string;
  grantedUnits: number;
  amountMinorSnapshot: number;
  currencySnapshot: string;
  paymentIntentId: string;
  periodStartedAt: string;
  periodEndsAt: string;
  status: "active" | "expired_period" | "reversed";
  createdAt: string;
};

export type ActivePackageBonusForTool = {
  toolCode: string;
  bonusUnits: number;
  latestPeriodEndsAt: string | null;
  grantIds: string[];
};

export type CreatePackagePaymentIntentInput = {
  packageItemIds: string[];
  paymentMethodClass: "card" | "sbp_qr";
  idempotencyKey: string;
  returnUrl: string;
};
