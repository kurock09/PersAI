import type { PersaiRuntimeTtsProviderId } from "@persai/runtime-contract";
import type { PlatformRuntimeProviderKeyMetadata } from "./platform-runtime-provider-settings";

export const TOOL_CREDENTIAL_IDS = {
  tool_web_search: "tool/web_search/api-key",
  tool_web_fetch: "tool/web_fetch/api-key",
  tool_image_generate: "tool/image_generate/api-key",
  tool_browser: "tool/browser/api-key",
  tool_tts_elevenlabs: "tool/tts/elevenlabs/api-key",
  tool_tts_yandex: "tool/tts/yandex/api-key",
  tool_tts_openai: "tool/tts/openai/api-key",
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
  tool_browser: "browser",
  tool_tts_elevenlabs: "tts",
  tool_tts_yandex: "tts",
  tool_tts_openai: "tts",
  tool_memory_search: "memory_search"
};

export const TTS_PROVIDER_TO_CREDENTIAL_KEY: Record<PersaiRuntimeTtsProviderId, ToolCredentialKey> =
  {
    elevenlabs: "tool_tts_elevenlabs",
    yandex: "tool_tts_yandex",
    openai: "tool_tts_openai"
  };

export const TTS_PRIMARY_PROVIDER_STORAGE_KEY = "tool_tts__primary_provider" as const;
export const DEFAULT_TTS_PRIMARY_PROVIDER: PersaiRuntimeTtsProviderId = "elevenlabs";

export const CREDENTIAL_KEY_BY_SECRET_ID: Record<string, ToolCredentialKey> = Object.entries(
  TOOL_CREDENTIAL_IDS
).reduce<Record<string, ToolCredentialKey>>((accumulator, [key, secretId]) => {
  accumulator[secretId] = key as ToolCredentialKey;
  return accumulator;
}, {});

export type ToolProviderOption = {
  id: string;
  label: string;
  envVar: string;
};

export const TOOL_PROVIDER_OPTIONS: Partial<Record<ToolCredentialKey, ToolProviderOption[]>> = {
  tool_web_search: [
    { id: "tavily", label: "Tavily", envVar: "TAVILY_API_KEY" },
    { id: "brave", label: "Brave Search", envVar: "BRAVE_API_KEY" },
    { id: "perplexity", label: "Perplexity", envVar: "PERPLEXITY_API_KEY" },
    { id: "google", label: "Google (Gemini)", envVar: "GEMINI_API_KEY" }
  ],
  tool_browser: [{ id: "browserless", label: "Browserless", envVar: "BROWSERLESS_API_KEY" }]
};

export const TOOL_DEFAULT_PROVIDER: Partial<Record<ToolCredentialKey, string>> = {
  tool_web_search: "tavily",
  tool_browser: "browserless"
};

export const TTS_PRIMARY_PROVIDER_OPTIONS: ToolProviderOption[] = [
  { id: "elevenlabs", label: "ElevenLabs", envVar: "ELEVENLABS_API_KEY" },
  { id: "yandex", label: "Yandex SpeechKit", envVar: "YANDEX_TTS_API_KEY" },
  { id: "openai", label: "OpenAI TTS", envVar: "OPENAI_TTS_API_KEY" }
];

export function providerStorageKey(credentialKey: ToolCredentialKey): string {
  return `${credentialKey}__provider`;
}

export type ToolCredentialStatus = {
  credentialKey: ToolCredentialKey;
  toolCode: string;
  displayName: string;
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
  providerId: string | null;
  providerOptions: ToolProviderOption[] | null;
};

export type AdminToolCredentialsState = {
  schema: "persai.adminToolCredentials.v1";
  credentials: ToolCredentialStatus[];
  ttsPrimaryProviderId: PersaiRuntimeTtsProviderId;
  ttsPrimaryProviderOptions: ToolProviderOption[];
  notes: string[];
};

export type UpdateToolCredentialsInput = {
  keys: Partial<Record<ToolCredentialKey, string>>;
  providers: Partial<Record<ToolCredentialKey, string>>;
  ttsPrimaryProviderId?: PersaiRuntimeTtsProviderId;
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

  const providers: Partial<Record<ToolCredentialKey, string>> = {};
  const providersRaw = body.providers;
  if (isObject(providersRaw)) {
    for (const credentialKey of ALL_TOOL_CREDENTIAL_KEYS) {
      const value = providersRaw[credentialKey];
      if (typeof value !== "string" || value.trim().length === 0) {
        continue;
      }
      const options = TOOL_PROVIDER_OPTIONS[credentialKey];
      if (!options) {
        continue;
      }
      const trimmed = value.trim();
      if (!options.some((opt) => opt.id === trimmed)) {
        throw new Error(
          `providers.${credentialKey} must be one of: ${options.map((o) => o.id).join(", ")}.`
        );
      }
      providers[credentialKey] = trimmed;
    }
  }

  const ttsPrimaryProviderIdRaw = body.ttsPrimaryProviderId;
  const ttsPrimaryProviderId =
    typeof ttsPrimaryProviderIdRaw === "string" && ttsPrimaryProviderIdRaw.trim().length > 0
      ? ttsPrimaryProviderIdRaw.trim()
      : undefined;
  if (
    ttsPrimaryProviderId !== undefined &&
    !TTS_PRIMARY_PROVIDER_OPTIONS.some((option) => option.id === ttsPrimaryProviderId)
  ) {
    throw new Error(
      `ttsPrimaryProviderId must be one of: ${TTS_PRIMARY_PROVIDER_OPTIONS.map((option) => option.id).join(", ")}.`
    );
  }

  return {
    keys,
    providers,
    ...(ttsPrimaryProviderId === undefined
      ? {}
      : { ttsPrimaryProviderId: ttsPrimaryProviderId as PersaiRuntimeTtsProviderId })
  };
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
  providerSelections: Partial<Record<ToolCredentialKey, string>>;
  ttsPrimaryProviderId?: PersaiRuntimeTtsProviderId | null;
}): AdminToolCredentialsState {
  const DISPLAY_NAMES: Record<ToolCredentialKey, string> = {
    tool_web_search: "Web Search API Key",
    tool_web_fetch: "Web Fetch (Firecrawl) API Key",
    tool_image_generate: "Image Generation API Key",
    tool_browser: "Browser (Browserless) API Key",
    tool_tts_elevenlabs: "Text-to-Speech API Key (ElevenLabs)",
    tool_tts_yandex: "Text-to-Speech API Key (Yandex SpeechKit)",
    tool_tts_openai: "Text-to-Speech API Key (OpenAI)",
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
      updatedAt: params.keyMetadata[credentialKey].updatedAt,
      providerId:
        params.providerSelections[credentialKey] ?? TOOL_DEFAULT_PROVIDER[credentialKey] ?? null,
      providerOptions: TOOL_PROVIDER_OPTIONS[credentialKey] ?? null
    })),
    ttsPrimaryProviderId: params.ttsPrimaryProviderId ?? DEFAULT_TTS_PRIMARY_PROVIDER,
    ttsPrimaryProviderOptions: TTS_PRIMARY_PROVIDER_OPTIONS,
    notes: [
      "Tool credentials are managed globally for all assistants.",
      "TTS stores provider-specific keys plus one global primary-provider selection.",
      "Raw keys are write-only and stored encrypted in PersAI."
    ]
  };
}
