import type { NextConfig } from "next";

const apiProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET;

const clerkFrontendApi = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")
  ? (() => {
      const raw = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!.replace("pk_test_", "");
      return Buffer.from(raw, "base64").toString("utf-8").replace(/\$$/, "");
    })()
  : undefined;

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
        source: "/clerk-cdn/:path*",
        destination: `https://${clerkFrontendApi}/npm/:path*`
      });
    }

    return rules;
  }
};

export default nextConfig;
