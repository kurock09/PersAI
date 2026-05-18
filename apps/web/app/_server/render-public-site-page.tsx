import { headers } from "next/headers";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  PublicSitePageView,
  type PublicSitePageViewCopy
} from "../_components/public-site-page-view";
import { fetchPublicSitePage, type PublicSitePageSlug } from "./fetch-public-site-page";

function resolvePageLabel(
  copy: Awaited<ReturnType<typeof getTranslations>>,
  slug: PublicSitePageSlug
): string {
  switch (slug) {
    case "terms":
      return copy("pageLabels.terms");
    case "privacy":
      return copy("pageLabels.privacy");
    case "requisites":
      return copy("pageLabels.requisites");
    case "contacts":
      return copy("pageLabels.contacts");
  }
}

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
  const t = await getTranslations({ locale: result.resolvedLocale, namespace: "legalPage" });
  const buildPageHref = (targetSlug: PublicSitePageSlug) =>
    `/${targetSlug}?market=${result.resolvedMarket}&locale=${result.resolvedLocale}` as Route;
  const copy: PublicSitePageViewCopy = {
    footerLinks: [
      { label: t("footer.pricing"), href: "/pricing" as Route },
      { label: t("footer.terms"), href: buildPageHref("terms") },
      { label: t("footer.privacy"), href: buildPageHref("privacy") },
      { label: t("footer.contacts"), href: buildPageHref("contacts") },
      { label: t("footer.requisites"), href: buildPageHref("requisites") }
    ],
    pageLabel: resolvePageLabel(t, result.page.slug),
    marketLabel: result.resolvedMarket === "rf" ? t("marketLabels.rf") : t("marketLabels.intl"),
    localeLabel: result.resolvedLocale.toUpperCase(),
    localeVariantRu: t("localeLabels.ru"),
    localeVariantEn: t("localeLabels.en"),
    marketVariantRf: t("marketLabels.rf"),
    marketVariantIntl: t("marketLabels.intl"),
    footerNote: t("footer.note")
  };
  return (
    <PublicSitePageView
      page={result.page}
      resolvedMarket={result.resolvedMarket}
      resolvedLocale={result.resolvedLocale}
      copy={copy}
    />
  );
}
