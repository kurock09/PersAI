import assert from "node:assert/strict";
import type { PlatformRuntimeProviderKeyMetadata } from "../src/modules/workspace-management/application/platform-runtime-provider-settings";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  buildAdminToolCredentialsState,
  buildToolCredentialSecretRef,
  parseUpdateToolCredentialsInput
} from "../src/modules/workspace-management/application/tool-credential-settings";

function createKeyMetadata(): Record<
  (typeof ALL_TOOL_CREDENTIAL_KEYS)[number],
  PlatformRuntimeProviderKeyMetadata
> {
  return Object.fromEntries(
    ALL_TOOL_CREDENTIAL_KEYS.map((credentialKey) => [
      credentialKey,
      { configured: false, lastFour: null, updatedAt: null }
    ])
  ) as Record<(typeof ALL_TOOL_CREDENTIAL_KEYS)[number], PlatformRuntimeProviderKeyMetadata>;
}

async function run(): Promise<void> {
  const parsed = parseUpdateToolCredentialsInput({
    keys: {
      tool_browser: "  browserless-secret  "
    },
    providers: {
      tool_browser: "browserless"
    }
  });

  assert.deepEqual(parsed, {
    keys: {
      tool_browser: "browserless-secret"
    },
    providers: {
      tool_browser: "browserless"
    }
  });

  assert.deepEqual(buildToolCredentialSecretRef("tool_browser"), {
    refKey: "persai:persai-runtime:tool/browser/api-key",
    secretRef: {
      source: "persai",
      provider: "persai-runtime",
      id: "tool/browser/api-key"
    }
  });

  const state = buildAdminToolCredentialsState({
    keyMetadata: {
      ...createKeyMetadata(),
      tool_browser: {
        configured: true,
        lastFour: "abcd",
        updatedAt: "2026-04-13T12:00:00.000Z"
      }
    },
    providerSelections: {
      tool_browser: "browserless"
    }
  });

  assert.equal(state.credentials.length, 6);
  assert.deepEqual(
    state.credentials.find((credential) => credential.credentialKey === "tool_browser"),
    {
      credentialKey: "tool_browser",
      toolCode: "browser",
      displayName: "Browser (Browserless) API Key",
      configured: true,
      lastFour: "abcd",
      updatedAt: "2026-04-13T12:00:00.000Z",
      providerId: "browserless",
      providerOptions: [
        {
          id: "browserless",
          label: "Browserless",
          envVar: "BROWSERLESS_API_KEY"
        }
      ]
    }
  );
}

void run();
