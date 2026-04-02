import type { NextConfig } from "next";

const apiProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET;

function extractClerkFrontendApi(): string | undefined {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!pk) return undefined;
  const prefix = pk.startsWith("pk_test_")
    ? "pk_test_"
    : pk.startsWith("pk_live_")
      ? "pk_live_"
      : null;
  if (!prefix) return undefined;
  return Buffer.from(pk.replace(prefix, ""), "base64").toString("utf-8").replace(/\$$/, "");
}

const clerkFrontendApi = extractClerkFrontendApi();

const nextConfig: NextConfig = {
  transpilePackages: ["@persai/contracts"],
  async rewrites() {
    const rules: Array<{ source: string; destination: string }> = [];

    if (apiProxyTarget && apiProxyTarget.trim().length > 0) {
      const normalizedTarget = apiProxyTarget.replace(/\/$/, "");
      rules.push({
        source: "/api/v1/:path*",
        destination: `${normalizedTarget}/:path*`
      });
    }

    if (clerkFrontendApi) {
      rules.push({
        source: "/clerk-proxy/:path*",
        destination: `https://${clerkFrontendApi}/:path*`
      });
    }

    return rules;
  }
};

export default nextConfig;
