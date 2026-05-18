export const SITE_PAGE_SLUGS = ["terms", "privacy", "requisites", "contacts"] as const;
export const SITE_PAGE_MARKETS = ["rf", "intl"] as const;
export const SITE_PAGE_LOCALES = ["ru", "en"] as const;
export const SITE_PAGE_STATUSES = ["draft", "published"] as const;

export type SitePageSlug = (typeof SITE_PAGE_SLUGS)[number];
export type SitePageMarket = (typeof SITE_PAGE_MARKETS)[number];
export type SitePageLocale = (typeof SITE_PAGE_LOCALES)[number];
export type SitePageStatus = (typeof SITE_PAGE_STATUSES)[number];

export interface SitePageVariantState {
  market: SitePageMarket;
  locale: SitePageLocale;
}

export interface SitePageState {
  slug: SitePageSlug;
  market: SitePageMarket;
  locale: SitePageLocale;
  status: SitePageStatus;
  title: string;
  bodyMarkdown: string;
  version: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSitePageState {
  slug: SitePageSlug;
  market: SitePageMarket;
  locale: SitePageLocale;
  status: "published";
  title: string;
  bodyMarkdown: string;
  version: string | null;
  publishedAt: string | null;
  updatedAt: string;
  availableVariants: SitePageVariantState[];
}
