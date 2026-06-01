import {
  RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA,
  CHAT_ROUTING_PROVIDERS,
  DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
  MANAGED_CATALOG_PROVIDERS,
  RUNTIME_PROVIDER_BILLING_MODES,
  RUNTIME_PROVIDER_MODEL_CAPABILITIES,
  RUNTIME_PROVIDER_PROFILE_SCHEMA,
  RUNTIME_PROVIDER_TIME_PRICE_UNITS,
  type ChatRoutingRuntimeProvider,
  type ManagedRuntimeCatalogProvider,
  createDefaultRuntimeProviderPriceMetadata,
  type ManagedRuntimeProvider,
  type RuntimeProviderAvailableModelsByProvider,
  type RuntimeProviderBillingMode,
  type RuntimeProviderModelCapability,
  type RuntimeProviderModelCatalogByProvider,
  type RuntimeProviderModelProfile,
  type RuntimeProviderPriceMetadata,
  type RuntimeProviderTextCharsMeteredPriceConfig,
  type RuntimeProviderTokenMeteredPriceConfig,
  type RuntimeProviderTimeMeteredPriceConfig,
  type RuntimeProviderFixedOperationPriceConfig,
  type RuntimeProviderTieredOperationPriceConfig,
  type RuntimeProviderTierPriceMetadata,
  type RuntimeProviderCredentialRefState,
  type RuntimeProviderProfileState
} from "./runtime-provider-profile";
import { applyDerivedTokenMeteredWeights } from "@persai/types";
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

const MAX_MODEL_LENGTH = 256;
const MAX_MODELS_PER_PROVIDER = 64;
const MAX_PROVIDER_KEY_LENGTH = 512;
const MAX_ROUTER_OVERRIDE_ITEMS = 32;
const MAX_ROUTER_OVERRIDE_ENTRY_LENGTH = 128;
const MAX_MODEL_DISPLAY_LABEL_LENGTH = 128;
const MAX_MODEL_NOTES_LENGTH = 512;
const MAX_TOKEN_WEIGHT = 1_000_000;
const MAX_PRICE_LABEL_LENGTH = 128;
const MAX_TIER_COUNT = 16;

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
  analyzeUploadsOnB2cUpload: boolean;
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
    analyzeUploadsOnB2cUpload: false,
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
    anthropic: { models: [] },
    runway: { models: [] },
    kling: { models: [] }
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
  throw new Error(`${path} must be one of: ${CHAT_ROUTING_PROVIDERS.join(", ")}.`);
}

function isChatRoutingProvider(provider: string): provider is ChatRoutingRuntimeProvider {
  return CHAT_ROUTING_PROVIDERS.includes(provider as ChatRoutingRuntimeProvider);
}

function isVideoOnlyCatalogProvider(provider: ManagedRuntimeCatalogProvider): boolean {
  return provider === "runway" || provider === "kling";
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
      anthropic: { models: createDefaultModelProfiles(chatFallback.anthropic, ["chat"]) },
      runway: { models: [] },
      kling: { models: [] }
    };
  }
  const normalizeProviderCatalog = (
    provider: ManagedRuntimeCatalogProvider
  ): RuntimeProviderModelCatalogByProvider[ManagedRuntimeCatalogProvider] => {
    const providerRow = asObject(row[provider]);
    if (providerRow === null) {
      return {
        models: isChatRoutingProvider(provider)
          ? createDefaultModelProfiles(chatFallback[provider], ["chat"])
          : []
      };
    }
    if (Array.isArray(providerRow.models)) {
      const profiles = normalizeModelProfiles(
        provider,
        providerRow.models,
        `${path}.${provider}.models`
      );
      if (
        isChatRoutingProvider(provider) &&
        !profiles.some((profile) => profile.capabilities.includes("chat"))
      ) {
        profiles.push(...createDefaultModelProfiles(chatFallback[provider], ["chat"]));
      }
      return { models: profiles };
    }
    return {
      models: normalizeLegacyCapabilityCatalog(
        provider,
        providerRow,
        isChatRoutingProvider(provider) ? chatFallback[provider] : [],
        `${path}.${provider}`
      )
    };
  };
  return {
    openai: normalizeProviderCatalog("openai"),
    anthropic: normalizeProviderCatalog("anthropic"),
    runway: normalizeProviderCatalog("runway"),
    kling: normalizeProviderCatalog("kling")
  };
}

function deriveAvailableModelsFromProfileCatalog(
  catalog: RuntimeProviderModelCatalogByProvider
): RuntimeProviderAvailableModelsByProvider {
  const collectActiveChatModels = (profiles: RuntimeProviderModelProfile[]): string[] => {
    const deduped = new Set<string>();
    for (const profile of profiles) {
      if (!profile.active || !profile.capabilities.includes("chat")) {
        continue;
      }
      deduped.add(profile.model);
    }
    return Array.from(deduped);
  };
  return {
    openai: collectActiveChatModels(catalog.openai.models),
    anthropic: collectActiveChatModels(catalog.anthropic.models)
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
      throw new Error(
        `${path}[${String(index)}] must be one of: ${RUNTIME_PROVIDER_MODEL_CAPABILITIES.join(", ")}.`
      );
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

function normalizeIsoDateTimeOrNull(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = asNonEmptyString(value);
  if (normalized === null) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${path} must be a valid ISO date-time when provided.`);
  }
  return parsed.toISOString();
}

function normalizeBillingMode(value: unknown, path: string): RuntimeProviderBillingMode {
  if (
    value === "token_metered" ||
    value === "time_metered" ||
    value === "text_chars_metered" ||
    value === "fixed_operation" ||
    value === "tiered_operation"
  ) {
    return value;
  }
  throw new Error(`${path} must be one of: ${RUNTIME_PROVIDER_BILLING_MODES.join(", ")}.`);
}

function normalizeCurrencyCode(value: unknown, path: string): string {
  const normalized = asNonEmptyString(value)?.toUpperCase() ?? "USD";
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`${path} must be a 3-letter currency code.`);
  }
  return normalized;
}

function normalizePriceNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative number.`);
  }
  return value;
}

function normalizeTimePriceUnit(
  value: unknown,
  path: string
): (typeof RUNTIME_PROVIDER_TIME_PRICE_UNITS)[number] {
  if (value === "second" || value === "minute") {
    return value;
  }
  throw new Error(`${path} must be one of: ${RUNTIME_PROVIDER_TIME_PRICE_UNITS.join(", ")}.`);
}

function normalizeTieredPriceEntries(
  value: unknown,
  path: string
): RuntimeProviderTierPriceMetadata[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }
  if (value.length > MAX_TIER_COUNT) {
    throw new Error(`${path} must contain at most ${String(MAX_TIER_COUNT)} tiers.`);
  }
  return value.map((entry, index) => {
    const row = asObject(entry);
    const entryPath = `${path}[${String(index)}]`;
    if (row === null) {
      throw new Error(`${entryPath} must be an object.`);
    }
    const label = normalizeOptionalBoundedString(
      row.label,
      `${entryPath}.label`,
      MAX_PRICE_LABEL_LENGTH
    );
    if (label === null) {
      throw new Error(`${entryPath}.label is required.`);
    }
    return {
      label,
      matchValue: normalizeOptionalBoundedString(
        row.matchValue,
        `${entryPath}.matchValue`,
        MAX_PRICE_LABEL_LENGTH
      ),
      price: normalizePriceNumber(row.price, `${entryPath}.price`)
    };
  });
}

function hasNonNullValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function assertNoConflictingPriceMetadataBranches(
  row: Record<string, unknown>,
  path: string,
  billingMode: RuntimeProviderBillingMode
): void {
  const branchPaths: Record<RuntimeProviderBillingMode, string[]> = {
    token_metered: [
      "timePricing",
      "textCharsPricing",
      "fixedOperationPricing",
      "tieredOperationPricing"
    ],
    time_metered: [
      "tokenPricing",
      "textCharsPricing",
      "fixedOperationPricing",
      "tieredOperationPricing"
    ],
    text_chars_metered: [
      "tokenPricing",
      "timePricing",
      "fixedOperationPricing",
      "tieredOperationPricing"
    ],
    fixed_operation: ["tokenPricing", "timePricing", "textCharsPricing", "tieredOperationPricing"],
    tiered_operation: ["tokenPricing", "timePricing", "textCharsPricing", "fixedOperationPricing"]
  };
  for (const branchKey of branchPaths[billingMode]) {
    if (hasNonNullValue(row[branchKey])) {
      throw new Error(`${path}.${branchKey} is not allowed when billingMode is ${billingMode}.`);
    }
  }
}

function normalizeProviderPriceMetadata(
  value: unknown,
  path: string,
  billingMode: "token_metered"
): RuntimeProviderTokenMeteredPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  path: string,
  billingMode: "time_metered"
): RuntimeProviderTimeMeteredPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  path: string,
  billingMode: "text_chars_metered"
): RuntimeProviderTextCharsMeteredPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  path: string,
  billingMode: "fixed_operation"
): RuntimeProviderFixedOperationPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  path: string,
  billingMode: "tiered_operation"
): RuntimeProviderTieredOperationPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  path: string,
  billingMode: RuntimeProviderBillingMode
): RuntimeProviderPriceMetadata {
  const row = asObject(value ?? null);
  if (row === null) {
    return createDefaultRuntimeProviderPriceMetadata(billingMode);
  }
  assertNoConflictingPriceMetadataBranches(row, path, billingMode);
  const currency = normalizeCurrencyCode(row.currency, `${path}.currency`);

  switch (billingMode) {
    case "token_metered": {
      const defaults = createDefaultRuntimeProviderPriceMetadata("token_metered");
      const tokenPricingRow = asObject(row.tokenPricing);
      return {
        currency,
        tokenPricing:
          tokenPricingRow === null
            ? defaults.tokenPricing
            : {
                inputPer1M: normalizePriceNumber(
                  tokenPricingRow.inputPer1M,
                  `${path}.tokenPricing.inputPer1M`
                ),
                cachedInputPer1M: normalizePriceNumber(
                  tokenPricingRow.cachedInputPer1M,
                  `${path}.tokenPricing.cachedInputPer1M`
                ),
                outputPer1M: normalizePriceNumber(
                  tokenPricingRow.outputPer1M,
                  `${path}.tokenPricing.outputPer1M`
                )
              }
      };
    }
    case "time_metered": {
      const defaults = createDefaultRuntimeProviderPriceMetadata("time_metered");
      const timePricingRow = asObject(row.timePricing);
      return {
        currency,
        timePricing:
          timePricingRow === null
            ? defaults.timePricing
            : {
                unit: normalizeTimePriceUnit(timePricingRow.unit, `${path}.timePricing.unit`),
                pricePerUnit: normalizePriceNumber(
                  timePricingRow.pricePerUnit,
                  `${path}.timePricing.pricePerUnit`
                )
              }
      };
    }
    case "text_chars_metered": {
      const defaults = createDefaultRuntimeProviderPriceMetadata("text_chars_metered");
      const textCharsPricingRow = asObject(row.textCharsPricing);
      return {
        currency,
        textCharsPricing:
          textCharsPricingRow === null
            ? defaults.textCharsPricing
            : {
                pricePer1MChars: normalizePriceNumber(
                  textCharsPricingRow.pricePer1MChars,
                  `${path}.textCharsPricing.pricePer1MChars`
                )
              }
      };
    }
    case "fixed_operation": {
      const defaults = createDefaultRuntimeProviderPriceMetadata("fixed_operation");
      const fixedOperationPricingRow = asObject(row.fixedOperationPricing);
      return {
        currency,
        fixedOperationPricing:
          fixedOperationPricingRow === null
            ? defaults.fixedOperationPricing
            : {
                unitLabel: normalizeOptionalBoundedString(
                  fixedOperationPricingRow.unitLabel,
                  `${path}.fixedOperationPricing.unitLabel`,
                  MAX_PRICE_LABEL_LENGTH
                ),
                pricePerOperation: normalizePriceNumber(
                  fixedOperationPricingRow.pricePerOperation,
                  `${path}.fixedOperationPricing.pricePerOperation`
                )
              }
      };
    }
    case "tiered_operation": {
      const defaults = createDefaultRuntimeProviderPriceMetadata("tiered_operation");
      const tieredOperationPricingRow = asObject(row.tieredOperationPricing);
      return {
        currency,
        tieredOperationPricing:
          tieredOperationPricingRow === null
            ? defaults.tieredOperationPricing
            : {
                unitLabel: normalizeOptionalBoundedString(
                  tieredOperationPricingRow.unitLabel,
                  `${path}.tieredOperationPricing.unitLabel`,
                  MAX_PRICE_LABEL_LENGTH
                ),
                tiers: normalizeTieredPriceEntries(
                  tieredOperationPricingRow.tiers,
                  `${path}.tieredOperationPricing.tiers`
                )
              }
      };
    }
  }
}

function normalizeModelProfiles(
  provider: ManagedRuntimeCatalogProvider,
  value: unknown[],
  path: string
): RuntimeProviderModelProfile[] {
  const result: RuntimeProviderModelProfile[] = [];
  const activeModels = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const row = asObject(entry);
    const entryPath = `${path}[${String(index)}]`;
    if (row === null) {
      throw new Error(`${entryPath} must be an object.`);
    }
    const model = normalizeModel(row.model ?? row.modelKey, `${entryPath}.model`);
    const active =
      row.active === undefined ? true : normalizeBoolean(row.active, `${entryPath}.active`);
    if (active && activeModels.has(model)) {
      throw new Error(
        `${entryPath}.model duplicates another active profile for the same provider model.`
      );
    }
    if (active) {
      activeModels.add(model);
    }
    const capabilities = normalizeCapabilityList(row.capabilities, `${entryPath}.capabilities`);
    if (
      isVideoOnlyCatalogProvider(provider) &&
      capabilities.some((capability) => capability !== "video")
    ) {
      throw new Error(
        `${entryPath}.capabilities must contain only "video" for ${provider} catalog rows.`
      );
    }
    const billingMode =
      row.billingMode === undefined
        ? defaultBillingModeForCapabilities(capabilities)
        : normalizeBillingMode(row.billingMode, `${entryPath}.billingMode`);
    const effectiveFrom = normalizeIsoDateTimeOrNull(
      row.effectiveFrom,
      `${entryPath}.effectiveFrom`
    );
    const effectiveTo = normalizeIsoDateTimeOrNull(row.effectiveTo, `${entryPath}.effectiveTo`);
    if (
      effectiveFrom !== null &&
      effectiveTo !== null &&
      new Date(effectiveTo).getTime() < new Date(effectiveFrom).getTime()
    ) {
      throw new Error(`${entryPath}.effectiveTo must be greater than or equal to effectiveFrom.`);
    }
    const base = {
      model,
      capabilities,
      active,
      effectiveFrom,
      effectiveTo,
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
      notes: normalizeOptionalBoundedString(row.notes, `${entryPath}.notes`, MAX_MODEL_NOTES_LENGTH)
    };
    switch (billingMode) {
      case "token_metered":
        result.push({
          ...base,
          billingMode,
          providerPriceMetadata: normalizeProviderPriceMetadata(
            row.providerPriceMetadata,
            `${entryPath}.providerPriceMetadata`,
            "token_metered"
          )
        });
        break;
      case "time_metered":
        result.push({
          ...base,
          billingMode,
          providerPriceMetadata: normalizeProviderPriceMetadata(
            row.providerPriceMetadata,
            `${entryPath}.providerPriceMetadata`,
            "time_metered"
          )
        });
        break;
      case "text_chars_metered":
        result.push({
          ...base,
          billingMode,
          providerPriceMetadata: normalizeProviderPriceMetadata(
            row.providerPriceMetadata,
            `${entryPath}.providerPriceMetadata`,
            "text_chars_metered"
          )
        });
        break;
      case "fixed_operation":
        result.push({
          ...base,
          billingMode,
          providerPriceMetadata: normalizeProviderPriceMetadata(
            row.providerPriceMetadata,
            `${entryPath}.providerPriceMetadata`,
            "fixed_operation"
          )
        });
        break;
      case "tiered_operation":
        result.push({
          ...base,
          billingMode,
          providerPriceMetadata: normalizeProviderPriceMetadata(
            row.providerPriceMetadata,
            `${entryPath}.providerPriceMetadata`,
            "tiered_operation"
          )
        });
        break;
    }
    if (result.length > MAX_MODELS_PER_PROVIDER) {
      throw new Error(`${path} must contain at most ${String(MAX_MODELS_PER_PROVIDER)} models.`);
    }
  }
  return result.map((profile) => applyDerivedTokenMeteredWeights(profile));
}

function defaultBillingModeForCapabilities(
  capabilities: RuntimeProviderModelCapability[]
): RuntimeProviderBillingMode {
  if (capabilities.includes("chat") || capabilities.includes("image")) {
    return "token_metered";
  }
  if (capabilities.includes("video") || capabilities.includes("speech_to_text")) {
    return "time_metered";
  }
  if (capabilities.includes("text_to_speech")) {
    return "text_chars_metered";
  }
  if (capabilities.includes("ocr_or_document_parsing")) {
    return "fixed_operation";
  }
  return "token_metered";
}

function createDefaultModelProfiles(
  models: string[],
  capabilities: RuntimeProviderModelCapability[]
): RuntimeProviderModelProfile[] {
  const billingMode = defaultBillingModeForCapabilities(capabilities);
  return models.map((model) => {
    const base = {
      model,
      capabilities,
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      displayLabel: null,
      notes: null
    };
    if (billingMode === "token_metered") {
      return {
        ...base,
        billingMode,
        providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("token_metered")
      };
    }
    if (billingMode === "time_metered") {
      return {
        ...base,
        billingMode,
        providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("time_metered")
      };
    }
    if (billingMode === "text_chars_metered") {
      return {
        ...base,
        billingMode,
        providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("text_chars_metered")
      };
    }
    return {
      ...base,
      billingMode: "fixed_operation",
      providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("fixed_operation")
    };
  });
}

function normalizeLegacyCapabilityCatalog(
  provider: ManagedRuntimeCatalogProvider,
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
  const image = normalizeAvailableModelList(providerRow.image ?? [], `${path}.image`);
  if (isVideoOnlyCatalogProvider(provider) && (chat.length > 0 || image.length > 0)) {
    throw new Error(`${path} legacy catalog rows must not include chat or image models.`);
  }
  if (isChatRoutingProvider(provider)) {
    append(chat.length > 0 ? chat : chatFallback, "chat");
  }
  append(image, "image");
  append(normalizeAvailableModelList(providerRow.video ?? [], `${path}.video`), "video");
  return Array.from(byModel.entries()).map(([model, capabilities]) => {
    const capabilityList = Array.from(capabilities);
    const billingMode = defaultBillingModeForCapabilities(capabilityList);
    const base = {
      model,
      capabilities: capabilityList,
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      displayLabel: null,
      notes: null
    };
    if (billingMode === "token_metered") {
      return {
        ...base,
        billingMode,
        providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("token_metered")
      };
    }
    if (billingMode === "time_metered") {
      return {
        ...base,
        billingMode,
        providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("time_metered")
      };
    }
    if (billingMode === "text_chars_metered") {
      return {
        ...base,
        billingMode,
        providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("text_chars_metered")
      };
    }
    return {
      ...base,
      billingMode: "fixed_operation",
      providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata("fixed_operation")
    };
  });
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
    analyzeUploadsOnB2cUpload: normalizeBoolean(
      row.analyzeUploadsOnB2cUpload ?? false,
      `${path}.analyzeUploadsOnB2cUpload`
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
      allowedProviders: [...CHAT_ROUTING_PROVIDERS],
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
    allowedProviders: [...CHAT_ROUTING_PROVIDERS],
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
