export const RUNTIME_PROVIDER_PROFILE_SCHEMA = "persai.runtimeProviderProfile.v1";
export const RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA = "persai.runtimeProviderCredentialRefs.v1";
import { applyDerivedTokenMeteredWeights } from "@persai/types";
import {
  PERSAI_RUNTIME_VIDEO_ASPECT_RATIOS,
  PERSAI_RUNTIME_VIDEO_GENERATE_SIZES,
  type PersaiRuntimeVideoAspectRatio,
  type PersaiRuntimeVideoGenerateSize,
  RUNTIME_VIDEO_AUDIO_CAPABILITIES,
  RUNTIME_VIDEO_INPUT_CAPABILITIES,
  type RuntimeVideoAudioCapability,
  type RuntimeVideoAspectRatioOption,
  type RuntimeVideoDurationConstraint,
  type RuntimeVideoInputCapability,
  type RuntimeVideoModelParameters,
  type RuntimeVideoProviderParameters
} from "@persai/runtime-contract";
import { normalizeModelKey, toNormalizedNonEmptyModelKey } from "./model-key-normalization";

export const CHAT_ROUTING_PROVIDERS = ["openai", "anthropic"] as const;
export const MANAGED_CATALOG_PROVIDERS = [
  "openai",
  "anthropic",
  "runway",
  "kling",
  "heygen"
] as const;
export const VIDEO_GENERATE_PROVIDERS = ["openai", "runway", "kling", "heygen"] as const;

/**
 * ADR-122 D5 — per-model capability defaults.
 *
 * Applied at synthesis time (createDefaultModelProfiles / parseLegacyCapabilityCatalog)
 * AND folded in at READ/WRITE normalization (parseRuntimeProviderModelProfiles +
 * normalizeModelProfiles) so PROD rows persisted with the new fields = null (these are
 * brand-new fields) resolve to the published ceiling without a manual admin save.
 *
 * Fold-in rule (ADR-122 corrective pass): for a KNOWN model an explicit admin value
 * always wins; a stored/blank null is coerced to the published ceiling here. This
 * supersedes the earlier "null strictly round-trips" note — coercing known-model nulls
 * to the real ceiling is the deliberate decision so PROD never hits the safe fallback
 * for a model we actually know. An UNKNOWN model stays null and resolves to the runtime
 * resolver's OUTPUT_BUDGET_FALLBACK (safe, admin-tunable via the runtime UI).
 *
 * Anthropic values are from official docs as of 2026-06-20:
 *   contextWindow=200_000 (non-premium 200k tier; real inputs are ≪200k).
 *   maxOutputTokens from the per-model published ceiling.
 * OpenAI values are official limits as of 2026-06. Any OpenAI key not listed here
 * resolves to OUTPUT_BUDGET_FALLBACK (safe, admin-tunable via the runtime UI).
 */
export const MODEL_CAPABILITY_DEFAULTS: Partial<
  Record<string, { contextWindow: number | null; maxOutputTokens: number | null }>
> = {
  "claude-sonnet-4-6": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-sonnet-4-5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-haiku-4-5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-opus-4-5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-opus-4-6": { contextWindow: 200_000, maxOutputTokens: 128_000 },
  "claude-opus-4-7": { contextWindow: 200_000, maxOutputTokens: 128_000 },
  "claude-opus-4-8": { contextWindow: 200_000, maxOutputTokens: 128_000 },
  "gpt-5.1": { contextWindow: 400_000, maxOutputTokens: 128_000 },
  "gpt-5.1-codex": { contextWindow: 400_000, maxOutputTokens: 128_000 },
  "gpt-5": { contextWindow: 400_000, maxOutputTokens: 128_000 },
  "gpt-5-mini": { contextWindow: 400_000, maxOutputTokens: 128_000 },
  "gpt-5-nano": { contextWindow: 400_000, maxOutputTokens: 128_000 },
  "gpt-4o": { contextWindow: 128_000, maxOutputTokens: 16_384 },
  "gpt-4o-mini": { contextWindow: 128_000, maxOutputTokens: 16_384 }
};

export type ChatRoutingRuntimeProvider = (typeof CHAT_ROUTING_PROVIDERS)[number];
export type ManagedRuntimeCatalogProvider = (typeof MANAGED_CATALOG_PROVIDERS)[number];
export type VideoGenerateRuntimeProvider = (typeof VIDEO_GENERATE_PROVIDERS)[number];
export type ManagedRuntimeProvider = ChatRoutingRuntimeProvider;
export type RuntimeCredentialSecretRefSource = "env" | "file" | "exec" | "persai";

export type RuntimeCredentialSecretRef = {
  source: RuntimeCredentialSecretRefSource;
  provider: string;
  id: string;
};

export type RuntimeProviderCredentialRefState = {
  refKey: string;
  secretRef: RuntimeCredentialSecretRef;
  updatedAt: string | null;
};

export type RuntimeProviderProfileSelection = {
  provider: ManagedRuntimeProvider;
  model: string;
};

export type RuntimeProviderAvailableModelsByProvider = Record<ManagedRuntimeProvider, string[]>;
export type RuntimeProviderModelCapability =
  | "chat"
  | "image"
  | "video"
  | "speech_to_text"
  | "text_to_speech"
  | "ocr_or_document_parsing";
export const RUNTIME_PROVIDER_MODEL_CAPABILITIES: RuntimeProviderModelCapability[] = [
  "chat",
  "image",
  "video",
  "speech_to_text",
  "text_to_speech",
  "ocr_or_document_parsing"
];
export type RuntimeProviderBillingMode =
  | "token_metered"
  | "time_metered"
  | "text_chars_metered"
  | "fixed_operation"
  | "tiered_operation";
export const RUNTIME_PROVIDER_BILLING_MODES: RuntimeProviderBillingMode[] = [
  "token_metered",
  "time_metered",
  "text_chars_metered",
  "fixed_operation",
  "tiered_operation"
];
export type RuntimeProviderTimePriceUnit = "second" | "minute";
export const RUNTIME_PROVIDER_TIME_PRICE_UNITS: RuntimeProviderTimePriceUnit[] = [
  "second",
  "minute"
];
export const DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT = 1;
export type RuntimeProviderTokenPriceMetadata = {
  inputPer1M: number;
  cacheCreationInputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
};
export type RuntimeProviderTimePriceMetadata = {
  unit: RuntimeProviderTimePriceUnit;
  pricePerUnit: number;
};
export type RuntimeProviderTextCharsPriceMetadata = {
  pricePer1MChars: number;
};
export type RuntimeProviderFixedOperationPriceMetadata = {
  unitLabel: string | null;
  pricePerOperation: number;
};
export type RuntimeProviderTierPriceMetadata = {
  label: string;
  matchValue: string | null;
  price: number;
};
export type RuntimeProviderTieredOperationPriceMetadata = {
  unitLabel: string | null;
  tiers: RuntimeProviderTierPriceMetadata[];
};
export type RuntimeProviderTokenMeteredPriceConfig = {
  currency: string;
  tokenPricing: RuntimeProviderTokenPriceMetadata;
};
export type RuntimeProviderTimeMeteredPriceConfig = {
  currency: string;
  timePricing: RuntimeProviderTimePriceMetadata;
};
export type RuntimeProviderTextCharsMeteredPriceConfig = {
  currency: string;
  textCharsPricing: RuntimeProviderTextCharsPriceMetadata;
};
export type RuntimeProviderFixedOperationPriceConfig = {
  currency: string;
  fixedOperationPricing: RuntimeProviderFixedOperationPriceMetadata;
};
export type RuntimeProviderTieredOperationPriceConfig = {
  currency: string;
  tieredOperationPricing: RuntimeProviderTieredOperationPriceMetadata;
};
export type RuntimeProviderPriceMetadataByBillingMode = {
  token_metered: RuntimeProviderTokenMeteredPriceConfig;
  time_metered: RuntimeProviderTimeMeteredPriceConfig;
  text_chars_metered: RuntimeProviderTextCharsMeteredPriceConfig;
  fixed_operation: RuntimeProviderFixedOperationPriceConfig;
  tiered_operation: RuntimeProviderTieredOperationPriceConfig;
};
export type RuntimeProviderPriceMetadata =
  RuntimeProviderPriceMetadataByBillingMode[keyof RuntimeProviderPriceMetadataByBillingMode];
export type RuntimeProviderPriceMetadataForBillingMode<M extends RuntimeProviderBillingMode> =
  RuntimeProviderPriceMetadataByBillingMode[M];

export type RuntimeVideoModelKind = "cinematic" | "talking_avatar";

type RuntimeProviderModelProfileBase = {
  model: string;
  capabilities: RuntimeProviderModelCapability[];
  kind: RuntimeVideoModelKind;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  inputTokenWeight: number;
  cachedInputTokenWeight: number;
  outputTokenWeight: number;
  /** ADR-122 — admin-set max answer tokens; null on a known model is coerced to the
   * published ceiling at normalization, otherwise the runtime resolver OUTPUT_BUDGET_FALLBACK applies. */
  maxOutputTokens: number | null;
  /** ADR-122 — admin-set total context window; null ⇒ resolver context-window guard skipped. */
  contextWindow: number | null;
  displayLabel: string | null;
  notes: string | null;
  videoModelParameters?: RuntimeVideoModelParameters | null;
};
export type RuntimeProviderTokenMeteredModelProfile = RuntimeProviderModelProfileBase & {
  billingMode: "token_metered";
  providerPriceMetadata: RuntimeProviderTokenMeteredPriceConfig;
};
export type RuntimeProviderTimeMeteredModelProfile = RuntimeProviderModelProfileBase & {
  billingMode: "time_metered";
  providerPriceMetadata: RuntimeProviderTimeMeteredPriceConfig;
};
export type RuntimeProviderTextCharsMeteredModelProfile = RuntimeProviderModelProfileBase & {
  billingMode: "text_chars_metered";
  providerPriceMetadata: RuntimeProviderTextCharsMeteredPriceConfig;
};
export type RuntimeProviderFixedOperationModelProfile = RuntimeProviderModelProfileBase & {
  billingMode: "fixed_operation";
  providerPriceMetadata: RuntimeProviderFixedOperationPriceConfig;
};
export type RuntimeProviderTieredOperationModelProfile = RuntimeProviderModelProfileBase & {
  billingMode: "tiered_operation";
  providerPriceMetadata: RuntimeProviderTieredOperationPriceConfig;
};
export type RuntimeProviderModelProfile =
  | RuntimeProviderTokenMeteredModelProfile
  | RuntimeProviderTimeMeteredModelProfile
  | RuntimeProviderTextCharsMeteredModelProfile
  | RuntimeProviderFixedOperationModelProfile
  | RuntimeProviderTieredOperationModelProfile;
export type RuntimeProviderModelCatalog = {
  models: RuntimeProviderModelProfile[];
};
export type RuntimeProviderModelCatalogByProvider = Record<
  ManagedRuntimeCatalogProvider,
  RuntimeProviderModelCatalog
>;

export type AdminManagedRuntimeProviderProfileState = {
  schema: typeof RUNTIME_PROVIDER_PROFILE_SCHEMA;
  mode: "admin_managed";
  derivedFrom: {
    policyEnvelopeSchema: typeof RUNTIME_PROVIDER_PROFILE_SCHEMA;
    secretRefsSchema: typeof RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA;
  };
  allowedProviders: ManagedRuntimeProvider[];
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  availableModelCatalogByProvider: RuntimeProviderModelCatalogByProvider;
  primary: RuntimeProviderProfileSelection & {
    credentialRef: RuntimeProviderCredentialRefState;
  };
  fallback:
    | (RuntimeProviderProfileSelection & {
        credentialRef: RuntimeProviderCredentialRefState;
      })
    | null;
  notes: string[];
};

export type LegacyRuntimeProviderProfileState = {
  schema: typeof RUNTIME_PROVIDER_PROFILE_SCHEMA;
  mode: "unconfigured_default";
  derivedFrom: {
    policyEnvelopeSchema: null;
    secretRefsSchema: typeof RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA | null;
  };
  allowedProviders: ManagedRuntimeProvider[];
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  availableModelCatalogByProvider: RuntimeProviderModelCatalogByProvider;
  primary: null;
  fallback: null;
  notes: string[];
};

export type RuntimeProviderProfileState =
  | AdminManagedRuntimeProviderProfileState
  | LegacyRuntimeProviderProfileState;

type RuntimeProviderCredentialRefsEnvelope = {
  schema: typeof RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA;
  providers: Partial<Record<ManagedRuntimeProvider, RuntimeProviderCredentialRefState>>;
};

type RuntimeProviderProfilePolicy = {
  schema: typeof RUNTIME_PROVIDER_PROFILE_SCHEMA;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  availableModelCatalogByProvider: RuntimeProviderModelCatalogByProvider;
  primary: RuntimeProviderProfileSelection;
  fallback: RuntimeProviderProfileSelection | null;
};

function isChatRoutingProvider(value: string): value is ChatRoutingRuntimeProvider {
  return CHAT_ROUTING_PROVIDERS.includes(value as ChatRoutingRuntimeProvider);
}

function isVideoOnlyCatalogProvider(value: ManagedRuntimeCatalogProvider): boolean {
  return value === "runway" || value === "kling" || value === "heygen";
}

function defaultVideoModelKindForProvider(
  provider: ManagedRuntimeCatalogProvider
): RuntimeVideoModelKind {
  return provider === "heygen" ? "talking_avatar" : "cinematic";
}

const MAX_MODEL_LENGTH = 256;
const MAX_REF_KEY_LENGTH = 256;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asIsoStringOrNull(value: unknown): string | null {
  const normalized = asNonEmptyString(value);
  if (normalized === null) {
    return null;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function normalizeManagedRuntimeProvider(value: unknown, path: string): ManagedRuntimeProvider {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (typeof normalized === "string" && isChatRoutingProvider(normalized)) {
    return normalized;
  }
  throw new Error(`${path} must be one of: ${CHAT_ROUTING_PROVIDERS.join(", ")}.`);
}

function normalizeModelId(value: unknown, path: string): string {
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

function createEmptyAvailableModelsByProvider(): RuntimeProviderAvailableModelsByProvider {
  return {
    openai: [],
    anthropic: []
  };
}

function createEmptyModelCatalogByProvider(): RuntimeProviderModelCatalogByProvider {
  return {
    openai: { models: [] },
    anthropic: { models: [] },
    runway: { models: [] },
    kling: { models: [] },
    heygen: { models: [] }
  };
}

function isRuntimeProviderModelCapability(value: unknown): value is RuntimeProviderModelCapability {
  return (
    value === "chat" ||
    value === "image" ||
    value === "video" ||
    value === "speech_to_text" ||
    value === "text_to_speech"
  );
}

function normalizeCapabilityList(value: unknown): RuntimeProviderModelCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<RuntimeProviderModelCapability>();
  for (const entry of value) {
    if (isRuntimeProviderModelCapability(entry)) {
      deduped.add(entry);
    }
  }
  return Array.from(deduped);
}

function inferBillingMode(
  capabilities: RuntimeProviderModelCapability[]
): RuntimeProviderBillingMode {
  if (capabilities.includes("chat")) {
    return "token_metered";
  }
  if (capabilities.includes("speech_to_text")) {
    return "time_metered";
  }
  if (capabilities.includes("text_to_speech")) {
    return "text_chars_metered";
  }
  if (capabilities.includes("ocr_or_document_parsing")) {
    return "fixed_operation";
  }
  if (capabilities.includes("image")) {
    return "token_metered";
  }
  if (capabilities.includes("video")) {
    return "time_metered";
  }
  return "token_metered";
}

function normalizeBillingMode(
  value: unknown,
  capabilities: RuntimeProviderModelCapability[]
): RuntimeProviderBillingMode {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (
    normalized === "token_metered" ||
    normalized === "time_metered" ||
    normalized === "text_chars_metered" ||
    normalized === "fixed_operation" ||
    normalized === "tiered_operation"
  ) {
    return normalized;
  }
  return inferBillingMode(capabilities);
}

function normalizeNonNegativeNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

function normalizeTokenWeight(value: unknown): number {
  return normalizeNonNegativeNumber(value, DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT);
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * ADR-122 D1 — lenient read-side parser for persisted capability integers.
 * Returns null for absent/null/invalid values; never throws. Used only in
 * `parseRuntimeProviderModelProfiles` (DB read path) so a bad stored value
 * silently degrades to null rather than breaking the settings load.
 */
function parseOptionalPositiveIntegerFromStorage(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizePositiveInteger(value);
}

function nullableTrimmedString(value: unknown): string | null {
  const normalized = asNonEmptyString(value);
  return normalized === null ? null : normalized;
}

function normalizeVideoAspectRatio(value: unknown): PersaiRuntimeVideoAspectRatio | null {
  return PERSAI_RUNTIME_VIDEO_ASPECT_RATIOS.includes(value as PersaiRuntimeVideoAspectRatio)
    ? (value as PersaiRuntimeVideoAspectRatio)
    : null;
}

function normalizeVideoSize(value: unknown): PersaiRuntimeVideoGenerateSize | null {
  return PERSAI_RUNTIME_VIDEO_GENERATE_SIZES.includes(value as PersaiRuntimeVideoGenerateSize)
    ? (value as PersaiRuntimeVideoGenerateSize)
    : null;
}

function normalizeVideoDurationConstraint(value: unknown): RuntimeVideoDurationConstraint | null {
  const row = asObject(value);
  if (row === null) {
    return null;
  }
  const kind = asNonEmptyString(row.kind);
  if (kind === "allowed_list") {
    if (!Array.isArray(row.values)) {
      return null;
    }
    const values = Array.from(
      new Set(
        row.values
          .map((entry) => normalizePositiveInteger(entry))
          .filter((v): v is number => v !== null)
      )
    ).sort((left, right) => left - right);
    return values.length > 0
      ? {
          kind: "allowed_list",
          values
        }
      : null;
  }
  if (kind === "range") {
    const min = normalizePositiveInteger(row.min);
    const max = normalizePositiveInteger(row.max);
    if (min === null || max === null || max < min) {
      return null;
    }
    const step =
      row.step === null || row.step === undefined ? null : normalizePositiveInteger(row.step);
    const preferredValues = Array.isArray(row.preferredValues)
      ? Array.from(
          new Set(
            row.preferredValues
              .map((entry) => normalizePositiveInteger(entry))
              .filter((entry): entry is number => entry !== null && entry >= min && entry <= max)
          )
        ).sort((left, right) => left - right)
      : [];
    return {
      kind: "range",
      min,
      max,
      step,
      preferredValues: preferredValues.length > 0 ? preferredValues : null
    };
  }
  return null;
}

function normalizeVideoAspectRatioOptions(value: unknown): RuntimeVideoAspectRatioOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options: RuntimeVideoAspectRatioOption[] = [];
  const dedupe = new Set<string>();
  for (const entry of value) {
    const row = asObject(entry);
    const aspectRatio = normalizeVideoAspectRatio(row?.aspectRatio);
    const size = normalizeVideoSize(row?.size);
    if (row === null || aspectRatio === null || size === null) {
      continue;
    }
    const providerValue = nullableTrimmedString(row.providerValue);
    const dedupeKey = `${aspectRatio}:${size}:${providerValue ?? ""}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);
    options.push({
      aspectRatio,
      size,
      providerValue
    });
  }
  return options;
}

function normalizeVideoProviderParameters(value: unknown): RuntimeVideoProviderParameters | null {
  const row = asObject(value);
  if (row === null) {
    return null;
  }
  const mode = nullableTrimmedString(row.mode);
  const sound = row.sound === "on" || row.sound === "off" ? row.sound : null;
  const audio = typeof row.audio === "boolean" ? row.audio : null;
  const resolution =
    row.resolution === "720p" || row.resolution === "1080p" || row.resolution === "4k"
      ? row.resolution
      : null;
  const aspectRatio =
    row.aspectRatio === "auto" ||
    row.aspectRatio === "16:9" ||
    row.aspectRatio === "9:16" ||
    row.aspectRatio === "1:1" ||
    row.aspectRatio === "4:5" ||
    row.aspectRatio === "5:4"
      ? row.aspectRatio
      : null;
  const engine = row.engine === "avatar_iv" || row.engine === "avatar_v" ? row.engine : null;
  return mode !== null ||
    sound !== null ||
    audio !== null ||
    resolution !== null ||
    aspectRatio !== null ||
    engine !== null
    ? {
        ...(mode === null ? {} : { mode }),
        ...(sound === null ? {} : { sound }),
        ...(audio === null ? {} : { audio }),
        ...(resolution === null ? {} : { resolution }),
        ...(aspectRatio === null ? {} : { aspectRatio }),
        ...(engine === null ? {} : { engine })
      }
    : null;
}

function isRuntimeVideoAudioCapability(value: unknown): value is RuntimeVideoAudioCapability {
  return RUNTIME_VIDEO_AUDIO_CAPABILITIES.includes(value as RuntimeVideoAudioCapability);
}

function isRuntimeVideoInputCapability(value: unknown): value is RuntimeVideoInputCapability {
  return RUNTIME_VIDEO_INPUT_CAPABILITIES.includes(value as RuntimeVideoInputCapability);
}

function normalizeVideoAudioCapabilities(value: unknown): RuntimeVideoAudioCapability[] {
  if (!Array.isArray(value)) {
    return ["silent"];
  }
  const deduped = new Set<RuntimeVideoAudioCapability>();
  for (const entry of value) {
    if (isRuntimeVideoAudioCapability(entry)) {
      deduped.add(entry);
    }
  }
  if (deduped.size === 0) {
    deduped.add("silent");
  }
  if (!deduped.has("silent")) {
    deduped.add("silent");
  }
  return Array.from(deduped);
}

function normalizeVideoInputCapabilities(
  value: unknown,
  referenceImageSupported: boolean
): RuntimeVideoInputCapability[] {
  if (!Array.isArray(value)) {
    return referenceImageSupported ? ["text", "single_reference_image"] : ["text"];
  }
  const deduped = new Set<RuntimeVideoInputCapability>();
  for (const entry of value) {
    if (isRuntimeVideoInputCapability(entry)) {
      deduped.add(entry);
    }
  }
  if (deduped.size === 0) {
    deduped.add("text");
  }
  if (!deduped.has("text")) {
    deduped.add("text");
  }
  if (referenceImageSupported) {
    deduped.add("single_reference_image");
  } else {
    deduped.delete("single_reference_image");
  }
  return Array.from(deduped);
}

function normalizeVideoModelParameters(value: unknown): RuntimeVideoModelParameters | null {
  const row = asObject(value);
  if (row === null) {
    return null;
  }
  const duration = normalizeVideoDurationConstraint(row.duration);
  const aspectRatios = normalizeVideoAspectRatioOptions(row.aspectRatios);
  if (duration === null || aspectRatios.length === 0) {
    return null;
  }
  const referenceImageSupported = row.referenceImageSupported === true;
  return {
    duration,
    aspectRatios,
    referenceImageSupported,
    audioCapabilities: normalizeVideoAudioCapabilities(row.audioCapabilities),
    inputCapabilities: normalizeVideoInputCapabilities(
      row.inputCapabilities,
      referenceImageSupported
    ),
    providerParameters: normalizeVideoProviderParameters(row.providerParameters)
  };
}

function normalizeCurrency(value: unknown): string {
  const normalized = asNonEmptyString(value)?.toUpperCase() ?? "USD";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "USD";
}

function normalizeTimePriceUnit(value: unknown): RuntimeProviderTimePriceUnit {
  return value === "second" || value === "minute" ? value : "minute";
}

function normalizeTierPriceEntries(value: unknown): RuntimeProviderTierPriceMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: RuntimeProviderTierPriceMetadata[] = [];
  for (const entry of value) {
    const row = asObject(entry);
    const label = asNonEmptyString(row?.label);
    if (row === null || label === null) {
      continue;
    }
    result.push({
      label,
      matchValue: nullableTrimmedString(row.matchValue),
      price: normalizeNonNegativeNumber(row.price)
    });
  }
  return result;
}

export function createDefaultRuntimeProviderPriceMetadata(
  billingMode: "token_metered"
): RuntimeProviderTokenMeteredPriceConfig;
export function createDefaultRuntimeProviderPriceMetadata(
  billingMode: "time_metered"
): RuntimeProviderTimeMeteredPriceConfig;
export function createDefaultRuntimeProviderPriceMetadata(
  billingMode: "text_chars_metered"
): RuntimeProviderTextCharsMeteredPriceConfig;
export function createDefaultRuntimeProviderPriceMetadata(
  billingMode: "fixed_operation"
): RuntimeProviderFixedOperationPriceConfig;
export function createDefaultRuntimeProviderPriceMetadata(
  billingMode: "tiered_operation"
): RuntimeProviderTieredOperationPriceConfig;
export function createDefaultRuntimeProviderPriceMetadata(
  billingMode: RuntimeProviderBillingMode
): RuntimeProviderPriceMetadata;
export function createDefaultRuntimeProviderPriceMetadata(
  billingMode: RuntimeProviderBillingMode
): RuntimeProviderPriceMetadata {
  switch (billingMode) {
    case "token_metered":
      return {
        currency: "USD",
        tokenPricing: {
          inputPer1M: 0,
          cacheCreationInputPer1M: 0,
          cachedInputPer1M: 0,
          outputPer1M: 0
        }
      };
    case "time_metered":
      return {
        currency: "USD",
        timePricing: {
          unit: "minute",
          pricePerUnit: 0
        }
      };
    case "text_chars_metered":
      return {
        currency: "USD",
        textCharsPricing: {
          pricePer1MChars: 0
        }
      };
    case "fixed_operation":
      return {
        currency: "USD",
        fixedOperationPricing: {
          unitLabel: null,
          pricePerOperation: 0
        }
      };
    case "tiered_operation":
      return {
        currency: "USD",
        tieredOperationPricing: {
          unitLabel: null,
          tiers: []
        }
      };
  }
}

function normalizeProviderPriceMetadata(
  value: unknown,
  billingMode: "token_metered"
): RuntimeProviderTokenMeteredPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  billingMode: "time_metered"
): RuntimeProviderTimeMeteredPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  billingMode: "text_chars_metered"
): RuntimeProviderTextCharsMeteredPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  billingMode: "fixed_operation"
): RuntimeProviderFixedOperationPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  billingMode: "tiered_operation"
): RuntimeProviderTieredOperationPriceConfig;
function normalizeProviderPriceMetadata(
  value: unknown,
  billingMode: RuntimeProviderBillingMode
): RuntimeProviderPriceMetadata {
  const row = asObject(value);
  if (row === null) {
    return createDefaultRuntimeProviderPriceMetadata(billingMode);
  }
  const currency = normalizeCurrency(row.currency);
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
                inputPer1M: normalizeNonNegativeNumber(tokenPricingRow.inputPer1M),
                cacheCreationInputPer1M: normalizeNonNegativeNumber(
                  tokenPricingRow.cacheCreationInputPer1M
                ),
                cachedInputPer1M: normalizeNonNegativeNumber(tokenPricingRow.cachedInputPer1M),
                outputPer1M: normalizeNonNegativeNumber(tokenPricingRow.outputPer1M)
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
                unit: normalizeTimePriceUnit(timePricingRow.unit),
                pricePerUnit: normalizeNonNegativeNumber(timePricingRow.pricePerUnit)
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
                pricePer1MChars: normalizeNonNegativeNumber(textCharsPricingRow.pricePer1MChars)
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
                unitLabel: nullableTrimmedString(fixedOperationPricingRow.unitLabel),
                pricePerOperation: normalizeNonNegativeNumber(
                  fixedOperationPricingRow.pricePerOperation
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
                unitLabel: nullableTrimmedString(tieredOperationPricingRow.unitLabel),
                tiers: normalizeTierPriceEntries(tieredOperationPricingRow.tiers)
              }
      };
    }
  }
}

function parseAvailableModelsByProvider(value: unknown): RuntimeProviderAvailableModelsByProvider {
  const result = createEmptyAvailableModelsByProvider();
  const row = asObject(value);
  if (row === null) {
    return result;
  }
  for (const provider of CHAT_ROUTING_PROVIDERS) {
    const models = row[provider];
    if (!Array.isArray(models)) {
      continue;
    }
    const deduped = new Set<string>();
    for (const entry of models) {
      const model = toNormalizedNonEmptyModelKey(entry);
      if (model === null) {
        continue;
      }
      if (model.length > MAX_MODEL_LENGTH || containsControlCharacters(model)) {
        continue;
      }
      deduped.add(normalizeModelKey(model));
    }
    result[provider] = Array.from(deduped);
  }
  return result;
}

function normalizeCatalogList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const entry of value) {
    const model = toNormalizedNonEmptyModelKey(entry);
    if (model === null) {
      continue;
    }
    if (model.length > MAX_MODEL_LENGTH || containsControlCharacters(model)) {
      continue;
    }
    deduped.add(normalizeModelKey(model));
  }
  return Array.from(deduped);
}

function parseModelCatalogByProvider(
  value: unknown,
  chatFallback: RuntimeProviderAvailableModelsByProvider
): RuntimeProviderModelCatalogByProvider {
  const result = createEmptyModelCatalogByProvider();
  const row = asObject(value);
  if (row === null) {
    return {
      openai: { models: createDefaultModelProfiles(chatFallback.openai, ["chat"]) },
      anthropic: { models: createDefaultModelProfiles(chatFallback.anthropic, ["chat"]) },
      runway: { models: [] },
      kling: { models: [] },
      heygen: { models: [] }
    };
  }
  for (const provider of MANAGED_CATALOG_PROVIDERS) {
    const providerRow = asObject(row[provider]);
    if (providerRow === null) {
      result[provider].models = isChatRoutingProvider(provider)
        ? createDefaultModelProfiles(chatFallback[provider], ["chat"])
        : [];
      continue;
    }
    if (Array.isArray(providerRow.models)) {
      result[provider] = {
        models: parseRuntimeProviderModelProfiles(
          provider,
          providerRow.models,
          `availableModelCatalogByProvider.${provider}.models`
        )
      };
    } else {
      result[provider] = {
        models: parseLegacyCapabilityCatalog(
          provider,
          providerRow,
          isChatRoutingProvider(provider) ? chatFallback[provider] : []
        )
      };
    }
    if (
      isChatRoutingProvider(provider) &&
      !result[provider].models.some((profile) => profile.capabilities.includes("chat"))
    ) {
      result[provider].models.push(...createDefaultModelProfiles(chatFallback[provider], ["chat"]));
    }
  }
  return result;
}

function createDefaultModelProfiles(
  models: string[],
  capabilities: RuntimeProviderModelCapability[]
): RuntimeProviderModelProfile[] {
  const billingMode = inferBillingMode(capabilities);
  return normalizeCatalogList(models).map((model) => {
    const capabilityDefaults = MODEL_CAPABILITY_DEFAULTS[model] ?? null;
    const base = {
      model,
      capabilities,
      kind: "cinematic" as RuntimeVideoModelKind,
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      maxOutputTokens: capabilityDefaults?.maxOutputTokens ?? null,
      contextWindow: capabilityDefaults?.contextWindow ?? null,
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

function parseRuntimeProviderModelProfiles(
  provider: ManagedRuntimeCatalogProvider,
  value: unknown[],
  path: string
): RuntimeProviderModelProfile[] {
  const result: RuntimeProviderModelProfile[] = [];
  const activeModels = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const row = asObject(entry);
    if (row === null) {
      continue;
    }
    const model = toNormalizedNonEmptyModelKey(row.model ?? row.modelKey);
    if (model === null || model.length > MAX_MODEL_LENGTH || containsControlCharacters(model)) {
      continue;
    }
    const capabilities = normalizeCapabilityList(row.capabilities);
    if (capabilities.length === 0) {
      continue;
    }
    if (
      isVideoOnlyCatalogProvider(provider) &&
      capabilities.some((capability) => capability !== "video")
    ) {
      throw new Error(
        `${path}[${String(index)}].capabilities must contain only "video" for ${provider} catalog rows.`
      );
    }
    const active = row.active === undefined ? true : row.active === true;
    if (active && activeModels.has(model)) {
      continue;
    }
    if (active) {
      activeModels.add(model);
    }
    const billingMode = normalizeBillingMode(row.billingMode, capabilities);
    const defaultKind = defaultVideoModelKindForProvider(provider);
    const rawKind = asNonEmptyString(row.kind);
    const kind: RuntimeVideoModelKind =
      rawKind === "cinematic" || rawKind === "talking_avatar" ? rawKind : defaultKind;
    if (provider === "heygen" && kind !== "talking_avatar") {
      throw new Error(
        `${path}[${String(index)}].kind: HeyGen rows must have kind='talking_avatar'; received '${kind}'.`
      );
    }
    if (provider !== "heygen" && kind === "talking_avatar") {
      throw new Error(
        `${path}[${String(index)}].kind: only HeyGen rows may have kind='talking_avatar'; provider '${provider}' received 'talking_avatar'.`
      );
    }
    const base = {
      model,
      capabilities,
      kind,
      active,
      effectiveFrom: asIsoStringOrNull(row.effectiveFrom),
      effectiveTo: asIsoStringOrNull(row.effectiveTo),
      inputTokenWeight: normalizeTokenWeight(row.inputTokenWeight),
      cachedInputTokenWeight: normalizeTokenWeight(row.cachedInputTokenWeight),
      outputTokenWeight: normalizeTokenWeight(row.outputTokenWeight),
      // ADR-122 corrective: fold family default in at READ so PROD rows stored with
      // null (brand-new fields) resolve to the published ceiling. Explicit stored
      // value always wins; null on a KNOWN model is coerced to the default; unknown
      // model stays null (→ resolver OUTPUT_BUDGET_FALLBACK).
      maxOutputTokens:
        parseOptionalPositiveIntegerFromStorage(row.maxOutputTokens) ??
        MODEL_CAPABILITY_DEFAULTS[model]?.maxOutputTokens ??
        null,
      contextWindow:
        parseOptionalPositiveIntegerFromStorage(row.contextWindow) ??
        MODEL_CAPABILITY_DEFAULTS[model]?.contextWindow ??
        null,
      displayLabel: nullableTrimmedString(row.displayLabel),
      notes: nullableTrimmedString(row.notes),
      videoModelParameters: capabilities.includes("video")
        ? normalizeVideoModelParameters(row.videoModelParameters)
        : null
    };
    if (capabilities.includes("video") && base.videoModelParameters === null) {
      throw new Error(
        `${path}[${String(index)}].videoModelParameters is required for video models.`
      );
    }
    switch (billingMode) {
      case "token_metered":
        result.push({
          ...base,
          billingMode,
          providerPriceMetadata: normalizeProviderPriceMetadata(
            row.providerPriceMetadata,
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
            "tiered_operation"
          )
        });
        break;
    }
  }
  return result.map((profile) => applyDerivedTokenMeteredWeights(profile));
}

function parseLegacyCapabilityCatalog(
  provider: ManagedRuntimeCatalogProvider,
  providerRow: Record<string, unknown>,
  chatFallback: string[]
): RuntimeProviderModelProfile[] {
  const byModel = new Map<string, Set<RuntimeProviderModelCapability>>();
  const append = (models: string[], capability: RuntimeProviderModelCapability) => {
    for (const model of models) {
      const capabilities = byModel.get(model) ?? new Set<RuntimeProviderModelCapability>();
      capabilities.add(capability);
      byModel.set(model, capabilities);
    }
  };
  const chatModels = normalizeCatalogList(providerRow.chat);
  const imageModels = normalizeCatalogList(providerRow.image);
  if (isVideoOnlyCatalogProvider(provider) && (chatModels.length > 0 || imageModels.length > 0)) {
    throw new Error(
      `availableModelCatalogByProvider.${provider} legacy catalog rows must not include chat or image models.`
    );
  }
  if (isChatRoutingProvider(provider)) {
    append(chatModels.length > 0 ? chatModels : chatFallback, "chat");
  }
  append(imageModels, "image");
  append(normalizeCatalogList(providerRow.video), "video");
  return Array.from(byModel.entries()).map(([model, capabilities]) => {
    const capabilityList = Array.from(capabilities);
    const billingMode = inferBillingMode(capabilityList);
    const capabilityDefaults = MODEL_CAPABILITY_DEFAULTS[model] ?? null;
    const base = {
      model,
      capabilities: capabilityList,
      kind: defaultVideoModelKindForProvider(provider),
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      maxOutputTokens: capabilityDefaults?.maxOutputTokens ?? null,
      contextWindow: capabilityDefaults?.contextWindow ?? null,
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

export function getRuntimeProviderCatalogModelsByCapability(
  catalog: RuntimeProviderModelCatalog,
  capability: RuntimeProviderModelCapability
): string[] {
  const deduped = new Set<string>();
  for (const profile of catalog.models) {
    if (!profile.active || !profile.capabilities.includes(capability)) {
      continue;
    }
    deduped.add(profile.model);
  }
  return Array.from(deduped);
}

export function findRuntimeProviderCatalogProfile(
  catalog: RuntimeProviderModelCatalog,
  model: string
): RuntimeProviderModelProfile | null {
  return (
    catalog.models.find((profile) => profile.model === model && profile.active) ??
    catalog.models.find((profile) => profile.model === model) ??
    null
  );
}

function profileMatchesEffectiveAt(
  profile: RuntimeProviderModelProfile,
  occurredAt: Date
): boolean {
  const effectiveFrom =
    profile.effectiveFrom === null ? null : new Date(profile.effectiveFrom).getTime();
  const effectiveTo = profile.effectiveTo === null ? null : new Date(profile.effectiveTo).getTime();
  const occurredAtMs = occurredAt.getTime();
  if (Number.isNaN(occurredAtMs)) {
    return false;
  }
  if (effectiveFrom !== null && !Number.isNaN(effectiveFrom) && occurredAtMs < effectiveFrom) {
    return false;
  }
  if (effectiveTo !== null && !Number.isNaN(effectiveTo) && occurredAtMs >= effectiveTo) {
    return false;
  }
  return true;
}

function profileEffectiveFromSortValue(profile: RuntimeProviderModelProfile): number {
  if (profile.effectiveFrom === null) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = new Date(profile.effectiveFrom).getTime();
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function findRuntimeProviderCatalogProfileAcrossProvidersForTimestamp(
  catalogByProvider: RuntimeProviderModelCatalogByProvider,
  model: string,
  occurredAt: string | Date
): RuntimeProviderModelProfile | null {
  for (const provider of MANAGED_CATALOG_PROVIDERS) {
    const profile = findRuntimeProviderCatalogProfileForTimestamp(
      catalogByProvider[provider],
      model,
      occurredAt
    );
    if (profile !== null) {
      return profile;
    }
  }
  return null;
}

export function findRuntimeProviderCatalogProfileForTimestamp(
  catalog: RuntimeProviderModelCatalog,
  model: string,
  occurredAt: string | Date
): RuntimeProviderModelProfile | null {
  const occurredAtDate = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const timestampMatches = catalog.models
    .filter((profile) => profile.model === model)
    .filter((profile) => profileMatchesEffectiveAt(profile, occurredAtDate))
    .sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }
      return profileEffectiveFromSortValue(right) - profileEffectiveFromSortValue(left);
    });
  if (timestampMatches.length > 0) {
    return timestampMatches[0] ?? null;
  }
  return null;
}

function normalizeRefKey(value: unknown, fallback: RuntimeCredentialSecretRef): string {
  const normalized = asNonEmptyString(value);
  if (normalized === null) {
    return `${fallback.source}:${fallback.provider}:${fallback.id}`;
  }
  if (normalized.length > MAX_REF_KEY_LENGTH) {
    throw new Error(
      `runtime_provider_credentials refKey must be at most ${String(MAX_REF_KEY_LENGTH)} characters.`
    );
  }
  if (containsControlCharacters(normalized)) {
    throw new Error("runtime_provider_credentials refKey contains invalid control characters.");
  }
  return normalized;
}

function parseRuntimeCredentialSecretRef(value: unknown, path: string): RuntimeCredentialSecretRef {
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object.`);
  }
  const source =
    row.source === "env" ||
    row.source === "file" ||
    row.source === "exec" ||
    row.source === "persai"
      ? row.source
      : null;
  const provider = asNonEmptyString(row.provider);
  const id = asNonEmptyString(row.id);
  if (source === null || provider === null || id === null) {
    throw new Error(`${path} must include valid source, provider, and id fields.`);
  }
  return {
    source,
    provider,
    id
  };
}

function parseRuntimeProviderCredentialRefState(
  value: unknown,
  path: string
): RuntimeProviderCredentialRefState {
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object.`);
  }
  const secretRef = parseRuntimeCredentialSecretRef(row.secretRef ?? row.ref, `${path}.secretRef`);
  return {
    refKey: normalizeRefKey(row.refKey, secretRef),
    secretRef,
    updatedAt: asIsoStringOrNull(row.updatedAt)
  };
}

function parseRuntimeProviderCredentialRefsEnvelope(
  secretRefs: unknown
): RuntimeProviderCredentialRefsEnvelope | null {
  const root = asObject(secretRefs);
  const refs = asObject(root?.refs);
  const envelope = asObject(
    refs?.runtime_provider_credentials ?? refs?.runtimeProviderCredentials ?? null
  );
  if (envelope === null) {
    return null;
  }
  if (envelope.schema !== RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA) {
    throw new Error(
      `secretRefs.refs.runtime_provider_credentials.schema must equal "${RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA}".`
    );
  }
  const providersRaw = asObject(envelope.providers);
  if (providersRaw === null) {
    throw new Error("secretRefs.refs.runtime_provider_credentials.providers must be an object.");
  }
  const providers: RuntimeProviderCredentialRefsEnvelope["providers"] = {};
  for (const [key, value] of Object.entries(providersRaw)) {
    if (!isChatRoutingProvider(key)) {
      throw new Error(
        `secretRefs.refs.runtime_provider_credentials.providers.${key} is not supported in H1.`
      );
    }
    providers[key] = parseRuntimeProviderCredentialRefState(
      value,
      `secretRefs.refs.runtime_provider_credentials.providers.${key}`
    );
  }
  return {
    schema: RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA,
    providers
  };
}

function parseRuntimeProviderProfileSelection(
  value: unknown,
  path: string
): RuntimeProviderProfileSelection {
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object.`);
  }
  return {
    provider: normalizeManagedRuntimeProvider(row.provider, `${path}.provider`),
    model: normalizeModelId(row.model, `${path}.model`)
  };
}

function parseRuntimeProviderProfilePolicy(
  policyEnvelope: unknown
): RuntimeProviderProfilePolicy | null {
  const root = asObject(policyEnvelope);
  const profile = asObject(root?.runtimeProviderProfile ?? root?.runtime_provider_profile ?? null);
  if (profile === null) {
    return null;
  }
  if (profile.schema !== RUNTIME_PROVIDER_PROFILE_SCHEMA) {
    throw new Error(
      `policyEnvelope.runtimeProviderProfile.schema must equal "${RUNTIME_PROVIDER_PROFILE_SCHEMA}".`
    );
  }
  const primary = parseRuntimeProviderProfileSelection(
    profile.primary,
    "policyEnvelope.runtimeProviderProfile.primary"
  );
  const fallbackRaw = profile.fallback;
  const fallback =
    fallbackRaw === undefined || fallbackRaw === null
      ? null
      : parseRuntimeProviderProfileSelection(
          fallbackRaw,
          "policyEnvelope.runtimeProviderProfile.fallback"
        );
  const availableModelsByProvider = parseAvailableModelsByProvider(
    profile.availableModelsByProvider
  );
  return {
    schema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
    availableModelsByProvider,
    availableModelCatalogByProvider: parseModelCatalogByProvider(
      profile.availableModelCatalogByProvider,
      availableModelsByProvider
    ),
    primary,
    fallback
  };
}

export function hasRuntimeProviderProfilePatch(policyEnvelope: unknown): boolean {
  const row = asObject(policyEnvelope);
  return (
    row !== null &&
    (row.runtimeProviderProfile !== undefined || row.runtime_provider_profile !== undefined)
  );
}

export function hasRuntimeProviderCredentialRefsPatch(secretRefs: unknown): boolean {
  const root = asObject(secretRefs);
  const refs = asObject(root?.refs);
  return (
    refs !== null &&
    (refs.runtime_provider_credentials !== undefined ||
      refs.runtimeProviderCredentials !== undefined)
  );
}

export function parseRuntimeProviderCredentialRefs(
  secretRefs: unknown
): RuntimeProviderCredentialRefsEnvelope | null {
  return parseRuntimeProviderCredentialRefsEnvelope(secretRefs);
}

export function resolveRuntimeProviderProfileState(params: {
  policyEnvelope: unknown | null;
  secretRefs: unknown | null;
}): RuntimeProviderProfileState {
  const credentials = parseRuntimeProviderCredentialRefsEnvelope(params.secretRefs);
  const profile = parseRuntimeProviderProfilePolicy(params.policyEnvelope);
  if (profile === null) {
    return {
      schema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
      mode: "unconfigured_default",
      derivedFrom: {
        policyEnvelopeSchema: null,
        secretRefsSchema: credentials?.schema ?? null
      },
      allowedProviders: [...CHAT_ROUTING_PROVIDERS],
      availableModelsByProvider: createEmptyAvailableModelsByProvider(),
      availableModelCatalogByProvider: createEmptyModelCatalogByProvider(),
      primary: null,
      fallback: null,
      notes: [
        "No admin-managed runtime provider profile is configured.",
        "The active runtime keeps its configured default model path until an admin-managed profile is saved."
      ]
    };
  }
  if (credentials === null) {
    throw new Error(
      "policyEnvelope.runtimeProviderProfile requires secretRefs.refs.runtime_provider_credentials."
    );
  }
  const primaryCredential = credentials.providers[profile.primary.provider];
  if (primaryCredential === undefined) {
    throw new Error(
      `Runtime provider profile primary provider "${profile.primary.provider}" requires secretRefs.refs.runtime_provider_credentials.providers.${profile.primary.provider}.`
    );
  }
  const fallbackCredential =
    profile.fallback === null ? null : credentials.providers[profile.fallback.provider];
  if (profile.fallback !== null && fallbackCredential === undefined) {
    throw new Error(
      `Runtime provider profile fallback provider "${profile.fallback.provider}" requires secretRefs.refs.runtime_provider_credentials.providers.${profile.fallback.provider}.`
    );
  }
  const resolvedFallback =
    profile.fallback === null
      ? null
      : {
          provider: profile.fallback.provider,
          model: profile.fallback.model,
          credentialRef: fallbackCredential as RuntimeProviderCredentialRefState
        };
  return {
    schema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
    mode: "admin_managed",
    derivedFrom: {
      policyEnvelopeSchema: profile.schema,
      secretRefsSchema: credentials.schema
    },
    allowedProviders: [...CHAT_ROUTING_PROVIDERS],
    availableModelsByProvider: profile.availableModelsByProvider,
    availableModelCatalogByProvider: profile.availableModelCatalogByProvider,
    primary: {
      provider: profile.primary.provider,
      model: profile.primary.model,
      credentialRef: primaryCredential
    },
    fallback: resolvedFallback,
    notes: [
      "Admin-managed runtime provider profile is active on the native runtime path.",
      "PersAI stores provider/model choice and credential refs in its own control plane."
    ]
  };
}

export function assertValidRuntimeProviderProfilePatch(params: {
  policyEnvelope: unknown | null;
  secretRefs: unknown | null;
}): void {
  const hasProfilePatch = hasRuntimeProviderProfilePatch(params.policyEnvelope);
  const hasCredentialPatch = hasRuntimeProviderCredentialRefsPatch(params.secretRefs);
  if (!hasProfilePatch && !hasCredentialPatch) {
    return;
  }
  if (hasProfilePatch && !hasCredentialPatch) {
    throw new Error(
      "targetPatch.secretRefs.refs.runtime_provider_credentials is required when targetPatch.policyEnvelope.runtimeProviderProfile is provided."
    );
  }
  if (!hasProfilePatch) {
    void parseRuntimeProviderCredentialRefsEnvelope(params.secretRefs);
    return;
  }
  void resolveRuntimeProviderProfileState({
    policyEnvelope: params.policyEnvelope,
    secretRefs: params.secretRefs
  });
}
