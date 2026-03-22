import "./globals.css";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
