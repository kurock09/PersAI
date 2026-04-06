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
  transpilePackages: ["@persai/contracts"]
};

export default withNextIntl(nextConfig);
