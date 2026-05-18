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
  const footerLinks = [
    { label: "Pricing", href: "/pricing" as Route },
    { label: "Terms", href: "/terms" as Route },
    { label: "Privacy", href: "/privacy" as Route },
    { label: "Contacts", href: "/contacts" as Route },
    { label: "Legal", href: "/requisites" as Route }
  ];
  const buildHref = (market: SitePageMarket, locale: SitePageLocale) =>
    `/${page.slug}?market=${market}&locale=${locale}` as Route;
  const localeLinks = page.availableVariants.filter(
    (variant) => variant.market === resolvedMarket && variant.locale !== resolvedLocale
  );
  const marketLinks = page.availableVariants.filter(
    (variant) => variant.locale === resolvedLocale && variant.market !== resolvedMarket
  );
  const marketLabel = resolvedMarket === "rf" ? "RF market" : "International market";
  const localeLabel = resolvedLocale === "ru" ? "RU" : "EN";
  const readingTimeLabel = page.slug === "contacts" ? "Public contact page" : "Public legal page";
  const pageLabel =
    page.slug === "terms"
      ? "Terms"
      : page.slug === "privacy"
        ? "Privacy"
        : page.slug === "requisites"
          ? "Company details"
          : "Contacts";

  return (
    <main className="relative min-h-screen overflow-hidden bg-chrome">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[6%] top-[4%] h-[460px] w-[460px] rounded-full bg-accent/[0.11] blur-[150px]" />
        <div className="absolute right-[10%] top-[22%] h-[320px] w-[320px] rounded-full bg-accent/[0.06] blur-[120px]" />
        <div className="absolute bottom-[8%] left-[42%] h-[280px] w-[280px] rounded-full bg-accent/[0.08] blur-[110px]" />
      </div>

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-5 pb-10 pt-5 sm:px-8 sm:pb-12 sm:pt-7 lg:px-12">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex flex-col gap-3">
            <Link
              href={"/" as Route}
              className="w-fit text-xs font-semibold uppercase tracking-[0.22em] text-text-muted transition-colors hover:text-text"
            >
              Pers<span className="text-text">AI</span>
            </Link>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-text-subtle">
              <span className="rounded-full border border-border/70 bg-surface-raised/20 px-3 py-1 uppercase">
                {pageLabel}
              </span>
              <span className="rounded-full border border-border/70 bg-surface-raised/20 px-3 py-1 uppercase">
                {marketLabel}
              </span>
              <span className="rounded-full border border-border/70 bg-surface-raised/20 px-3 py-1 uppercase">
                {localeLabel}
              </span>
              {page.version ? (
                <span className="rounded-full border border-border/70 bg-surface-raised/20 px-3 py-1 tracking-[0.06em] text-text-muted">
                  {page.version}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-text-subtle">
            {localeLinks.map((variant) => (
              <Link
                key={`locale:${variant.market}:${variant.locale}`}
                href={buildHref(variant.market, variant.locale)}
                className="rounded-full border border-border/70 px-3 py-1.5 transition-colors hover:border-accent/35 hover:text-text"
              >
                {variant.locale === "ru" ? "RU version" : "EN version"}
              </Link>
            ))}
            {marketLinks.map((variant) => (
              <Link
                key={`market:${variant.market}:${variant.locale}`}
                href={buildHref(variant.market, variant.locale)}
                className="rounded-full border border-border/70 px-3 py-1.5 transition-colors hover:border-accent/35 hover:text-text"
              >
                {variant.market === "rf" ? "RF market" : "International market"}
              </Link>
            ))}
          </div>
        </header>

        <section className="mx-auto mt-14 w-full max-w-3xl sm:mt-20">
          <div className="max-w-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-text-subtle">
              PersAI Legal
            </p>
            <h1 className="mt-4 text-[clamp(2.4rem,5vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-text">
              {page.title}
            </h1>
          </div>

          <div className="mt-8 grid gap-8 border-t border-border/70 pt-6 sm:grid-cols-[minmax(0,1fr)_220px] sm:gap-10 sm:pt-8">
            <div className="max-w-xl">
              <p className="text-base leading-8 text-text-muted sm:text-[17px]">
                A calm, readable public page rendered from the currently published PersAI version
                for {marketLabel.toLowerCase()}.
              </p>
            </div>

            <aside className="space-y-5 text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-subtle">
                  Surface
                </p>
                <p className="mt-2 text-text">{readingTimeLabel}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-subtle">
                  Version
                </p>
                <p className="mt-2 break-all text-text-muted">
                  {page.version ?? "Live published copy"}
                </p>
              </div>
            </aside>
          </div>

          <article className="mt-12 max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: () => null,
                h2: ({ children }) => (
                  <h2 className="mt-14 text-2xl font-semibold tracking-[-0.03em] text-text sm:text-3xl">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mt-11 text-lg font-semibold tracking-[-0.02em] text-text sm:text-xl">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mt-5 text-[15px] leading-8 text-text-muted sm:text-[16px]">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="mt-6 space-y-3 pl-0 text-[15px] leading-8 text-text-muted sm:text-[16px]">
                    {children}
                  </ul>
                ),
                li: ({ children }) => (
                  <li className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-[0.95rem] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/55"
                    />
                    <span>{children}</span>
                  </li>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-accent transition-colors hover:text-accent-hover hover:underline"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-text">{children}</strong>
                ),
                hr: () => <div className="mt-10 h-px bg-border/70" />
              }}
            >
              {page.bodyMarkdown}
            </ReactMarkdown>
          </article>

          <div className="mt-16 h-px bg-gradient-to-r from-accent/20 via-border to-transparent" />
        </section>

        <footer className="mt-14 shrink-0 text-center sm:mt-20">
          <nav className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[10px] font-medium text-text-subtle sm:gap-x-4 sm:text-[11px]">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="transition-colors hover:text-text-muted"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="mt-2 text-[10px] text-text-subtle/60">
            PersAI public trust pages, rendered from live admin-managed content.
          </p>
        </footer>
      </div>
    </main>
  );
}
