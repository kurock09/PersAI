import type { NextConfig } from "next";

const apiProxyTarget = process.env.PERSAI_WEB_API_PROXY_TARGET;

const nextConfig: NextConfig = {
  transpilePackages: ["@persai/contracts"],
  async rewrites() {
    if (!apiProxyTarget || apiProxyTarget.trim().length === 0) {
      return [];
    }

    const normalizedTarget = apiProxyTarget.replace(/\/$/, "");
    return [
      {
        source: "/api/v1/:path*",
        destination: `${normalizedTarget}/:path*`
      }
    ];
  }
};

export default nextConfig;
