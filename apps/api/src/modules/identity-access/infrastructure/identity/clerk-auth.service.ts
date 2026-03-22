import { createClerkClient, verifyToken } from "@clerk/backend";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ApiConfig, loadApiConfig } from "@persai/config";
import { ResolvedAuthUser } from "../../application/resolved-auth-user.types";

interface ClerkTokenPayload {
  sub: string;
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

@Injectable()
export class ClerkAuthService {
  private readonly apiConfig: ApiConfig;
  private readonly clerkClient;

  constructor() {
    this.apiConfig = loadApiConfig(process.env);
    this.clerkClient = createClerkClient({ secretKey: this.apiConfig.CLERK_SECRET_KEY });
  }

  async resolveAuthenticatedUser(token: string): Promise<ResolvedAuthUser> {
    if (token.length === 0) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const verified = await verifyToken(token, {
      secretKey: this.apiConfig.CLERK_SECRET_KEY
    }).catch(() => {
      throw new UnauthorizedException("Invalid Clerk token.");
    });

    const tokenPayload = toClerkTokenPayload(verified);
    if (tokenPayload === null) {
      throw new UnauthorizedException("Token does not contain a valid subject.");
    }

    const clerkUser = await this.clerkClient.users.getUser(tokenPayload.sub).catch(() => {
      throw new UnauthorizedException("Unable to resolve Clerk user profile.");
    });

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
