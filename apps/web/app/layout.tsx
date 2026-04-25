import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export const metadata: Metadata = {
  title: "PersAI",
  description: "Your personal AI assistant. One mind. Everywhere."
};

const THEME_COOKIE = "persai-theme";
const THEME_COLOR_DARK = "#161513";
const THEME_COLOR_LIGHT = "#e0d8c8";

type ThemeChoice = "system" | "dark" | "light";
type ResolvedTheme = "dark" | "light";

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === "system" || value === "dark" || value === "light";
}

/**
 * First-visit-without-cookie fallback (ADR-076 Slice 1). Runs synchronously
 * in `<head>` before the first paint, on iOS WKWebView and any browser that
 * does not send `Sec-CH-Prefers-Color-Scheme`. Reads the cookie (NOT
 * `localStorage`), resolves `system` against `matchMedia`, applies the
 * `.light` class + `color-scheme`, syncs `<meta name="theme-color">`, and
 * persists the choice as a cookie so subsequent navigations are
 * server-resolved. This is the documented first-visit path, not a parallel
 * source of truth.
 */
const themeFallbackScript = `(function(){try{var m=document.cookie.match(/(?:^|; )persai-theme=([^;]+)/);var s=m?decodeURIComponent(m[1]):null;var c=(s==="system"||s==="dark"||s==="light")?s:"system";var r=c==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):c;var d=document.documentElement;if(r==="light")d.classList.add("light");else d.classList.remove("light");d.style.colorScheme=r;var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",r==="light"?"#e0d8c8":"#161513");if(!s){var sec=location.protocol==="https:"?"; Secure":"";document.cookie="persai-theme="+c+"; Path=/; Max-Age=31536000; SameSite=Lax"+sec;}try{if(window.PersaiNative&&typeof window.PersaiNative.setTheme==="function")window.PersaiNative.setTheme(r);}catch(e2){}}catch(e){}})();`;

const clerkAppearance = {
  variables: {
    colorPrimary: "var(--accent)",
    colorBackground: "var(--surface-raised)",
    colorInput: "var(--surface-hover)",
    colorInputForeground: "var(--text)",
    colorForeground: "var(--text)",
    colorMutedForeground: "var(--text-muted)",
    colorMuted: "var(--surface)",
    colorNeutral: "var(--text)",
    colorBorder: "var(--border-strong)",
    colorDanger: "var(--destructive)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",
    colorModalBackdrop: "rgba(0,0,0,0.65)",
    borderRadius: "0.5rem",
    spacing: "0.85rem",
    fontFamily: "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
    fontSize: { xs: "0.7rem", sm: "0.8rem", md: "0.875rem", lg: "1rem", xl: "1.15rem" }
  },
  elements: {
    card: { boxShadow: "0 8px 30px rgba(0,0,0,0.35)" },
    navbar: { borderRight: "1px solid var(--border)" },
    navbarButton: { fontSize: "0.8rem", padding: "0.45rem 0.7rem" },
    profilePage: { padding: "1.25rem" },
    profileSectionTitle: { fontSize: "0.85rem", fontWeight: "600" },
    userButtonPopoverCard: { boxShadow: "0 4px 20px rgba(0,0,0,0.3)" },
    userButtonPopoverActionButton: { fontSize: "0.8rem", padding: "0.5rem 0.75rem" }
  }
};

/**
 * Server-side theme resolution (ADR-076 Slice 1). Reads `persai-theme`
 * cookie as the authoritative source. When the cookie is "system" or
 * absent, falls back to the `Sec-CH-Prefers-Color-Scheme` client hint
 * (opted-in via the `Accept-CH` meta tag below and the `Critical-CH`
 * response header in `next.config.ts`); when the hint is also absent
 * (iOS WKWebView, older browsers), the inline `themeFallbackScript`
 * resolves and writes the cookie before first paint.
 */
async function resolveServerTheme(): Promise<ResolvedTheme> {
  const cookieStore = await cookies();
  const headerList = await headers();

  const stored = cookieStore.get(THEME_COOKIE)?.value;
  const choice: ThemeChoice = isThemeChoice(stored) ? stored : "system";

  if (choice === "dark" || choice === "light") return choice;

  const hint = headerList.get("sec-ch-prefers-color-scheme");
  if (hint === "light") return "light";
  if (hint === "dark") return "dark";

  return "dark";
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const resolvedTheme = await resolveServerTheme();
  const themeColor = resolvedTheme === "light" ? THEME_COLOR_LIGHT : THEME_COLOR_DARK;
  const htmlClassName = [
    GeistSans.variable,
    GeistMono.variable,
    resolvedTheme === "light" ? "light" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <html
      lang={locale}
      className={htmlClassName}
      style={{ colorScheme: resolvedTheme }}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="dark light" />
        <meta httpEquiv="Accept-CH" content="Sec-CH-Prefers-Color-Scheme" />
        <meta name="theme-color" content={themeColor} />
        <script dangerouslySetInnerHTML={{ __html: themeFallbackScript }} />
      </head>
      <body className="bg-chrome font-sans text-text antialiased">
        <ClerkProvider appearance={clerkAppearance}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
