import Link from "next/link";
import type { Route } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  PublicSitePageState,
  SitePageLocale,
  SitePageMarket
} from "../_server/fetch-public-site-page";

export function PublicSitePageView(props: {
  page: PublicSitePageState;
  resolvedMarket: SitePageMarket;
  resolvedLocale: SitePageLocale;
}) {
  const { page, resolvedMarket, resolvedLocale } = props;
  const buildHref = (market: SitePageMarket, locale: SitePageLocale) =>
    `/${page.slug}?market=${market}&locale=${locale}` as Route;
  const localeLinks = page.availableVariants.filter(
    (variant) => variant.market === resolvedMarket && variant.locale !== resolvedLocale
  );
  const marketLinks = page.availableVariants.filter(
    (variant) => variant.locale === resolvedLocale && variant.market !== resolvedMarket
  );

  return (
    <main className="min-h-screen bg-chrome px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="rounded-3xl border border-border bg-surface/90 p-6 shadow-[0_16px_48px_rgba(0,0,0,0.18)] backdrop-blur-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-subtle">
            <span className="rounded-full border border-border px-2.5 py-1 uppercase tracking-[0.18em]">
              PersAI
            </span>
            <span className="rounded-full border border-border px-2.5 py-1 uppercase tracking-[0.18em]">
              {resolvedMarket}
            </span>
            <span className="rounded-full border border-border px-2.5 py-1 uppercase tracking-[0.18em]">
              {resolvedLocale}
            </span>
            {page.version ? (
              <span className="rounded-full border border-border px-2.5 py-1">{page.version}</span>
            ) : null}
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-text sm:text-4xl">
            {page.title}
          </h1>

          <div className="mt-4 flex flex-wrap gap-3 text-sm text-text-muted">
            {localeLinks.map((variant) => (
              <Link
                key={`locale:${variant.market}:${variant.locale}`}
                href={buildHref(variant.market, variant.locale)}
                className="hover:text-text"
              >
                {variant.locale === "ru" ? "RU version" : "EN version"}
              </Link>
            ))}
            {marketLinks.map((variant) => (
              <Link
                key={`market:${variant.market}:${variant.locale}`}
                href={buildHref(variant.market, variant.locale)}
                className="hover:text-text"
              >
                {variant.market === "rf" ? "RF market" : "International market"}
              </Link>
            ))}
            <Link href="/" className="hover:text-text">
              PersAI
            </Link>
          </div>

          <article className="prose prose-invert mt-8 max-w-none prose-headings:text-text prose-p:text-text-muted prose-li:text-text-muted prose-strong:text-text prose-a:text-accent">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.bodyMarkdown}</ReactMarkdown>
          </article>
        </div>
      </div>
    </main>
  );
}
