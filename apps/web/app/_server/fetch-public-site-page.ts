import "server-only";

export type PublicSitePageSlug = "terms" | "privacy" | "requisites" | "contacts";
export type SitePageMarket = "rf" | "intl";
export type SitePageLocale = "ru" | "en";
export type PublicSitePageVariantState = {
  market: SitePageMarket;
  locale: SitePageLocale;
};

export interface PublicSitePageState {
  slug: PublicSitePageSlug;
  market: SitePageMarket;
  locale: SitePageLocale;
  status: "published";
  title: string;
  bodyMarkdown: string;
  version: string | null;
  publishedAt: string | null;
  updatedAt: string;
  availableVariants: PublicSitePageVariantState[];
}

function resolveUpstreamApiBase(): string {
  const raw = process.env.PERSAI_WEB_API_PROXY_TARGET?.trim();
  if (raw) {
    return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";
  }
  return "http://localhost:3001/api/v1";
}

export async function fetchPublicSitePage(params: {
  slug: PublicSitePageSlug;
  market: string | null | undefined;
  locale: string | null | undefined;
  cookieHeader: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): Promise<
  | {
      kind: "ok";
      page: PublicSitePageState;
      resolvedMarket: SitePageMarket;
      resolvedLocale: SitePageLocale;
    }
  | { kind: "not_found" }
> {
  const search = new URLSearchParams();
  if (params.market) search.set("market", params.market);
  if (params.locale) search.set("locale", params.locale);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const upstream = `${resolveUpstreamApiBase()}/public/site-pages/${params.slug}${suffix}`;
  const headers = new Headers();
  if (params.cookieHeader) {
    headers.set("cookie", params.cookieHeader);
  }
  if (params.acceptLanguage) {
    headers.set("accept-language", params.acceptLanguage);
  }
  try {
    const response = await fetch(upstream, {
      cache: "no-store",
      headers
    });
    if (response.status === 404) {
      return { kind: "not_found" };
    }
    if (!response.ok) {
      throw new Error(`Public site page upstream failed with status ${response.status}.`);
    }
    const payload = (await response.json()) as {
      page?: PublicSitePageState;
      resolvedMarket?: SitePageMarket;
      resolvedLocale?: SitePageLocale;
    };
    if (!payload.page || !payload.resolvedMarket || !payload.resolvedLocale) {
      throw new Error("Public site page upstream returned an incomplete payload.");
    }
    return {
      kind: "ok",
      page: payload.page,
      resolvedMarket: payload.resolvedMarket,
      resolvedLocale: payload.resolvedLocale
    };
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Public site page request failed for an unknown reason.");
  }
}
