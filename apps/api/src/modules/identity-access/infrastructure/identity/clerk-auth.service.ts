import { createClerkClient, verifyToken } from "@clerk/backend";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { AppUser } from "@prisma/client";
import { ApiConfig, loadApiConfig } from "@persai/config";
import { ResolvedAuthUser } from "../../application/resolved-auth-user.types";
import { PrismaService } from "../persistence/prisma.service";

interface ClerkTokenPayload {
  sub: string;
}

interface ClerkUserProfile {
  id: string;
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{
    id: string;
    emailAddress: string;
  }>;
  firstName: string | null;
  lastName: string | null;
}

function toClerkTokenPayload(value: unknown): ClerkTokenPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const maybeSub = (value as Record<string, unknown>).sub;
  if (typeof maybeSub !== "string" || maybeSub.length === 0) {
    return null;
  }

  return { sub: maybeSub };
}

// ADR-074 Memory Center "Session expired" follow-up — surface the real
// reason a Clerk JWT failed verification instead of swallowing every
// failure into a single opaque "Invalid Clerk token." 401. The frontend
// turns any 401 into the literal "Session expired. Sign in again and
// refresh the page." inline banner, so without this WARN log we cannot
// tell expired-token vs invalid-signature vs network/JWKS hiccup from
// GKE logs and end up shipping UX hotfixes (Reload button) instead of
// root-cause fixes. We deliberately log the upstream reason at WARN
// (cardinality is bounded by Clerk's reason set) and never log the
// token itself.
type ClerkVerifyFailureReason =
  | "token_expired"
  | "token_not_active_yet"
  | "invalid_signature"
  | "invalid_audience"
  | "invalid_issuer"
  | "malformed_token"
  | "jwks_fetch_failed"
  | "unknown";

export function classifyClerkVerifyFailure(error: unknown): ClerkVerifyFailureReason {
  const reason = (() => {
    if (typeof error !== "object" || error === null) {
      return "";
    }
    const candidate =
      (error as { reason?: unknown }).reason ??
      (error as { code?: unknown }).code ??
      (error as { message?: unknown }).message;
    return typeof candidate === "string" ? candidate.toLowerCase() : "";
  })();

  if (reason.includes("expired")) return "token_expired";
  if (reason.includes("not active") || reason.includes("nbf")) return "token_not_active_yet";
  if (reason.includes("signature")) return "invalid_signature";
  if (reason.includes("audience") || reason.includes("aud")) return "invalid_audience";
  if (reason.includes("issuer") || reason.includes("iss")) return "invalid_issuer";
  if (reason.includes("malform") || reason.includes("decode")) return "malformed_token";
  if (reason.includes("jwks") || reason.includes("fetch") || reason.includes("network")) {
    return "jwks_fetch_failed";
  }
  return "unknown";
}

function toResolvedAuthUserFromAppUser(appUser: AppUser): ResolvedAuthUser {
  return {
    clerkUserId: appUser.clerkUserId ?? "",
    email: appUser.email.toLowerCase(),
    displayName: appUser.displayName
  };
}

@Injectable()
export class ClerkAuthService {
  private readonly logger = new Logger(ClerkAuthService.name);
  private readonly apiConfig: ApiConfig;
  private readonly clerkClient: {
    users: {
      getUser(clerkUserId: string): Promise<ClerkUserProfile>;
    };
  };

  constructor(private readonly prismaService: PrismaService) {
    this.apiConfig = loadApiConfig(process.env);
    this.clerkClient = createClerkClient({ secretKey: this.apiConfig.CLERK_SECRET_KEY });
  }

  protected async verifyClerkToken(token: string): Promise<unknown> {
    return verifyToken(token, {
      secretKey: this.apiConfig.CLERK_SECRET_KEY
    }).catch((error: unknown) => {
      const reason = classifyClerkVerifyFailure(error);
      const upstreamMessage = error instanceof Error ? error.message : String(error);
      // Cardinality stays small (bounded reason enum); never log the
      // token itself to keep this safe against accidental leakage into
      // GKE log sinks.
      this.logger.warn(`Clerk verifyToken failed: reason=${reason} upstream="${upstreamMessage}"`);
      throw new UnauthorizedException(`Invalid Clerk token (${reason}).`);
    });
  }

  protected async getClerkUserProfile(clerkUserId: string): Promise<ClerkUserProfile> {
    return this.clerkClient.users.getUser(clerkUserId);
  }

  async resolveAuthenticatedUser(token: string): Promise<ResolvedAuthUser> {
    if (token.length === 0) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const verified = await this.verifyClerkToken(token);

    const tokenPayload = toClerkTokenPayload(verified);
    if (tokenPayload === null) {
      this.logger.warn("Clerk verifyToken succeeded but payload is missing `sub` claim.");
      throw new UnauthorizedException("Token does not contain a valid subject.");
    }

    let clerkUser;
    try {
      clerkUser = await this.getClerkUserProfile(tokenPayload.sub);
    } catch (error: unknown) {
      const upstreamMessage = error instanceof Error ? error.message : String(error);
      const existingAppUser = await this.prismaService.appUser.findUnique({
        where: { clerkUserId: tokenPayload.sub }
      });

      if (existingAppUser !== null) {
        this.logger.warn(
          `Clerk users.getUser(${tokenPayload.sub}) failed: ${upstreamMessage}; using existing AppUser DB fallback.`
        );
        return toResolvedAuthUserFromAppUser(existingAppUser);
      }

      this.logger.warn(
        `Clerk users.getUser(${tokenPayload.sub}) failed: ${upstreamMessage}; no existing AppUser DB fallback found.`
      );
      throw new UnauthorizedException("Unable to resolve Clerk user profile.");
    }

    const primaryEmailId = clerkUser.primaryEmailAddressId;
    const primaryEmail = clerkUser.emailAddresses.find((email) => email.id === primaryEmailId);

    if (!primaryEmail?.emailAddress) {
      throw new UnauthorizedException("Clerk user has no primary email.");
    }

    return {
      clerkUserId: clerkUser.id,
      email: primaryEmail.emailAddress.toLowerCase(),
      displayName:
        clerkUser.firstName || clerkUser.lastName
          ? [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ")
          : null
    };
  }
}
