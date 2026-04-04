import { UnauthorizedException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

export function assertPersaiInternalApiAuthorized(
  req: InternalRequestLike,
  missingConfigMessage: string,
  invalidTokenMessage: string
): void {
  const rawAuthHeader = req.headers.authorization;
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
  const token =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
  const configured = loadApiConfig(process.env).PERSAI_INTERNAL_API_TOKEN?.trim() ?? "";
  if (configured.length === 0) {
    throw new UnauthorizedException(missingConfigMessage);
  }
  if (token.length === 0 || token !== configured) {
    throw new UnauthorizedException(invalidTokenMessage);
  }
}
