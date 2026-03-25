import type { PlatformRuntimeProviderKeyMetadata } from "./platform-runtime-provider-settings";

export const TOOL_CREDENTIAL_IDS = {
  tool_web_search: "tool/web_search/api-key",
  tool_web_fetch: "tool/web_fetch/api-key",
  tool_image_generate: "tool/image_generate/api-key",
  tool_tts: "tool/tts/api-key",
  tool_memory_search: "tool/memory_search/api-key"
} as const;

export type ToolCredentialKey = keyof typeof TOOL_CREDENTIAL_IDS;
export const ALL_TOOL_CREDENTIAL_KEYS: ToolCredentialKey[] = Object.keys(
  TOOL_CREDENTIAL_IDS
) as ToolCredentialKey[];

export const TOOL_CODE_BY_CREDENTIAL_KEY: Record<ToolCredentialKey, string> = {
  tool_web_search: "web_search",
  tool_web_fetch: "web_fetch",
  tool_image_generate: "image_generate",
  tool_tts: "tts",
  tool_memory_search: "memory_search"
};

export const CREDENTIAL_KEY_BY_SECRET_ID: Record<string, ToolCredentialKey> = Object.entries(
  TOOL_CREDENTIAL_IDS
).reduce<Record<string, ToolCredentialKey>>((accumulator, [key, secretId]) => {
  accumulator[secretId] = key as ToolCredentialKey;
  return accumulator;
}, {});

export type ToolCredentialStatus = {
  credentialKey: ToolCredentialKey;
  toolCode: string;
  displayName: string;
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
};

export type AdminToolCredentialsState = {
  schema: "persai.adminToolCredentials.v1";
  credentials: ToolCredentialStatus[];
  notes: string[];
};

export type UpdateToolCredentialsInput = {
  keys: Partial<Record<ToolCredentialKey, string>>;
};

const MAX_KEY_LENGTH = 512;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

export function parseUpdateToolCredentialsInput(body: unknown): UpdateToolCredentialsInput {
  if (!isObject(body)) {
    throw new Error("Request body must be an object.");
  }
  const keysRaw = body.keys;
  if (!isObject(keysRaw)) {
    throw new Error("keys must be an object.");
  }
  const keys: Partial<Record<ToolCredentialKey, string>> = {};
  for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
    const value = keysRaw[credentialKey];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`keys.${credentialKey} must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > MAX_KEY_LENGTH) {
      throw new Error(
        `keys.${credentialKey} must be at most ${String(MAX_KEY_LENGTH)} characters.`
      );
    }
    if (containsControlCharacters(trimmed)) {
      throw new Error(`keys.${credentialKey} contains invalid control characters.`);
    }
    keys[credentialKey] = trimmed;
  }
  return { keys };
}

export function buildToolCredentialSecretRef(credentialKey: ToolCredentialKey): {
  refKey: string;
  secretRef: { source: "persai"; provider: string; id: string };
} {
  const secretId = TOOL_CREDENTIAL_IDS[credentialKey];
  return {
    refKey: `persai:persai-runtime:${secretId}`,
    secretRef: {
      source: "persai",
      provider: "persai-runtime",
      id: secretId
    }
  };
}

export function buildAdminToolCredentialsState(params: {
  keyMetadata: Record<ToolCredentialKey, PlatformRuntimeProviderKeyMetadata>;
}): AdminToolCredentialsState {
  const DISPLAY_NAMES: Record<ToolCredentialKey, string> = {
    tool_web_search: "Web Search API Key",
    tool_web_fetch: "Web Fetch (Firecrawl) API Key",
    tool_image_generate: "Image Generation API Key",
    tool_tts: "Text-to-Speech API Key",
    tool_memory_search: "Memory Search (Embeddings) API Key"
  };

  return {
    schema: "persai.adminToolCredentials.v1",
    credentials: ALL_TOOL_CREDENTIAL_KEYS.map((credentialKey) => ({
      credentialKey,
      toolCode: TOOL_CODE_BY_CREDENTIAL_KEY[credentialKey],
      displayName: DISPLAY_NAMES[credentialKey],
      configured: params.keyMetadata[credentialKey].configured,
      lastFour: params.keyMetadata[credentialKey].lastFour,
      updatedAt: params.keyMetadata[credentialKey].updatedAt
    })),
    notes: [
      "Tool credentials are managed globally for all assistants.",
      "Raw keys are write-only and stored encrypted in PersAI."
    ]
  };
}
