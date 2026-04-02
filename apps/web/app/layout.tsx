import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "PersAI",
  description: "Your personal AI assistant. One mind. Everywhere."
};

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
    fontFamily: "Inter, sans-serif",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-bg text-text antialiased`}>
        <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
