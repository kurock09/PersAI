import test from "node:test";
import assert from "node:assert/strict";

import { classifyClerkVerifyFailure } from "../src/modules/identity-access/infrastructure/identity/clerk-auth.service";

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
