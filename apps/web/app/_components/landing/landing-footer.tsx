import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";

export async function LandingFooter() {
  const t = await getTranslations("landing");
  const links = [
    { label: t("plans"), href: "/pricing" as Route },
    { label: t("termsLink"), href: "/terms" as Route },
    { label: t("privacyLink"), href: "/privacy" as Route },
    { label: t("contactsLink"), href: "/contacts" as Route },
    { label: t("requisitesLink"), href: "/requisites" as Route }
  ];

  return (
    // No border / no tinted bg — the page already wears `bg-chrome`, so any
    // extra tint on the footer just paints a hard horizontal edge across the
    // sage off-white surface. Android download lives inside the System block's
    // channel tile now, so the footer stays pure typography.
    <footer className="px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-12 sm:px-10 sm:pt-16">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] font-medium text-text-subtle sm:text-xs">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="transition-colors hover:text-text-muted"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="text-[10px] text-text-subtle/60">{t("terms")}</p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-subtle/45">
          Pers<span className="text-text-subtle/65">AI</span>
        </p>
      </div>
    </footer>
  );
}
