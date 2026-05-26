import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";

import {
  ClerkAuthService,
  classifyClerkVerifyFailure
} from "../src/modules/identity-access/infrastructure/identity/clerk-auth.service";

// ADR-074 Memory Center "Session expired" follow-up — lock the
// classification surface for the WARN log we now emit on every failed
// `verifyToken`. The intent is twofold:
//   1. keep cardinality bounded (the enum we pin here),
//   2. make sure that the most-frequent founder-facing failure mode
//      (Clerk JWT TTL expiry) is reliably classified as `token_expired`
//      so on-call can grep one keyword in GKE logs to confirm whether
//      the next "Session expired" report is yet another expired-token
//      cycle vs a real signature/jwks/audience issue.

void test("classifyClerkVerifyFailure: token expired → token_expired", () => {
  assert.equal(
    classifyClerkVerifyFailure(new Error("Token has expired (exp claim is in the past)")),
    "token_expired"
  );
  assert.equal(classifyClerkVerifyFailure({ reason: "token-expired" }), "token_expired");
  assert.equal(classifyClerkVerifyFailure({ code: "TokenExpired" }), "token_expired");
});

void test("classifyClerkVerifyFailure: not-active-yet (nbf) → token_not_active_yet", () => {
  assert.equal(
    classifyClerkVerifyFailure(new Error("token not active yet (nbf claim)")),
    "token_not_active_yet"
  );
  assert.equal(classifyClerkVerifyFailure({ reason: "nbf-future" }), "token_not_active_yet");
});

void test("classifyClerkVerifyFailure: signature → invalid_signature", () => {
  assert.equal(
    classifyClerkVerifyFailure(new Error("Invalid signature on JWT")),
    "invalid_signature"
  );
});

void test("classifyClerkVerifyFailure: audience / issuer", () => {
  assert.equal(classifyClerkVerifyFailure(new Error("audience mismatch")), "invalid_audience");
  assert.equal(classifyClerkVerifyFailure(new Error("Invalid issuer (iss)")), "invalid_issuer");
});

void test("classifyClerkVerifyFailure: malformed / decode → malformed_token", () => {
  assert.equal(classifyClerkVerifyFailure(new Error("Malformed JWT")), "malformed_token");
  assert.equal(classifyClerkVerifyFailure(new Error("Failed to decode header")), "malformed_token");
});

void test("classifyClerkVerifyFailure: jwks / network → jwks_fetch_failed", () => {
  assert.equal(
    classifyClerkVerifyFailure(new Error("Failed to fetch JWKS from Clerk")),
    "jwks_fetch_failed"
  );
  assert.equal(classifyClerkVerifyFailure(new Error("network ECONNRESET")), "jwks_fetch_failed");
});

void test("classifyClerkVerifyFailure: unknown shape → unknown", () => {
  assert.equal(classifyClerkVerifyFailure(undefined), "unknown");
  assert.equal(classifyClerkVerifyFailure(null), "unknown");
  assert.equal(classifyClerkVerifyFailure(42), "unknown");
  assert.equal(classifyClerkVerifyFailure({}), "unknown");
  assert.equal(
    classifyClerkVerifyFailure(new Error("totally unrelated database error")),
    "unknown"
  );
});

function createTestService(options: {
  verifiedPayload: unknown;
  clerkUserResult?: {
    id: string;
    primaryEmailAddressId: string;
    emailAddresses: Array<{ id: string; emailAddress: string }>;
    firstName: string | null;
    lastName: string | null;
  };
  clerkUserError?: unknown;
  fallbackAppUser?: { clerkUserId: string; email: string; displayName: string | null } | null;
}) {
  const warnings: string[] = [];
  const service = Object.create(ClerkAuthService.prototype) as ClerkAuthService & {
    logger: { warn(message: string): void };
    prismaService: {
      appUser: {
        findUnique(args: { where: { clerkUserId: string } }): Promise<{
          clerkUserId: string;
          email: string;
          displayName: string | null;
        } | null>;
      };
    };
    verifyClerkToken(token: string): Promise<unknown>;
    getClerkUserProfile(clerkUserId: string): Promise<unknown>;
  };

  service.logger = {
    warn(message: string) {
      warnings.push(message);
    }
  };
  service.prismaService = {
    appUser: {
      async findUnique() {
        return options.fallbackAppUser ?? null;
      }
    }
  };
  service.verifyClerkToken = async () => options.verifiedPayload;
  service.getClerkUserProfile = async () => {
    if (options.clerkUserError !== undefined) {
      throw options.clerkUserError;
    }
    return options.clerkUserResult as never;
  };

  return { service, warnings };
}

void test("resolveAuthenticatedUser: uses existing AppUser fallback when Clerk profile lookup fails", async () => {
  const { service, warnings } = createTestService({
    verifiedPayload: { sub: "clerk_existing_user" },
    clerkUserError: new Error("Internal Server Error"),
    fallbackAppUser: {
      clerkUserId: "clerk_existing_user",
      email: "Known.User@Example.com",
      displayName: "Known User"
    }
  });

  const resolvedUser = await service.resolveAuthenticatedUser("bearer-token");

  assert.deepEqual(resolvedUser, {
    clerkUserId: "clerk_existing_user",
    email: "known.user@example.com",
    displayName: "Known User"
  });
  assert.equal(
    warnings.some((message) => message.includes("using existing AppUser DB fallback.")),
    true
  );
});

void test("resolveAuthenticatedUser: rejects unknown Clerk subject when profile lookup fails and DB fallback is missing", async () => {
  const { service, warnings } = createTestService({
    verifiedPayload: { sub: "clerk_unknown_user" },
    clerkUserError: new Error("Internal Server Error"),
    fallbackAppUser: null
  });

  await assert.rejects(
    () => service.resolveAuthenticatedUser("bearer-token"),
    (error: unknown) =>
      error instanceof UnauthorizedException &&
      error.message === "Unable to resolve Clerk user profile."
  );
  assert.equal(
    warnings.some((message) => message.includes("no existing AppUser DB fallback found.")),
    true
  );
});

void test("resolveAuthenticatedUser: still prefers live Clerk profile when it succeeds", async () => {
  const { service, warnings } = createTestService({
    verifiedPayload: { sub: "clerk_live_user" },
    clerkUserResult: {
      id: "clerk_live_user",
      primaryEmailAddressId: "email_primary",
      emailAddresses: [{ id: "email_primary", emailAddress: "Live.User@Example.com" }],
      firstName: "Live",
      lastName: "User"
    }
  });

  const resolvedUser = await service.resolveAuthenticatedUser("bearer-token");

  assert.deepEqual(resolvedUser, {
    clerkUserId: "clerk_live_user",
    email: "live.user@example.com",
    displayName: "Live User"
  });
  assert.deepEqual(warnings, []);
});
