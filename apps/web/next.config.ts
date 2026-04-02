import type { NextConfig } from "next";

const apiProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET;

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

    return rules;
  }
};

export default nextConfig;
