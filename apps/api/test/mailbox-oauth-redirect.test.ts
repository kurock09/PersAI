/**
 * ADR-169 repair — `resolveMailboxOAuthCallbackRedirectUri` must read exactly
 * one environment variable name, the one actually wired in `infra/helm`
 * (`values.yaml`/`values-dev.yaml`): `PERSAI_PUBLIC_API_BASE_URL`. A second
 * accepted alias would silently read as configured in a test/dev shell while
 * staying unset in every real deployed environment.
 */
import assert from "node:assert/strict";
import { resolveMailboxOAuthCallbackRedirectUri } from "../src/modules/workspace-management/application/mailbox-oauth-redirect";

const ENV_KEY = "PERSAI_PUBLIC_API_BASE_URL";
const LEGACY_ALIAS_KEY = "PERSAI_API_PUBLIC_BASE_URL";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    original[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function testResolvesFromTheWiredEnvVar(): void {
  withEnv({ [ENV_KEY]: "https://api.persai.dev", [LEGACY_ALIAS_KEY]: undefined }, () => {
    assert.equal(
      resolveMailboxOAuthCallbackRedirectUri(),
      "https://api.persai.dev/api/v1/public/integrations/email-mailbox/callback"
    );
  });
  console.log("✓ resolves the byte-identical redirect_uri from PERSAI_PUBLIC_API_BASE_URL");
}

function testReturnsNullWhenUnset(): void {
  withEnv({ [ENV_KEY]: undefined, [LEGACY_ALIAS_KEY]: undefined }, () => {
    assert.equal(resolveMailboxOAuthCallbackRedirectUri(), null);
  });
  console.log("✓ returns null (fails closed) when PERSAI_PUBLIC_API_BASE_URL is unset");
}

function testDoesNotFallBackToTheDroppedAlias(): void {
  withEnv({ [ENV_KEY]: undefined, [LEGACY_ALIAS_KEY]: "https://api.persai.dev" }, () => {
    assert.equal(
      resolveMailboxOAuthCallbackRedirectUri(),
      null,
      "PERSAI_API_PUBLIC_BASE_URL is not the name wired in infra/helm and must not be read"
    );
  });
  console.log(
    "✓ does not fall back to the dropped PERSAI_API_PUBLIC_BASE_URL alias, matching infra/helm"
  );
}

function run(): void {
  testResolvesFromTheWiredEnvVar();
  testReturnsNullWhenUnset();
  testDoesNotFallBackToTheDroppedAlias();
  console.log("\n✅ All mailbox-oauth-redirect tests passed");
}

run();
