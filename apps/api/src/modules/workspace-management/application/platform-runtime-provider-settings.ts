import {
  RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA,
  RUNTIME_PROVIDER_PROFILE_SCHEMA,
  type ManagedRuntimeProvider,
  type RuntimeProviderAvailableModelsByProvider,
  type RuntimeProviderCredentialRefState,
  type RuntimeProviderProfileState
} from "./runtime-provider-profile";
import { normalizeModelKey, toNormalizedNonEmptyModelKey } from "./model-key-normalization";

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
const MAX_ROUTER_OVERRIDE_ITEMS = 32;
const MAX_ROUTER_OVERRIDE_ENTRY_LENGTH = 128;

export type PlatformRuntimeProviderSelection = {
  provider: ManagedRuntimeProvider;
  model: string;
};

export type PlatformRuntimeProviderKeyMetadata = {
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
};

export type PlatformRuntimeRoutingMode = "shadow" | "active";
export type PlatformRuntimeRoutingExecutionMode = "normal" | "premium" | "reasoning";

export type PlatformRuntimeRouterPrecheckRuleOverrides = {
  continueTerms: string[];
  retrievalTerms: string[];
  reasoningTerms: string[];
  premiumTerms: string[];
  toolTerms: string[];
};

export type PlatformRuntimeRouterPolicy = {
  enabled: boolean;
  mode: PlatformRuntimeRoutingMode;
  classifierFailureFallbackMode: PlatformRuntimeRoutingExecutionMode;
  clarifyOnMissingContext: boolean;
  precheckRuleOverrides: PlatformRuntimeRouterPrecheckRuleOverrides | null;
};

export function createDefaultPlatformRuntimeRouterPolicy(): PlatformRuntimeRouterPolicy {
  return {
    enabled: false,
    mode: "shadow",
    classifierFailureFallbackMode: "normal",
    clarifyOnMissingContext: true,
    precheckRuleOverrides: null
  };
}

export type PlatformRuntimeProviderSettingsState = {
  schema: typeof PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA;
  mode: "unconfigured_default" | "global_settings";
  primary: PlatformRuntimeProviderSelection | null;
  fallback: PlatformRuntimeProviderSelection | null;
  routingFastModelKey: string | null;
  routerPolicy: PlatformRuntimeRouterPolicy;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  providerKeys: Record<ManagedRuntimeProvider, PlatformRuntimeProviderKeyMetadata>;
  notes: string[];
};

export type PlatformRuntimeProviderSettingsRecord = {
  primaryProvider: ManagedRuntimeProvider;
  primaryModel: string;
  fallbackProvider: ManagedRuntimeProvider | null;
  fallbackModel: string | null;
  routingFastModelKey: string | null;
  routerPolicy: unknown;
  availableModelsByProvider: unknown;
};

export type UpdatePlatformRuntimeProviderSettingsInput = {
  primary: PlatformRuntimeProviderSelection;
  fallback: PlatformRuntimeProviderSelection | null;
  routingFastModelKey: string | null;
  routerPolicy: PlatformRuntimeRouterPolicy;
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
  const normalized = toNormalizedNonEmptyModelKey(value);
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

function assertSelectionInCatalog(params: {
  selection: PlatformRuntimeProviderSelection | null;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  path: string;
}): void {
  if (params.selection === null) {
    return;
  }
  if (
    !params.availableModelsByProvider[params.selection.provider].includes(params.selection.model)
  ) {
    const providerLabel = params.selection.provider === "openai" ? "OpenAI" : "Anthropic";
    throw new Error(
      `${params.path}.model must be listed in availableModelsByProvider.${params.selection.provider} for ${providerLabel}.`
    );
  }
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

function normalizeRoutingExecutionMode(
  value: unknown,
  path: string
): PlatformRuntimeRoutingExecutionMode {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === "normal" || normalized === "premium" || normalized === "reasoning") {
    return normalized;
  }
  throw new Error(`${path} must be one of: normal, premium, reasoning.`);
}

function normalizeRoutingMode(value: unknown, path: string): PlatformRuntimeRoutingMode {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === "shadow" || normalized === "active") {
    return normalized;
  }
  throw new Error(`${path} must be one of: shadow, active.`);
}

function normalizeBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

function normalizeRouterOverrideList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of strings.`);
  }
  if (value.length > MAX_ROUTER_OVERRIDE_ITEMS) {
    throw new Error(`${path} must contain at most ${String(MAX_ROUTER_OVERRIDE_ITEMS)} entries.`);
  }
  const deduped = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const normalized = asNonEmptyString(entry);
    if (normalized === null) {
      throw new Error(`${path}[${String(index)}] must be a non-empty string.`);
    }
    if (normalized.length > MAX_ROUTER_OVERRIDE_ENTRY_LENGTH) {
      throw new Error(
        `${path}[${String(index)}] must be at most ${String(MAX_ROUTER_OVERRIDE_ENTRY_LENGTH)} characters.`
      );
    }
    if (containsControlCharacters(normalized)) {
      throw new Error(`${path}[${String(index)}] contains invalid control characters.`);
    }
    deduped.add(normalized.toLowerCase());
  }
  return Array.from(deduped);
}

function normalizeRouterPrecheckRuleOverrides(
  value: unknown,
  path: string
): PlatformRuntimeRouterPrecheckRuleOverrides | null {
  if (value === undefined || value === null) {
    return null;
  }
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object when provided.`);
  }
  return {
    continueTerms: Array.isArray(row.continueTerms)
      ? normalizeRouterOverrideList(row.continueTerms, `${path}.continueTerms`)
      : [],
    retrievalTerms: Array.isArray(row.retrievalTerms)
      ? normalizeRouterOverrideList(row.retrievalTerms, `${path}.retrievalTerms`)
      : [],
    reasoningTerms: Array.isArray(row.reasoningTerms)
      ? normalizeRouterOverrideList(row.reasoningTerms, `${path}.reasoningTerms`)
      : [],
    premiumTerms: Array.isArray(row.premiumTerms)
      ? normalizeRouterOverrideList(row.premiumTerms, `${path}.premiumTerms`)
      : [],
    toolTerms: Array.isArray(row.toolTerms)
      ? normalizeRouterOverrideList(row.toolTerms, `${path}.toolTerms`)
      : []
  };
}

function normalizeRouterPolicy(value: unknown, path = "routerPolicy"): PlatformRuntimeRouterPolicy {
  const row = asObject(value);
  if (row === null) {
    return createDefaultPlatformRuntimeRouterPolicy();
  }
  return {
    enabled: normalizeBoolean(row.enabled ?? false, `${path}.enabled`),
    mode: normalizeRoutingMode(row.mode ?? "shadow", `${path}.mode`),
    classifierFailureFallbackMode: normalizeRoutingExecutionMode(
      row.classifierFailureFallbackMode ?? "normal",
      `${path}.classifierFailureFallbackMode`
    ),
    clarifyOnMissingContext: normalizeBoolean(
      row.clarifyOnMissingContext ?? true,
      `${path}.clarifyOnMissingContext`
    ),
    precheckRuleOverrides: normalizeRouterPrecheckRuleOverrides(
      row.precheckRuleOverrides ?? null,
      `${path}.precheckRuleOverrides`
    )
  };
}

function normalizeOptionalModel(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeModel(value, path);
}

function assertOptionalModelInCatalog(params: {
  model: string | null;
  provider: ManagedRuntimeProvider;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  path: string;
}): void {
  if (params.model === null) {
    return;
  }
  if (!params.availableModelsByProvider[params.provider].includes(params.model)) {
    throw new Error(
      `${params.path} must be listed in availableModelsByProvider.${params.provider}.`
    );
  }
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
  const availableModelsByProvider = normalizeAvailableModelsByProvider(
    row.availableModelsByProvider
  );
  assertSelectionInCatalog({
    selection: primary,
    availableModelsByProvider,
    path: "primary"
  });
  assertSelectionInCatalog({
    selection: fallback,
    availableModelsByProvider,
    path: "fallback"
  });
  const routingFastModelKey = normalizeOptionalModel(
    row.routingFastModelKey,
    "routingFastModelKey"
  );
  assertOptionalModelInCatalog({
    model: routingFastModelKey,
    provider: primary.provider,
    availableModelsByProvider,
    path: "routingFastModelKey"
  });
  const routerPolicy = normalizeRouterPolicy(row.routerPolicy);
  if (routerPolicy.enabled && routingFastModelKey === null) {
    throw new Error("routingFastModelKey is required when routerPolicy.enabled is true.");
  }
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
    routingFastModelKey,
    routerPolicy,
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
      mode: "unconfigured_default",
      primary: null,
      fallback: null,
      routingFastModelKey: null,
      routerPolicy: createDefaultPlatformRuntimeRouterPolicy(),
      availableModelsByProvider: createEmptyAvailableModelsByProvider(),
      providerKeys: params.providerKeys,
      notes: [
        "Global runtime provider settings are not configured yet.",
        "The active runtime keeps its existing configured default model path until global settings are saved.",
        "Early smart routing stays disabled until global runtime settings are configured."
      ]
    };
  }

  const primary = {
    provider: params.settings.primaryProvider,
    model: normalizeModelKey(params.settings.primaryModel)
  } satisfies PlatformRuntimeProviderSelection;
  const fallback =
    params.settings.fallbackProvider !== null && params.settings.fallbackModel !== null
      ? {
          provider: params.settings.fallbackProvider,
          model: normalizeModelKey(params.settings.fallbackModel)
        }
      : null;
  const availableModelsByProvider = normalizeAvailableModelsByProvider(
    params.settings.availableModelsByProvider
  );
  const routingFastModelKey = normalizeOptionalModel(
    params.settings.routingFastModelKey,
    "routingFastModelKey"
  );
  const routerPolicy = normalizeRouterPolicy(params.settings.routerPolicy);

  return {
    schema: PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA,
    mode: "global_settings",
    primary,
    fallback,
    routingFastModelKey,
    routerPolicy,
    availableModelsByProvider,
    providerKeys: params.providerKeys,
    notes: [
      "Provider keys are managed as one global platform setting for all assistants.",
      "Raw provider keys are write-only in the admin UI and stay in encrypted PersAI storage.",
      routerPolicy.enabled
        ? `Early smart routing is enabled in ${routerPolicy.mode} mode.`
        : "Early smart routing is currently disabled.",
      routingFastModelKey === null
        ? "No dedicated fast routing model is configured yet."
        : `Fast routing model: ${routingFastModelKey}.`
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
      mode: "unconfigured_default",
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
        "The active runtime keeps its configured default model path until global settings are saved."
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
      "Global runtime provider settings are active on the native runtime path.",
      "PersAI stores provider/model choice plus encrypted global keys in its own control plane."
    ]
  };
}
