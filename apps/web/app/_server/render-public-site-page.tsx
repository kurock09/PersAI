import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicSitePageView } from "../_components/public-site-page-view";
import { fetchPublicSitePage, type PublicSitePageSlug } from "./fetch-public-site-page";

export async function renderPublicSitePage(
  slug: PublicSitePageSlug,
  searchParams?: Promise<Record<string, string | string[] | undefined>>
) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie");
  const acceptLanguage = requestHeaders.get("accept-language");
  const market =
    typeof resolvedSearchParams.market === "string" ? resolvedSearchParams.market : undefined;
  const locale =
    typeof resolvedSearchParams.locale === "string" ? resolvedSearchParams.locale : undefined;
  const result = await fetchPublicSitePage({
    slug,
    market,
    locale,
    cookieHeader,
    acceptLanguage
  });
  if (result.kind === "not_found") {
    notFound();
  }
  return (
    <PublicSitePageView
      page={result.page}
      resolvedMarket={result.resolvedMarket}
      resolvedLocale={result.resolvedLocale}
    />
  );
}
