import { UnauthorizedException } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";

export type RuntimeInternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

// ADR-074 Slice M2 — runtime-side internal endpoints (currently the
// background compaction callback from `apps/api`'s scheduler) must verify
// the same `PERSAI_INTERNAL_API_TOKEN` bearer that the API enforces in the
// other direction. Mirrors `assertPersaiInternalApiAuthorized` on the API
// side so both directions of the internal channel use one shared secret.
export function assertRuntimeInternalApiAuthorized(
  req: RuntimeInternalRequestLike,
  config: RuntimeConfig,
  missingConfigMessage: string,
  invalidTokenMessage: string
): void {
  const rawAuthHeader = req.headers.authorization;
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
  const token =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
  const configured = config.PERSAI_INTERNAL_API_TOKEN?.trim() ?? "";
  if (configured.length === 0) {
    throw new UnauthorizedException(missingConfigMessage);
  }
  if (token.length === 0 || token !== configured) {
    throw new UnauthorizedException(invalidTokenMessage);
  }
}
