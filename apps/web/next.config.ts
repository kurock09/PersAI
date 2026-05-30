import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Do not use next.config `rewrites()` for `/api/v1/*` → external API: Next.js 16 can surface
 * "NextResponse.rewrite() was used in a app route handler, this is not currently supported"
 * and return 500. Proxy is implemented in `app/api/v1/[[...path]]/route.ts` via fetch.
 */
const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ["@persai/contracts", "@persai/types"],
  /**
   * ADR-076 Slice 1 — opt every response in to the `Sec-CH-Prefers-Color-Scheme`
   * client hint. `Accept-CH` advertises that we want it on subsequent requests;
   * `Critical-CH` asks the browser to retry the very first navigation with the
   * hint included so the SSR-resolved `<html class>` is correct on the first
   * paint. `Vary` keeps proxies / CDNs from collapsing dark and light variants
   * onto the same cache entry. Coverage: Chromium WebView (Capacitor Android),
   * Chrome, Edge. iOS WKWebView and older browsers fall through to the inline
   * cookie-writing fallback in `app/layout.tsx`.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Accept-CH", value: "Sec-CH-Prefers-Color-Scheme" },
          { key: "Critical-CH", value: "Sec-CH-Prefers-Color-Scheme" },
          { key: "Vary", value: "Sec-CH-Prefers-Color-Scheme" }
        ]
      }
    ];
  }
};

export default withNextIntl(nextConfig);
