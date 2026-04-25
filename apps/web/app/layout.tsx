import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export const metadata: Metadata = {
  title: "PersAI",
  description: "Your personal AI assistant. One mind. Everywhere."
};

/**
 * Synchronous, pre-hydration theme bootstrap. Runs in <head> before the
 * first paint to apply the user's stored choice (or, when the user is on
 * "system", the current OS preference) so we never flash dark over light
 * (or vice versa) on cold load. Mirrors the contract in
 * apps/web/app/app/_components/use-theme.ts.
 */
const themeBootstrapScript = `(function(){try{var s=localStorage.getItem("persai-theme");var c=(s==="system"||s==="dark"||s==="light")?s:"system";var r=c==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):c;if(r==="light")document.documentElement.classList.add("light");document.documentElement.style.colorScheme=r;}catch(e){}})();`;

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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="dark light" />
        <meta name="theme-color" content="#161513" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#e0d8c8" media="(prefers-color-scheme: light)" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
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
