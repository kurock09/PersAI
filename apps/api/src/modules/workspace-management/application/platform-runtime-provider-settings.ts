import {
  RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA,
  DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
  RUNTIME_PROVIDER_MODEL_CAPABILITIES,
  RUNTIME_PROVIDER_PROFILE_SCHEMA,
  type ManagedRuntimeProvider,
  type RuntimeProviderAvailableModelsByProvider,
  type RuntimeProviderModelCapability,
  type RuntimeProviderModelCatalogByProvider,
  type RuntimeProviderModelProfile,
  type RuntimeProviderCredentialRefState,
  type RuntimeProviderProfileState
} from "./runtime-provider-profile";
import { normalizeModelKey, toNormalizedNonEmptyModelKey } from "./model-key-normalization";

export const PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID = "global";
export const PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA = "persai.adminRuntimeProviderSettings.v2";
export const PERSAI_RUNTIME_SECRET_PROVIDER_ALIAS = "persai-runtime";
export const DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX = 3;
export const DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES = 5;

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
const MAX_MODEL_DISPLAY_LABEL_LENGTH = 128;
const MAX_MODEL_NOTES_LENGTH = 512;
const MAX_TOKEN_WEIGHT = 1_000_000;

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
  productPriorityTerms: string[];
  webPriorityTerms: string[];
  personalPriorityTerms: string[];
};

export type PlatformRuntimeRouterPolicy = {
  enabled: boolean;
  mode: PlatformRuntimeRoutingMode;
  classifierFailureFallbackMode: PlatformRuntimeRoutingExecutionMode;
  clarifyOnMissingContext: boolean;
  precheckRuleOverrides: PlatformRuntimeRouterPrecheckRuleOverrides | null;
};

export type PlatformRuntimeSkillRoutingPolicy = {
  initialCheckUserMessageIndex: number;
  backgroundRecheckIntervalMessages: number;
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
  skillRoutingPolicy: PlatformRuntimeSkillRoutingPolicy;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  availableModelCatalogByProvider: RuntimeProviderModelCatalogByProvider;
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
  availableModelCatalogByProvider: unknown;
};

export type UpdatePlatformRuntimeProviderSettingsInput = {
  primary: PlatformRuntimeProviderSelection;
  fallback: PlatformRuntimeProviderSelection | null;
  routingFastModelKey: string | null;
  routerPolicy: PlatformRuntimeRouterPolicy;
  skillRoutingPolicy: PlatformRuntimeSkillRoutingPolicy;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  availableModelCatalogByProvider: RuntimeProviderModelCatalogByProvider;
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

export function createEmptyAvailableModelCatalogByProvider(): RuntimeProviderModelCatalogByProvider {
  return {
    openai: { models: [] },
    anthropic: { models: [] }
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

function normalizePositiveIntegerInRange(
  value: unknown,
  path: string,
  bounds: { min: number; max: number }
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${path} must be an integer.`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new Error(`${path} must be between ${String(bounds.min)} and ${String(bounds.max)}.`);
  }
  return value;
}

function createDefaultPlatformRuntimeSkillRoutingPolicy(): PlatformRuntimeSkillRoutingPolicy {
  return {
    initialCheckUserMessageIndex: DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX,
    backgroundRecheckIntervalMessages: DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES
  };
}

function normalizeSkillRoutingPolicy(
  value: unknown,
  path = "skillRoutingPolicy"
): PlatformRuntimeSkillRoutingPolicy {
  const row = asObject(value);
  if (row === null) {
    return createDefaultPlatformRuntimeSkillRoutingPolicy();
  }
  return {
    initialCheckUserMessageIndex: normalizePositiveIntegerInRange(
      row.initialCheckUserMessageIndex ?? DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX,
      `${path}.initialCheckUserMessageIndex`,
      { min: 1, max: 20 }
    ),
    backgroundRecheckIntervalMessages: normalizePositiveIntegerInRange(
      row.backgroundRecheckIntervalMessages ??
        DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES,
      `${path}.backgroundRecheckIntervalMessages`,
      { min: 1, max: 50 }
    )
  };
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

export function normalizeAvailableModelCatalogByProvider(
  value: unknown,
  chatFallback: RuntimeProviderAvailableModelsByProvider,
  path = "availableModelCatalogByProvider"
): RuntimeProviderModelCatalogByProvider {
  const row = asObject(value);
  if (row === null) {
    return {
      openai: { models: createDefaultModelProfiles(chatFallback.openai, ["chat"]) },
      anthropic: { models: createDefaultModelProfiles(chatFallback.anthropic, ["chat"]) }
    };
  }
  const normalizeProviderCatalog = (
    provider: ManagedRuntimeProvider
  ): RuntimeProviderModelCatalogByProvider[ManagedRuntimeProvider] => {
    const providerRow = asObject(row[provider]);
    if (providerRow === null) {
      return {
        models: createDefaultModelProfiles(chatFallback[provider], ["chat"])
      };
    }
    if (Array.isArray(providerRow.models)) {
      const profiles = normalizeModelProfiles(providerRow.models, `${path}.${provider}.models`);
      if (!profiles.some((profile) => profile.capabilities.includes("chat"))) {
        profiles.push(...createDefaultModelProfiles(chatFallback[provider], ["chat"]));
      }
      return { models: profiles };
    }
    return {
      models: normalizeLegacyCapabilityCatalog(
        providerRow,
        chatFallback[provider],
        `${path}.${provider}`
      )
    };
  };
  return {
    openai: normalizeProviderCatalog("openai"),
    anthropic: normalizeProviderCatalog("anthropic")
  };
}

function deriveAvailableModelsFromProfileCatalog(
  catalog: RuntimeProviderModelCatalogByProvider
): RuntimeProviderAvailableModelsByProvider {
  return {
    openai: catalog.openai.models
      .filter((profile) => profile.capabilities.includes("chat"))
      .map((profile) => profile.model),
    anthropic: catalog.anthropic.models
      .filter((profile) => profile.capabilities.includes("chat"))
      .map((profile) => profile.model)
  };
}

function isCapability(value: unknown): value is RuntimeProviderModelCapability {
  return RUNTIME_PROVIDER_MODEL_CAPABILITIES.includes(value as RuntimeProviderModelCapability);
}

function normalizeCapabilityList(value: unknown, path: string): RuntimeProviderModelCapability[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of model capabilities.`);
  }
  const deduped = new Set<RuntimeProviderModelCapability>();
  for (const [index, entry] of value.entries()) {
    if (!isCapability(entry)) {
      throw new Error(`${path}[${String(index)}] must be one of: chat, image, video.`);
    }
    deduped.add(entry);
  }
  if (deduped.size === 0) {
    throw new Error(`${path} must include at least one capability.`);
  }
  return Array.from(deduped);
}

function normalizeTokenWeight(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  if (value < 0 || value > MAX_TOKEN_WEIGHT) {
    throw new Error(`${path} must be between 0 and ${String(MAX_TOKEN_WEIGHT)}.`);
  }
  return value;
}

function normalizeOptionalBoundedString(
  value: unknown,
  path: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = asNonEmptyString(value);
  if (normalized === null) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new Error(`${path} must be at most ${String(maxLength)} characters.`);
  }
  if (containsControlCharacters(normalized)) {
    throw new Error(`${path} contains invalid control characters.`);
  }
  return normalized;
}

function normalizeProviderPriceMetadata(
  value: unknown,
  path: string
): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object when provided.`);
  }
  return row;
}

function normalizeModelProfiles(value: unknown[], path: string): RuntimeProviderModelProfile[] {
  const result: RuntimeProviderModelProfile[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const row = asObject(entry);
    const entryPath = `${path}[${String(index)}]`;
    if (row === null) {
      throw new Error(`${entryPath} must be an object.`);
    }
    const model = normalizeModel(row.model ?? row.modelKey, `${entryPath}.model`);
    if (seen.has(model)) {
      throw new Error(`${entryPath}.model duplicates an earlier model profile.`);
    }
    seen.add(model);
    result.push({
      model,
      capabilities: normalizeCapabilityList(row.capabilities, `${entryPath}.capabilities`),
      inputTokenWeight: normalizeTokenWeight(row.inputTokenWeight, `${entryPath}.inputTokenWeight`),
      cachedInputTokenWeight: normalizeTokenWeight(
        row.cachedInputTokenWeight,
        `${entryPath}.cachedInputTokenWeight`
      ),
      outputTokenWeight: normalizeTokenWeight(
        row.outputTokenWeight,
        `${entryPath}.outputTokenWeight`
      ),
      displayLabel: normalizeOptionalBoundedString(
        row.displayLabel,
        `${entryPath}.displayLabel`,
        MAX_MODEL_DISPLAY_LABEL_LENGTH
      ),
      notes: normalizeOptionalBoundedString(
        row.notes,
        `${entryPath}.notes`,
        MAX_MODEL_NOTES_LENGTH
      ),
      providerPriceMetadata: normalizeProviderPriceMetadata(
        row.providerPriceMetadata,
        `${entryPath}.providerPriceMetadata`
      )
    });
    if (result.length > MAX_MODELS_PER_PROVIDER) {
      throw new Error(`${path} must contain at most ${String(MAX_MODELS_PER_PROVIDER)} models.`);
    }
  }
  return result;
}

function createDefaultModelProfiles(
  models: string[],
  capabilities: RuntimeProviderModelCapability[]
): RuntimeProviderModelProfile[] {
  return models.map((model) => ({
    model,
    capabilities,
    inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    displayLabel: null,
    notes: null,
    providerPriceMetadata: null
  }));
}

function normalizeLegacyCapabilityCatalog(
  providerRow: Record<string, unknown>,
  chatFallback: string[],
  path: string
): RuntimeProviderModelProfile[] {
  const byModel = new Map<string, Set<RuntimeProviderModelCapability>>();
  const append = (models: string[], capability: RuntimeProviderModelCapability) => {
    for (const model of models) {
      const capabilities = byModel.get(model) ?? new Set<RuntimeProviderModelCapability>();
      capabilities.add(capability);
      byModel.set(model, capabilities);
    }
  };
  const chat = normalizeAvailableModelList(providerRow.chat ?? chatFallback, `${path}.chat`);
  append(chat.length > 0 ? chat : chatFallback, "chat");
  append(normalizeAvailableModelList(providerRow.image ?? [], `${path}.image`), "image");
  append(normalizeAvailableModelList(providerRow.video ?? [], `${path}.video`), "video");
  return Array.from(byModel.entries()).map(([model, capabilities]) => ({
    model,
    capabilities: Array.from(capabilities),
    inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
    displayLabel: null,
    notes: null,
    providerPriceMetadata: null
  }));
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
      : [],
    productPriorityTerms: Array.isArray(row.productPriorityTerms)
      ? normalizeRouterOverrideList(row.productPriorityTerms, `${path}.productPriorityTerms`)
      : [],
    webPriorityTerms: Array.isArray(row.webPriorityTerms)
      ? normalizeRouterOverrideList(row.webPriorityTerms, `${path}.webPriorityTerms`)
      : [],
    personalPriorityTerms: Array.isArray(row.personalPriorityTerms)
      ? normalizeRouterOverrideList(row.personalPriorityTerms, `${path}.personalPriorityTerms`)
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
  const availableModelsFallback = normalizeAvailableModelsByProvider(row.availableModelsByProvider);
  const availableModelCatalogByProvider = normalizeAvailableModelCatalogByProvider(
    row.availableModelCatalogByProvider,
    availableModelsFallback
  );
  const availableModelsByProvider = deriveAvailableModelsFromProfileCatalog(
    availableModelCatalogByProvider
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
  const skillRoutingPolicy = normalizeSkillRoutingPolicy(row.skillRoutingPolicy);
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
    skillRoutingPolicy,
    availableModelsByProvider,
    availableModelCatalogByProvider,
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
      skillRoutingPolicy: createDefaultPlatformRuntimeSkillRoutingPolicy(),
      availableModelsByProvider: createEmptyAvailableModelsByProvider(),
      availableModelCatalogByProvider: createEmptyAvailableModelCatalogByProvider(),
      providerKeys: params.providerKeys,
      notes: [
        "Global runtime provider settings are not configured yet.",
        "The active runtime keeps its existing configured default model path until global settings are saved.",
        "Early smart routing stays disabled until global runtime settings are configured.",
        `Skill routing cadence defaults to first check after ${String(
          DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX
        )} user messages, then every ${String(
          DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES
        )} user messages.`
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
  const availableModelsFallback = normalizeAvailableModelsByProvider(
    params.settings.availableModelsByProvider
  );
  const availableModelCatalogByProvider = normalizeAvailableModelCatalogByProvider(
    params.settings.availableModelCatalogByProvider,
    availableModelsFallback
  );
  const availableModelsByProvider = deriveAvailableModelsFromProfileCatalog(
    availableModelCatalogByProvider
  );
  const routingFastModelKey = normalizeOptionalModel(
    params.settings.routingFastModelKey,
    "routingFastModelKey"
  );
  const routerPolicy = normalizeRouterPolicy(params.settings.routerPolicy);
  const routerPolicyRow = asObject(params.settings.routerPolicy);
  const skillRoutingPolicy = normalizeSkillRoutingPolicy(
    routerPolicyRow?.skillRoutingPolicy ?? null
  );

  return {
    schema: PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA,
    mode: "global_settings",
    primary,
    fallback,
    routingFastModelKey,
    routerPolicy,
    skillRoutingPolicy,
    availableModelsByProvider,
    availableModelCatalogByProvider,
    providerKeys: params.providerKeys,
    notes: [
      "Provider keys are managed as one global platform setting for all assistants.",
      "Raw provider keys are write-only in the admin UI and stay in encrypted PersAI storage.",
      routerPolicy.enabled
        ? `Early smart routing is enabled in ${routerPolicy.mode} mode.`
        : "Early smart routing is currently disabled.",
      `Skill routing first checks after ${String(
        skillRoutingPolicy.initialCheckUserMessageIndex
      )} user messages, then rechecks every ${String(
        skillRoutingPolicy.backgroundRecheckIntervalMessages
      )} user messages.`,
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
      availableModelCatalogByProvider: settings.availableModelCatalogByProvider,
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
    availableModelCatalogByProvider: settings.availableModelCatalogByProvider,
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
