import assert from "node:assert/strict";
import type { PlatformRuntimeProviderKeyMetadata } from "../src/modules/workspace-management/application/platform-runtime-provider-settings";
import {
  ALL_TOOL_CREDENTIAL_KEYS,
  CREDENTIAL_KEY_BY_SECRET_ID,
  TOOL_CODE_BY_CREDENTIAL_KEY,
  TOOL_CREDENTIAL_IDS,
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
    },
    documentProviderTemplateIds: {
      pdfmonkey: "  template-123  "
    }
  });

  assert.deepEqual(parsed, {
    keys: {
      tool_browser: "browserless-secret"
    },
    providers: {
      tool_browser: "browserless"
    },
    documentProviderTemplateIds: {
      pdfmonkey: "template-123"
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
      },
      tool_video_generate_runway: {
        configured: true,
        lastFour: "wy42",
        updatedAt: "2026-06-01T12:00:00.000Z"
      }
    },
    providerSelections: {
      tool_browser: "browserless"
    },
    documentProviderConfigMetadata: {
      pdfmonkey: {
        configured: true,
        lastFour: "e123",
        updatedAt: "2026-05-15T12:00:00.000Z"
      }
    }
  });

  assert.equal(state.credentials.length, 14); // 12 visible tool credentials + 2 notification credentials
  assert.equal(
    state.credentials.find((credential) => credential.credentialKey === "tool_memory_search"),
    undefined
  );
  assert.equal(state.ttsPrimaryProviderId, "elevenlabs");
  assert.deepEqual(state.documentProviderConfigs, [
    {
      providerId: "pdfmonkey",
      templateIdConfigured: true,
      templateIdLastFour: "e123",
      templateIdUpdatedAt: "2026-05-15T12:00:00.000Z"
    }
  ]);
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
  assert.deepEqual(
    state.credentials.find((credential) => credential.credentialKey === "tool_tts_openai"),
    {
      credentialKey: "tool_tts_openai",
      toolCode: "tts",
      displayName: "Text-to-Speech API Key (OpenAI)",
      configured: false,
      lastFour: null,
      updatedAt: null,
      providerId: null,
      providerOptions: null
    }
  );
  assert.deepEqual(
    state.credentials.find(
      (credential) => credential.credentialKey === "tool_video_generate_runway"
    ),
    {
      credentialKey: "tool_video_generate_runway",
      toolCode: "video_generate",
      displayName: "Video Generation API Key (Runway)",
      configured: true,
      lastFour: "wy42",
      updatedAt: "2026-06-01T12:00:00.000Z",
      providerId: null,
      providerOptions: null
    }
  );
}

async function runHeygenCredentialRegistration(): Promise<void> {
  assert.equal(
    TOOL_CREDENTIAL_IDS.tool_video_generate_heygen,
    "tool/video_generate/heygen/api-key"
  );
  assert.equal(TOOL_CODE_BY_CREDENTIAL_KEY.tool_video_generate_heygen, "video_generate");
  assert.ok(ALL_TOOL_CREDENTIAL_KEYS.includes("tool_video_generate_heygen"));
  assert.equal(
    CREDENTIAL_KEY_BY_SECRET_ID["tool/video_generate/heygen/api-key"],
    "tool_video_generate_heygen"
  );
  assert.deepEqual(buildToolCredentialSecretRef("tool_video_generate_heygen"), {
    refKey: "persai:persai-runtime:tool/video_generate/heygen/api-key",
    secretRef: {
      source: "persai",
      provider: "persai-runtime",
      id: "tool/video_generate/heygen/api-key"
    }
  });
}

void run();
void runHeygenCredentialRegistration();
