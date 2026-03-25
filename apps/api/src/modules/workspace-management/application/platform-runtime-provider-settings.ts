import {
  RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA,
  RUNTIME_PROVIDER_PROFILE_SCHEMA,
  type ManagedRuntimeProvider,
  type RuntimeProviderAvailableModelsByProvider,
  type RuntimeProviderCredentialRefState,
  type RuntimeProviderProfileState
} from "./runtime-provider-profile";

export const PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID = "global";
export const PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA = "persai.adminRuntimeProviderSettings.v1";
export const PERSAI_RUNTIME_SECRET_PROVIDER_ALIAS = "persai-runtime";

export const PERSAI_RUNTIME_PROVIDER_SECRET_IDS: Record<ManagedRuntimeProvider, string> = {
  openai: "openai/api-key",
  anthropic: "anthropic/api-key"
};

const MANAGED_RUNTIME_PROVIDERS: ManagedRuntimeProvider[] = ["openai", "anthropic"];
const MAX_MODEL_LENGTH = 256;
const MAX_MODELS_PER_PROVIDER = 64;
const MAX_PROVIDER_KEY_LENGTH = 512;

export type PlatformRuntimeProviderSelection = {
  provider: ManagedRuntimeProvider;
  model: string;
};

export type PlatformRuntimeProviderKeyMetadata = {
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
};

export type PlatformRuntimeProviderSettingsState = {
  schema: typeof PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA;
  mode: "legacy_openclaw_default" | "global_settings";
  primary: PlatformRuntimeProviderSelection | null;
  fallback: PlatformRuntimeProviderSelection | null;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  providerKeys: Record<ManagedRuntimeProvider, PlatformRuntimeProviderKeyMetadata>;
  notes: string[];
};

export type PlatformRuntimeProviderSettingsRecord = {
  primaryProvider: ManagedRuntimeProvider;
  primaryModel: string;
  fallbackProvider: ManagedRuntimeProvider | null;
  fallbackModel: string | null;
  availableModelsByProvider: unknown;
};

export type UpdatePlatformRuntimeProviderSettingsInput = {
  primary: PlatformRuntimeProviderSelection;
  fallback: PlatformRuntimeProviderSelection | null;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  providerKeys: Partial<Record<ManagedRuntimeProvider, string>>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

export function createEmptyAvailableModelsByProvider(): RuntimeProviderAvailableModelsByProvider {
  return {
    openai: [],
    anthropic: []
  };
}

export function createEmptyPlatformRuntimeProviderKeyMetadata(): Record<
  ManagedRuntimeProvider,
  PlatformRuntimeProviderKeyMetadata
> {
  return {
    openai: {
      configured: false,
      lastFour: null,
      updatedAt: null
    },
    anthropic: {
      configured: false,
      lastFour: null,
      updatedAt: null
    }
  };
}

function normalizeProvider(value: unknown, path: string): ManagedRuntimeProvider {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === "openai" || normalized === "anthropic") {
    return normalized;
  }
  throw new Error(`${path} must be one of: ${MANAGED_RUNTIME_PROVIDERS.join(", ")}.`);
}

function normalizeModel(value: unknown, path: string): string {
  const normalized = asNonEmptyString(value);
  if (normalized === null) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  if (normalized.length > MAX_MODEL_LENGTH) {
    throw new Error(`${path} must be at most ${String(MAX_MODEL_LENGTH)} characters.`);
  }
  if (containsControlCharacters(normalized)) {
    throw new Error(`${path} contains invalid control characters.`);
  }
  return normalized;
}

function normalizeSelection(value: unknown, path: string): PlatformRuntimeProviderSelection {
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object.`);
  }
  return {
    provider: normalizeProvider(row.provider, `${path}.provider`),
    model: normalizeModel(row.model, `${path}.model`)
  };
}

function normalizeAvailableModelList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of model ids.`);
  }
  const deduped = new Set<string>();
  for (const entry of value) {
    const model = normalizeModel(entry, path);
    deduped.add(model);
    if (deduped.size > MAX_MODELS_PER_PROVIDER) {
      throw new Error(`${path} must contain at most ${String(MAX_MODELS_PER_PROVIDER)} model ids.`);
    }
  }
  return Array.from(deduped);
}

export function normalizeAvailableModelsByProvider(
  value: unknown,
  path = "availableModelsByProvider"
): RuntimeProviderAvailableModelsByProvider {
  const row = asObject(value);
  if (row === null) {
    return createEmptyAvailableModelsByProvider();
  }
  return {
    openai: Array.isArray(row.openai)
      ? normalizeAvailableModelList(row.openai, `${path}.openai`)
      : [],
    anthropic: Array.isArray(row.anthropic)
      ? normalizeAvailableModelList(row.anthropic, `${path}.anthropic`)
      : []
  };
}

function ensureModelListed(
  models: RuntimeProviderAvailableModelsByProvider,
  selection: PlatformRuntimeProviderSelection | null
): RuntimeProviderAvailableModelsByProvider {
  if (selection === null) {
    return models;
  }
  const current = models[selection.provider];
  if (current.includes(selection.model)) {
    return models;
  }
  return {
    ...models,
    [selection.provider]: [...current, selection.model]
  };
}

export function mergeSelectedModelsIntoAvailableModels(params: {
  primary: PlatformRuntimeProviderSelection;
  fallback: PlatformRuntimeProviderSelection | null;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
}): RuntimeProviderAvailableModelsByProvider {
  let next = {
    openai: [...params.availableModelsByProvider.openai],
    anthropic: [...params.availableModelsByProvider.anthropic]
  } satisfies RuntimeProviderAvailableModelsByProvider;
  next = ensureModelListed(next, params.primary);
  next = ensureModelListed(next, params.fallback);
  return next;
}

function normalizeProviderKeyInput(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = asNonEmptyString(value);
  if (normalized === null) {
    return undefined;
  }
  if (normalized.length > MAX_PROVIDER_KEY_LENGTH) {
    throw new Error(`${path} must be at most ${String(MAX_PROVIDER_KEY_LENGTH)} characters.`);
  }
  if (containsControlCharacters(normalized)) {
    throw new Error(`${path} contains invalid control characters.`);
  }
  return normalized;
}

export function parseUpdatePlatformRuntimeProviderSettingsInput(
  body: unknown
): UpdatePlatformRuntimeProviderSettingsInput {
  const row = asObject(body);
  if (row === null) {
    throw new Error("Request body must be an object.");
  }
  const primary = normalizeSelection(row.primary, "primary");
  const fallbackRaw = row.fallback;
  const fallback =
    fallbackRaw === undefined || fallbackRaw === null
      ? null
      : normalizeSelection(fallbackRaw, "fallback");
  const availableModelsByProvider = mergeSelectedModelsIntoAvailableModels({
    primary,
    fallback,
    availableModelsByProvider: normalizeAvailableModelsByProvider(row.availableModelsByProvider)
  });
  const providerKeysRow = asObject(row.providerKeys ?? null);
  const providerKeys: Partial<Record<ManagedRuntimeProvider, string>> = {};
  const openaiKey = normalizeProviderKeyInput(providerKeysRow?.openai, "providerKeys.openai");
  const anthropicKey = normalizeProviderKeyInput(
    providerKeysRow?.anthropic,
    "providerKeys.anthropic"
  );
  if (openaiKey !== undefined) {
    providerKeys.openai = openaiKey;
  }
  if (anthropicKey !== undefined) {
    providerKeys.anthropic = anthropicKey;
  }
  return {
    primary,
    fallback,
    availableModelsByProvider,
    providerKeys
  };
}

export function buildPlatformRuntimeProviderSettingsState(params: {
  settings: PlatformRuntimeProviderSettingsRecord | null;
  providerKeys: Record<ManagedRuntimeProvider, PlatformRuntimeProviderKeyMetadata>;
}): PlatformRuntimeProviderSettingsState {
  if (params.settings === null) {
    return {
      schema: PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA,
      mode: "legacy_openclaw_default",
      primary: null,
      fallback: null,
      availableModelsByProvider: createEmptyAvailableModelsByProvider(),
      providerKeys: params.providerKeys,
      notes: [
        "Global runtime provider settings are not configured yet.",
        "OpenClaw keeps its legacy configured default model path until global settings are saved."
      ]
    };
  }

  const primary = {
    provider: params.settings.primaryProvider,
    model: params.settings.primaryModel
  } satisfies PlatformRuntimeProviderSelection;
  const fallback =
    params.settings.fallbackProvider !== null && params.settings.fallbackModel !== null
      ? {
          provider: params.settings.fallbackProvider,
          model: params.settings.fallbackModel
        }
      : null;
  const availableModelsByProvider = mergeSelectedModelsIntoAvailableModels({
    primary,
    fallback,
    availableModelsByProvider: normalizeAvailableModelsByProvider(
      params.settings.availableModelsByProvider
    )
  });

  return {
    schema: PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA,
    mode: "global_settings",
    primary,
    fallback,
    availableModelsByProvider,
    providerKeys: params.providerKeys,
    notes: [
      "Provider keys are managed as one global platform setting for all assistants.",
      "Raw provider keys are write-only in the admin UI and stay in encrypted PersAI storage."
    ]
  };
}

export function assertRequiredProviderKeysAvailable(params: {
  primary: PlatformRuntimeProviderSelection;
  fallback: PlatformRuntimeProviderSelection | null;
  providerKeys: Record<ManagedRuntimeProvider, PlatformRuntimeProviderKeyMetadata>;
  incomingProviderKeys: Partial<Record<ManagedRuntimeProvider, string>>;
}): void {
  const requiredProviders = new Set<ManagedRuntimeProvider>([params.primary.provider]);
  if (params.fallback !== null) {
    requiredProviders.add(params.fallback.provider);
  }
  for (const provider of requiredProviders) {
    const hasExisting = params.providerKeys[provider].configured;
    const hasIncoming =
      typeof params.incomingProviderKeys[provider] === "string" &&
      (params.incomingProviderKeys[provider] as string).trim().length > 0;
    if (!hasExisting && !hasIncoming) {
      const label = provider === "openai" ? "OpenAI" : "Anthropic";
      throw new Error(`${label} API key is required for the selected provider.`);
    }
  }
}

function buildCredentialRef(provider: ManagedRuntimeProvider): RuntimeProviderCredentialRefState {
  const id = PERSAI_RUNTIME_PROVIDER_SECRET_IDS[provider];
  return {
    refKey: `persai:${PERSAI_RUNTIME_SECRET_PROVIDER_ALIAS}:${id}`,
    secretRef: {
      source: "persai",
      provider: PERSAI_RUNTIME_SECRET_PROVIDER_ALIAS,
      id
    },
    updatedAt: null
  };
}

export function buildPlatformRuntimeProviderProfileState(
  settings: PlatformRuntimeProviderSettingsState
): RuntimeProviderProfileState {
  if (settings.mode !== "global_settings" || settings.primary === null) {
    return {
      schema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
      mode: "legacy_openclaw_default",
      derivedFrom: {
        policyEnvelopeSchema: null,
        secretRefsSchema: null
      },
      allowedProviders: [...MANAGED_RUNTIME_PROVIDERS],
      availableModelsByProvider: settings.availableModelsByProvider,
      primary: null,
      fallback: null,
      notes: [
        "No global runtime provider settings are configured.",
        "OpenClaw should keep its legacy configured default model path."
      ]
    };
  }

  const primaryKey = settings.providerKeys[settings.primary.provider];
  if (!primaryKey.configured) {
    throw new Error(
      `Global runtime provider settings are missing ${settings.primary.provider} credentials.`
    );
  }

  if (settings.fallback !== null && !settings.providerKeys[settings.fallback.provider].configured) {
    throw new Error(
      `Global runtime provider settings are missing ${settings.fallback.provider} credentials.`
    );
  }

  return {
    schema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
    mode: "admin_managed",
    derivedFrom: {
      policyEnvelopeSchema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
      secretRefsSchema: RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA
    },
    allowedProviders: [...MANAGED_RUNTIME_PROVIDERS],
    availableModelsByProvider: settings.availableModelsByProvider,
    primary: {
      provider: settings.primary.provider,
      model: settings.primary.model,
      credentialRef: {
        ...buildCredentialRef(settings.primary.provider),
        updatedAt: settings.providerKeys[settings.primary.provider].updatedAt
      }
    },
    fallback:
      settings.fallback === null
        ? null
        : {
            provider: settings.fallback.provider,
            model: settings.fallback.model,
            credentialRef: {
              ...buildCredentialRef(settings.fallback.provider),
              updatedAt: settings.providerKeys[settings.fallback.provider].updatedAt
            }
          },
    notes: [
      "Global runtime provider settings are active for the native OpenClaw apply/chat path.",
      "PersAI stores provider/model choice plus encrypted global keys; OpenClaw remains the runtime secret resolver."
    ]
  };
}
