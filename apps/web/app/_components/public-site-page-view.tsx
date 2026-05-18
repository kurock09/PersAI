"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  PublicSitePageState,
  SitePageLocale,
  SitePageMarket
} from "../_server/fetch-public-site-page";
import { setLocaleCookie } from "../lib/locale-sync";

export type PublicSitePageViewCopy = {
  footerLinks: Array<{ label: string; href: Route }>;
  pageLabel: string;
  marketLabel: string;
  localeLabel: string;
  localeVariantRu: string;
  localeVariantEn: string;
  marketVariantRf: string;
  marketVariantIntl: string;
  footerNote: string;
};

export function PublicSitePageView(props: {
  page: PublicSitePageState;
  resolvedMarket: SitePageMarket;
  resolvedLocale: SitePageLocale;
  copy: PublicSitePageViewCopy;
}) {
  const { page, resolvedMarket, resolvedLocale, copy } = props;
  const buildHref = (market: SitePageMarket, locale: SitePageLocale) =>
    `/${page.slug}?market=${market}&locale=${locale}` as Route;
  const localeLinks = page.availableVariants.filter(
    (variant) => variant.market === resolvedMarket && variant.locale !== resolvedLocale
  );
  const marketLinks = page.availableVariants.filter(
    (variant) => variant.locale === resolvedLocale && variant.market !== resolvedMarket
  );

  useEffect(() => {
    setLocaleCookie(resolvedLocale);
    if (resolvedMarket === "rf") {
      document.cookie = "persai-country=RU;path=/;max-age=31536000;samesite=lax";
      return;
    }
    document.cookie = "persai-country=;path=/;max-age=0;samesite=lax";
  }, [resolvedLocale, resolvedMarket]);

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
        <header className="mx-auto flex w-full max-w-3xl flex-wrap items-start justify-between gap-5">
          <div className="flex flex-col gap-3">
            <Link
              href={"/" as Route}
              className="w-fit text-xs font-semibold uppercase tracking-[0.22em] text-text-muted transition-colors hover:text-text"
            >
              Pers<span className="text-text">AI</span>
            </Link>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-text-subtle">
              <span className="rounded-full border border-border/70 bg-surface-raised/20 px-3 py-1 uppercase">
                {copy.pageLabel}
              </span>
              <span className="rounded-full border border-border/70 bg-surface-raised/20 px-3 py-1 uppercase">
                {copy.marketLabel}
              </span>
              <span className="rounded-full border border-border/70 bg-surface-raised/20 px-3 py-1 uppercase">
                {copy.localeLabel}
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
                {variant.locale === "ru" ? copy.localeVariantRu : copy.localeVariantEn}
              </Link>
            ))}
            {marketLinks.map((variant) => (
              <Link
                key={`market:${variant.market}:${variant.locale}`}
                href={buildHref(variant.market, variant.locale)}
                className="rounded-full border border-border/70 px-3 py-1.5 transition-colors hover:border-accent/35 hover:text-text"
              >
                {variant.market === "rf" ? copy.marketVariantRf : copy.marketVariantIntl}
              </Link>
            ))}
          </div>
        </header>

        <section className="mx-auto mt-12 w-full max-w-3xl sm:mt-16">
          <div className="max-w-2xl">
            <h1 className="text-[clamp(2rem,4.25vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.05em] text-text">
              {page.title}
            </h1>
          </div>

          <div className="mt-8 h-px bg-gradient-to-r from-accent/20 via-border to-transparent" />

          <article className="mt-10 max-w-none">
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
                table: ({ children }) => (
                  <div className="mt-8 overflow-x-auto rounded-2xl border border-border/70 bg-surface-raised/10">
                    <table className="min-w-full border-collapse text-left text-[12px] leading-6 text-text-muted sm:text-[13px]">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="border-b border-border/70 bg-surface-raised/20 text-text">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => (
                  <tr className="border-b border-border/40 last:border-b-0">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="px-3 py-2.5 align-top text-[11px] font-semibold uppercase tracking-[0.08em] text-text sm:px-4">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-2.5 align-top text-[12px] leading-6 text-text-muted sm:px-4 sm:text-[13px]">
                    {children}
                  </td>
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
        </section>

        <footer className="mx-auto mt-16 w-full max-w-3xl shrink-0 border-t border-border/70 pt-8 text-center sm:mt-20 sm:pt-10">
          <nav className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[10px] font-medium text-text-subtle sm:gap-x-4 sm:text-[11px]">
            {copy.footerLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="transition-colors hover:text-text-muted"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="mt-2 text-[10px] text-text-subtle/60">{copy.footerNote}</p>
        </footer>
      </div>
    </main>
  );
}
