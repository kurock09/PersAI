import "server-only";
import type { PublicPricingPlanState } from "@persai/contracts";

function resolveUpstreamApiBase(): string {
  const raw = process.env.PERSAI_WEB_API_PROXY_TARGET?.trim();
  if (raw) {
    return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";
  }
  return "http://localhost:3001/api/v1";
}

export async function fetchPublicPricingPlans(): Promise<PublicPricingPlanState[]> {
  const upstream = `${resolveUpstreamApiBase()}/public/plans/pricing`;
  try {
    const response = await fetch(upstream, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = (await response.json()) as { plans?: PublicPricingPlanState[] };
    return Array.isArray(payload.plans) ? payload.plans : [];
  } catch {
    return [];
  }
}
