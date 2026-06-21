import {
  RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA,
  CHAT_ROUTING_PROVIDERS,
  DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
  RUNTIME_PROVIDER_BILLING_MODES,
  RUNTIME_PROVIDER_MODEL_CAPABILITIES,
  RUNTIME_PROVIDER_PROFILE_SCHEMA,
  RUNTIME_PROVIDER_TIME_PRICE_UNITS,
  MODEL_CAPABILITY_DEFAULTS,
  type ChatRoutingRuntimeProvider,
  type ManagedRuntimeCatalogProvider,
  createDefaultRuntimeProviderPriceMetadata,
  type ManagedRuntimeProvider,
  type RuntimeProviderAvailableModelsByProvider,
  type RuntimeProviderBillingMode,
  type RuntimeProviderModelCapability,
  type RuntimeProviderModelCatalogByProvider,
  type RuntimeProviderModelProfile,
  RUNTIME_PROVIDER_PROMPT_CACHE_RETENTIONS,
  type RuntimeProviderPriceMetadata,
  type RuntimeProviderPromptCacheRetention,
  type RuntimeProviderTextCharsMeteredPriceConfig,
  type RuntimeProviderTokenMeteredPriceConfig,
  type RuntimeProviderTimeMeteredPriceConfig,
  type RuntimeProviderFixedOperationPriceConfig,
  type RuntimeProviderTieredOperationPriceConfig,
  type RuntimeProviderTierPriceMetadata,
  type RuntimeProviderCredentialRefState,
  type RuntimeProviderProfileState,
  type RuntimeVideoModelKind
} from "./runtime-provider-profile";
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

export const PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID = "global";
export const PLATFORM_RUNTIME_PROVIDER_SETTINGS_SCHEMA = "persai.adminRuntimeProviderSettings.v2";
export const PERSAI_RUNTIME_SECRET_PROVIDER_ALIAS = "persai-runtime";

/**
 * ADR-108 Slice 1 — default platform Vcoin exchange rate (integer VC per 1
 * USD). Stored on `PlatformRuntimeProviderSettings.vcoinExchangeRate`; this
 * constant is used as the fallback when the persisted JSON omits the field
 * (legacy rows from before Slice 1 landed). Per ADR-108 line 47 the course
 * is platform-level: `1 USD = 20 VC` ⇒ `1 VC = $0.05`. Slices 2/3/4 wire
 * the actual debit/credit paths; this slice is contract-carrying only.
 */
export const DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE = 20;

export const PERSAI_RUNTIME_PROVIDER_SECRET_IDS: Record<ManagedRuntimeProvider, string> = {
  openai: "openai/api-key",
  anthropic: "anthropic/api-key",
  deepseek: "deepseek/api-key"
};

const MAX_MODEL_LENGTH = 256;
const MAX_MODELS_PER_PROVIDER = 64;
const MAX_PROVIDER_KEY_LENGTH = 512;
const MAX_ROUTER_OVERRIDE_ITEMS = 32;
const MAX_ROUTER_OVERRIDE_ENTRY_LENGTH = 128;
const MAX_MODEL_DISPLAY_LABEL_LENGTH = 128;
const MAX_MODEL_NOTES_LENGTH = 512;
const MAX_TOKEN_WEIGHT = 1_000_000;
/**
 * ADR-122 D1 — upper bounds for model capability integers. Large enough to
 * accommodate any near-future model while rejecting obviously-malformed saves.
 */
const MAX_CONTEXT_WINDOW_VALUE = 2_000_000;
const MAX_OUTPUT_TOKENS_VALUE = 1_000_000;
const MAX_PRICE_LABEL_LENGTH = 128;
const MAX_TIER_COUNT = 16;
/**
 * ADR-108 Slice 1 — defensive upper bound on the platform Vcoin exchange
 * rate. The product course is `1 USD = 20 VC`; the cap exists to reject
 * obviously-malformed admin saves (negative, fractional, or absurdly large
 * values). Slice 1 does not constrain this beyond honesty.
 */
const MAX_PLATFORM_VCOIN_EXCHANGE_RATE = 1_000_000;

/**
 * ADR-109 Slice 5 — default and cap for HeyGen persona platform knobs.
 *
 * `DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT` — maximum active personas per
 * workspace (10 default, matches the HeyGen free-tier avatar headcount).
 *
 * `DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN` — VC cost to create one persona
 * (20 VC default; mirrors the `1 VC = $0.05` course → $1.00 per persona,
 * aligning with HeyGen's per-avatar billing). Can be set to 0 to make
 * creation free for operator use.
 */
export const DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT = 10;
export const DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN = 20;
const MAX_HEYGEN_PERSONA_WORKSPACE_LIMIT = 1_000;
const MAX_HEYGEN_PERSONA_CREATION_VCOIN = 1_000_000;
export const DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT = 5;
export const DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN = 50;
const MAX_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT = 10;
const MAX_HEYGEN_VOICE_CLONE_CREATION_VCOIN = 1_000_000;

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
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  availableModelCatalogByProvider: RuntimeProviderModelCatalogByProvider;
  providerKeys: Record<ManagedRuntimeProvider, PlatformRuntimeProviderKeyMetadata>;
  /**
   * ADR-108 Slice 1 — platform Vcoin exchange rate (integer VC per 1 USD).
   * Always a positive integer; the resolver defaults to
   * `DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE` (20) when the persisted record
   * omits the field. Slices 2/3/4 will wire the actual debit/credit paths;
   * this field is contract-carrying only in Slice 1.
   */
  vcoinExchangeRate: number;
  /**
   * ADR-109 Slice 5 — maximum number of active (non-archived) personas
   * allowed per workspace. Operator-editable in Admin > Runtime. Defaults
   * to `DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT` (10) when the persisted
   * record omits the field.
   */
  heygenPersonaWorkspaceLimit: number;
  /**
   * ADR-109 Slice 5 — VC cost to create one persona. Non-negative integer.
   * When 0, creation is free (no ledger event recorded). Defaults to
   * `DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN` (20) when omitted.
   * `1 VC ≈ $0.05`, so the default is $1.00 per persona.
   */
  heygenPersonaCreationVcoin: number;
  /**
   * ADR-111 Slice 3 — maximum number of active (non-archived) cloned voices
   * allowed per workspace. Defaults to
   * `DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT` (5) when the persisted
   * record omits the field.
   */
  heygenVoiceCloneWorkspaceLimit: number;
  /**
   * ADR-111 Slice 3 — VC cost to create one cloned voice. Non-negative
   * integer. When 0, clone creation is free. Defaults to
   * `DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN` (50) when omitted.
   */
  heygenVoiceCloneCreationVcoin: number;
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
  /**
   * ADR-108 Slice 1 — persisted platform Vcoin exchange rate. Nullable on
   * the record shape so legacy rows (pre-Slice 1) and missing-column reads
   * resolve to the platform default via `DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE`.
   */
  vcoinExchangeRate: number | null;
  /**
   * ADR-109 Slice 5 — persisted max active personas per workspace.
   * Nullable so rows predating Slice 5 resolve to the platform default.
   */
  heygenPersonaWorkspaceLimit: number | null;
  /**
   * ADR-109 Slice 5 — persisted persona creation VC cost.
   * Nullable so rows predating Slice 5 resolve to the platform default.
   */
  heygenPersonaCreationVcoin: number | null;
  /**
   * ADR-111 Slice 3 — persisted max active cloned voices per workspace.
   * Nullable so rows predating Slice 3 resolve to the platform default.
   */
  heygenVoiceCloneWorkspaceLimit: number | null;
  /**
   * ADR-111 Slice 3 — persisted cloned voice creation VC cost.
   * Nullable so rows predating Slice 3 resolve to the platform default.
   */
  heygenVoiceCloneCreationVcoin: number | null;
};

export type UpdatePlatformRuntimeProviderSettingsInput = {
  primary: PlatformRuntimeProviderSelection;
  fallback: PlatformRuntimeProviderSelection | null;
  routingFastModelKey: string | null;
  routerPolicy: PlatformRuntimeRouterPolicy;
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
  availableModelCatalogByProvider: RuntimeProviderModelCatalogByProvider;
  providerKeys: Partial<Record<ManagedRuntimeProvider, string>>;
  /**
   * ADR-108 Slice 1 — platform Vcoin exchange rate carried through the
   * admin save path. Optional on input; missing values are treated as
   * `DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE` (20). Slice 5 owns the admin UI
   * surface for editing this; Slice 1 only round-trips the value.
   */
  vcoinExchangeRate: number;
  /**
   * ADR-109 Slice 5 — max active personas per workspace. Positive integer.
   * Defaults to `DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT` (10) when omitted.
   */
  heygenPersonaWorkspaceLimit: number;
  /**
   * ADR-109 Slice 5 — VC cost to create one persona. Non-negative integer.
   * Defaults to `DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN` (20) when omitted.
   */
  heygenPersonaCreationVcoin: number;
  /**
   * ADR-111 Slice 3 — max active cloned voices per workspace. Positive
   * integer. Defaults to `DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT` (5)
   * when omitted.
   */
  heygenVoiceCloneWorkspaceLimit: number;
  /**
   * ADR-111 Slice 3 — VC cost to create one cloned voice. Non-negative
   * integer. Defaults to `DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN` (50)
   * when omitted.
   */
  heygenVoiceCloneCreationVcoin: number;
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
    anthropic: [],
    deepseek: []
  };
}

export function createEmptyAvailableModelCatalogByProvider(): RuntimeProviderModelCatalogByProvider {
  return {
    openai: { models: [] },
    anthropic: { models: [] },
    deepseek: { models: [] },
    runway: { models: [] },
    kling: { models: [] },
    heygen: { models: [] }
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
    },
    deepseek: {
      configured: false,
      lastFour: null,
      updatedAt: null
    }
  };
}

function normalizeProvider(value: unknown, path: string): ManagedRuntimeProvider {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === "openai" || normalized === "anthropic" || normalized === "deepseek") {
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

function normalizePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return value;
}

function normalizeVideoAspectRatio(value: unknown, path: string): PersaiRuntimeVideoAspectRatio {
  if (PERSAI_RUNTIME_VIDEO_ASPECT_RATIOS.includes(value as PersaiRuntimeVideoAspectRatio)) {
    return value as PersaiRuntimeVideoAspectRatio;
  }
  throw new Error(`${path} must be one of: ${PERSAI_RUNTIME_VIDEO_ASPECT_RATIOS.join(", ")}.`);
}

function normalizeVideoSize(value: unknown, path: string): PersaiRuntimeVideoGenerateSize {
  if (PERSAI_RUNTIME_VIDEO_GENERATE_SIZES.includes(value as PersaiRuntimeVideoGenerateSize)) {
    return value as PersaiRuntimeVideoGenerateSize;
  }
  throw new Error(`${path} must be one of: ${PERSAI_RUNTIME_VIDEO_GENERATE_SIZES.join(", ")}.`);
}

function normalizeVideoDurationConstraint(
  value: unknown,
  path: string
): RuntimeVideoDurationConstraint {
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object.`);
  }
  const kind = asNonEmptyString(row.kind);
  if (kind === "allowed_list") {
    if (!Array.isArray(row.values) || row.values.length === 0) {
      throw new Error(`${path}.values must be a non-empty array.`);
    }
    return {
      kind: "allowed_list",
      values: Array.from(
        new Set(
          row.values.map((entry, index) =>
            normalizePositiveInteger(entry, `${path}.values[${String(index)}]`)
          )
        )
      ).sort((left, right) => left - right)
    };
  }
  if (kind === "range") {
    const min = normalizePositiveInteger(row.min, `${path}.min`);
    const max = normalizePositiveInteger(row.max, `${path}.max`);
    if (max < min) {
      throw new Error(`${path}.max must be greater than or equal to min.`);
    }
    const step =
      row.step === null || row.step === undefined
        ? null
        : normalizePositiveInteger(row.step, `${path}.step`);
    const preferredValues =
      row.preferredValues === undefined || row.preferredValues === null
        ? null
        : Array.from(
            new Set(
              (Array.isArray(row.preferredValues) ? row.preferredValues : []).map((entry, index) =>
                normalizePositiveInteger(entry, `${path}.preferredValues[${String(index)}]`)
              )
            )
          )
            .filter((entry) => entry >= min && entry <= max)
            .sort((left, right) => left - right);
    return {
      kind: "range",
      min,
      max,
      step,
      preferredValues:
        preferredValues !== null && preferredValues.length > 0 ? preferredValues : null
    };
  }
  throw new Error(`${path}.kind must be "allowed_list" or "range".`);
}

function normalizeVideoAspectRatioOptions(
  value: unknown,
  path: string
): RuntimeVideoAspectRatioOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array.`);
  }
  return value.map((entry, index) => {
    const row = asObject(entry);
    const entryPath = `${path}[${String(index)}]`;
    if (row === null) {
      throw new Error(`${entryPath} must be an object.`);
    }
    return {
      aspectRatio: normalizeVideoAspectRatio(row.aspectRatio, `${entryPath}.aspectRatio`),
      size: normalizeVideoSize(row.size, `${entryPath}.size`),
      providerValue:
        row.providerValue === undefined
          ? null
          : normalizeOptionalBoundedString(row.providerValue, `${entryPath}.providerValue`, 64)
    };
  });
}

function normalizeVideoProviderParameters(
  value: unknown,
  path: string
): RuntimeVideoProviderParameters | null {
  const row = asObject(value);
  if (row === null) {
    return null;
  }
  const mode =
    row.mode === undefined ? null : normalizeOptionalBoundedString(row.mode, `${path}.mode`, 64);
  const sound =
    row.sound === undefined || row.sound === null
      ? null
      : row.sound === "on" || row.sound === "off"
        ? row.sound
        : (() => {
            throw new Error(`${path}.sound must be "on", "off", or null.`);
          })();
  const audio =
    row.audio === undefined || row.audio === null
      ? null
      : typeof row.audio === "boolean"
        ? row.audio
        : (() => {
            throw new Error(`${path}.audio must be true, false, or null.`);
          })();
  const resolution =
    row.resolution === undefined || row.resolution === null
      ? null
      : row.resolution === "720p" || row.resolution === "1080p" || row.resolution === "4k"
        ? row.resolution
        : (() => {
            throw new Error(`${path}.resolution must be "720p", "1080p", "4k", or null.`);
          })();
  const aspectRatio =
    row.aspectRatio === undefined || row.aspectRatio === null
      ? null
      : row.aspectRatio === "auto" ||
          row.aspectRatio === "16:9" ||
          row.aspectRatio === "9:16" ||
          row.aspectRatio === "1:1" ||
          row.aspectRatio === "4:5" ||
          row.aspectRatio === "5:4"
        ? row.aspectRatio
        : (() => {
            throw new Error(
              `${path}.aspectRatio must be "auto", "16:9", "9:16", "1:1", "4:5", "5:4", or null.`
            );
          })();
  const engine =
    row.engine === undefined || row.engine === null
      ? null
      : row.engine === "avatar_iv" || row.engine === "avatar_v"
        ? row.engine
        : (() => {
            throw new Error(`${path}.engine must be "avatar_iv", "avatar_v", or null.`);
          })();
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

function validateVideoCapabilityCombination(params: {
  audioCapabilities: RuntimeVideoAudioCapability[];
  inputCapabilities: RuntimeVideoInputCapability[];
  referenceImageSupported: boolean;
  providerParameters: RuntimeVideoProviderParameters | null;
  path: string;
}): void {
  const audioCapabilities = new Set(params.audioCapabilities);
  const inputCapabilities = new Set(params.inputCapabilities);

  if (inputCapabilities.has("omni")) {
    throw new Error(
      `${params.path}.inputCapabilities cannot include "omni" because Omni is deferred and unsupported in ADR-107 Slice 2.`
    );
  }
  if (audioCapabilities.has("voice_control") && !audioCapabilities.has("provider_native_audio")) {
    throw new Error(
      `${params.path}.audioCapabilities cannot include "voice_control" without "provider_native_audio".`
    );
  }
  if (inputCapabilities.has("single_reference_image") !== params.referenceImageSupported) {
    throw new Error(
      `${params.path}.inputCapabilities must align "single_reference_image" with referenceImageSupported.`
    );
  }
  if (inputCapabilities.has("multi_image") && !params.referenceImageSupported) {
    throw new Error(
      `${params.path}.inputCapabilities cannot include "multi_image" when referenceImageSupported is false.`
    );
  }
  if (
    params.providerParameters?.sound === "on" &&
    !audioCapabilities.has("provider_native_audio")
  ) {
    throw new Error(
      `${params.path}.providerParameters.sound cannot be "on" unless "provider_native_audio" is enabled.`
    );
  }
  if (
    params.providerParameters?.audio === true &&
    !audioCapabilities.has("provider_native_audio")
  ) {
    throw new Error(
      `${params.path}.providerParameters.audio cannot be true unless "provider_native_audio" is enabled.`
    );
  }
}

function isRuntimeVideoAudioCapability(value: unknown): value is RuntimeVideoAudioCapability {
  return RUNTIME_VIDEO_AUDIO_CAPABILITIES.includes(value as RuntimeVideoAudioCapability);
}

function isRuntimeVideoInputCapability(value: unknown): value is RuntimeVideoInputCapability {
  return RUNTIME_VIDEO_INPUT_CAPABILITIES.includes(value as RuntimeVideoInputCapability);
}

function normalizeVideoAudioCapabilities(
  value: unknown,
  path: string
): RuntimeVideoAudioCapability[] {
  if (value === undefined) {
    return ["silent"];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of video audio capabilities.`);
  }
  const deduped = new Set<RuntimeVideoAudioCapability>();
  for (const [index, entry] of value.entries()) {
    if (!isRuntimeVideoAudioCapability(entry)) {
      throw new Error(
        `${path}[${String(index)}] must be one of: ${RUNTIME_VIDEO_AUDIO_CAPABILITIES.join(", ")}.`
      );
    }
    deduped.add(entry);
  }
  if (deduped.size === 0) {
    throw new Error(`${path} must include at least one video audio capability.`);
  }
  if (!deduped.has("silent")) {
    deduped.add("silent");
  }
  return Array.from(deduped);
}

function normalizeVideoInputCapabilities(
  value: unknown,
  path: string,
  referenceImageSupported: boolean
): RuntimeVideoInputCapability[] {
  if (value === undefined) {
    return referenceImageSupported ? ["text", "single_reference_image"] : ["text"];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of video input capabilities.`);
  }
  const deduped = new Set<RuntimeVideoInputCapability>();
  for (const [index, entry] of value.entries()) {
    if (!isRuntimeVideoInputCapability(entry)) {
      throw new Error(
        `${path}[${String(index)}] must be one of: ${RUNTIME_VIDEO_INPUT_CAPABILITIES.join(", ")}.`
      );
    }
    deduped.add(entry);
  }
  if (deduped.size === 0) {
    throw new Error(`${path} must include at least one video input capability.`);
  }
  if (!deduped.has("text")) {
    deduped.add("text");
  }
  if (deduped.has("single_reference_image") && !referenceImageSupported) {
    throw new Error(
      `${path} cannot include "single_reference_image" when referenceImageSupported is false.`
    );
  }
  if (referenceImageSupported && !deduped.has("single_reference_image")) {
    deduped.add("single_reference_image");
  }
  return Array.from(deduped);
}

function normalizeVideoModelParameters(value: unknown, path: string): RuntimeVideoModelParameters {
  const row = asObject(value);
  if (row === null) {
    throw new Error(`${path} must be an object.`);
  }
  const referenceImageSupported =
    row.referenceImageSupported === undefined
      ? false
      : normalizeBoolean(row.referenceImageSupported, `${path}.referenceImageSupported`);
  const normalized = {
    duration: normalizeVideoDurationConstraint(row.duration, `${path}.duration`),
    aspectRatios: normalizeVideoAspectRatioOptions(row.aspectRatios, `${path}.aspectRatios`),
    referenceImageSupported,
    audioCapabilities: normalizeVideoAudioCapabilities(
      row.audioCapabilities,
      `${path}.audioCapabilities`
    ),
    inputCapabilities: normalizeVideoInputCapabilities(
      row.inputCapabilities,
      `${path}.inputCapabilities`,
      referenceImageSupported
    ),
    providerParameters: normalizeVideoProviderParameters(
      row.providerParameters,
      `${path}.providerParameters`
    )
  };
  validateVideoCapabilityCombination({
    audioCapabilities: normalized.audioCapabilities,
    inputCapabilities: normalized.inputCapabilities,
    referenceImageSupported: normalized.referenceImageSupported,
    providerParameters: normalized.providerParameters,
    path
  });
  return normalized;
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
      : [],
    deepseek: Array.isArray(row.deepseek)
      ? normalizeAvailableModelList(row.deepseek, `${path}.deepseek`)
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
      deepseek: { models: createDefaultModelProfiles(chatFallback.deepseek, ["chat"]) },
      runway: { models: [] },
      kling: { models: [] },
      heygen: { models: [] }
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
    deepseek: normalizeProviderCatalog("deepseek"),
    runway: normalizeProviderCatalog("runway"),
    kling: normalizeProviderCatalog("kling"),
    heygen: normalizeProviderCatalog("heygen")
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
    anthropic: collectActiveChatModels(catalog.anthropic.models),
    deepseek: collectActiveChatModels(catalog.deepseek.models)
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

/**
 * ADR-122 D1 — validate an optional positive integer capability field.
 * Returns null for null/undefined. Rejects non-integer, ≤0, or values that
 * exceed the supplied upper bound. Used in normalizeModelProfiles() to validate
 * maxOutputTokens and contextWindow on admin saves.
 */
function normalizeOptionalPositiveInteger(
  value: unknown,
  path: string,
  options: { max: number }
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${path} must be a positive integer when provided.`);
  }
  if (value <= 0) {
    throw new Error(`${path} must be a positive integer when provided.`);
  }
  if (value > options.max) {
    throw new Error(`${path} must be at most ${String(options.max)}.`);
  }
  return value;
}

function normalizeOptionalPromptCacheRetention(
  value: unknown,
  path: string
): RuntimeProviderPromptCacheRetention | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    RUNTIME_PROVIDER_PROMPT_CACHE_RETENTIONS.includes(value as RuntimeProviderPromptCacheRetention)
  ) {
    return value as RuntimeProviderPromptCacheRetention;
  }
  throw new Error(
    `${path} must be one of: ${RUNTIME_PROVIDER_PROMPT_CACHE_RETENTIONS.join(", ")}.`
  );
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
                cacheCreationInputPer1M:
                  tokenPricingRow.cacheCreationInputPer1M === undefined ||
                  tokenPricingRow.cacheCreationInputPer1M === null
                    ? defaults.tokenPricing.cacheCreationInputPer1M
                    : normalizePriceNumber(
                        tokenPricingRow.cacheCreationInputPer1M,
                        `${path}.tokenPricing.cacheCreationInputPer1M`
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
      kind: (provider === "heygen" ? "talking_avatar" : "cinematic") as RuntimeVideoModelKind,
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
      // ADR-122 corrective: fold family default in at WRITE (admin-save + buildState
      // read) so a blank field on a KNOWN model is stored as the published ceiling.
      // Explicit admin value always wins; blank → family default; unknown model → null.
      maxOutputTokens:
        normalizeOptionalPositiveInteger(row.maxOutputTokens, `${entryPath}.maxOutputTokens`, {
          max: MAX_OUTPUT_TOKENS_VALUE
        }) ??
        MODEL_CAPABILITY_DEFAULTS[model]?.maxOutputTokens ??
        null,
      contextWindow:
        normalizeOptionalPositiveInteger(row.contextWindow, `${entryPath}.contextWindow`, {
          max: MAX_CONTEXT_WINDOW_VALUE
        }) ??
        MODEL_CAPABILITY_DEFAULTS[model]?.contextWindow ??
        null,
      promptCacheRetention:
        normalizeOptionalPromptCacheRetention(
          row.promptCacheRetention,
          `${entryPath}.promptCacheRetention`
        ) ??
        MODEL_CAPABILITY_DEFAULTS[model]?.promptCacheRetention ??
        null,
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
      videoModelParameters: capabilities.includes("video")
        ? normalizeVideoModelParameters(
            row.videoModelParameters,
            `${entryPath}.videoModelParameters`
          )
        : null
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

function assertNoDuplicateActiveVideoModelsAcrossProviders(
  catalogs: RuntimeProviderModelCatalogByProvider,
  path: string
): void {
  const providersByModel = new Map<string, Set<ManagedRuntimeCatalogProvider>>();
  for (const provider of ["openai", "runway", "kling"] as const) {
    for (const profile of catalogs[provider].models) {
      if (!profile.active || !profile.capabilities.includes("video")) {
        continue;
      }
      const providers =
        providersByModel.get(profile.model) ?? new Set<ManagedRuntimeCatalogProvider>();
      providers.add(provider);
      providersByModel.set(profile.model, providers);
    }
  }
  for (const [model, providers] of providersByModel.entries()) {
    if (providers.size > 1) {
      throw new Error(
        `${path} contains duplicate active video model id "${model}" across providers (${Array.from(
          providers
        ).join(", ")}). Bare plan video selections must stay unambiguous.`
      );
    }
  }
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
      promptCacheRetention: capabilityDefaults?.promptCacheRetention ?? null,
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
    const capabilityDefaults = MODEL_CAPABILITY_DEFAULTS[model] ?? null;
    const base = {
      model,
      capabilities: capabilityList,
      kind: (provider === "heygen" ? "talking_avatar" : "cinematic") as RuntimeVideoModelKind,
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      inputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      cachedInputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      outputTokenWeight: DEFAULT_RUNTIME_PROVIDER_MODEL_TOKEN_WEIGHT,
      maxOutputTokens: capabilityDefaults?.maxOutputTokens ?? null,
      contextWindow: capabilityDefaults?.contextWindow ?? null,
      promptCacheRetention: capabilityDefaults?.promptCacheRetention ?? null,
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
    const providerLabel =
      params.selection.provider === "openai"
        ? "OpenAI"
        : params.selection.provider === "anthropic"
          ? "Anthropic"
          : "DeepSeek";
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
  assertNoDuplicateActiveVideoModelsAcrossProviders(
    availableModelCatalogByProvider,
    "availableModelCatalogByProvider"
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
  const deepseekKey = normalizeProviderKeyInput(providerKeysRow?.deepseek, "providerKeys.deepseek");
  if (openaiKey !== undefined) {
    providerKeys.openai = openaiKey;
  }
  if (anthropicKey !== undefined) {
    providerKeys.anthropic = anthropicKey;
  }
  if (deepseekKey !== undefined) {
    providerKeys.deepseek = deepseekKey;
  }
  const vcoinExchangeRate = normalizeVcoinExchangeRate(row.vcoinExchangeRate, "vcoinExchangeRate");
  const heygenPersonaWorkspaceLimit = normalizeHeygenPersonaWorkspaceLimit(
    row.heygenPersonaWorkspaceLimit,
    "heygenPersonaWorkspaceLimit"
  );
  const heygenPersonaCreationVcoin = normalizeHeygenPersonaCreationVcoin(
    row.heygenPersonaCreationVcoin,
    "heygenPersonaCreationVcoin"
  );
  const heygenVoiceCloneWorkspaceLimit = normalizeHeygenVoiceCloneWorkspaceLimit(
    row.heygenVoiceCloneWorkspaceLimit,
    "heygenVoiceCloneWorkspaceLimit"
  );
  const heygenVoiceCloneCreationVcoin = normalizeHeygenVoiceCloneCreationVcoin(
    row.heygenVoiceCloneCreationVcoin,
    "heygenVoiceCloneCreationVcoin"
  );
  return {
    primary,
    fallback,
    routingFastModelKey,
    routerPolicy,
    availableModelsByProvider,
    availableModelCatalogByProvider,
    providerKeys,
    vcoinExchangeRate,
    heygenPersonaWorkspaceLimit,
    heygenPersonaCreationVcoin,
    heygenVoiceCloneWorkspaceLimit,
    heygenVoiceCloneCreationVcoin
  };
}

/**
 * ADR-108 Slice 1 — normalize and validate a platform-level Vcoin exchange
 * rate. Accepts:
 *   - `undefined` / `null` → returns `DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE`
 *     (20) so legacy admin payloads stay compatible.
 *   - positive integer ≤ `MAX_PLATFORM_VCOIN_EXCHANGE_RATE` → returned as-is.
 * Rejects non-integers, zero, negatives, and absurdly large values.
 */
function normalizeVcoinExchangeRate(value: unknown, path: string): number {
  if (value === undefined || value === null) {
    return DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  if (value > MAX_PLATFORM_VCOIN_EXCHANGE_RATE) {
    throw new Error(`${path} must be at most ${String(MAX_PLATFORM_VCOIN_EXCHANGE_RATE)}.`);
  }
  return value;
}

/**
 * ADR-108 Slice 1 — read-side coercion for the persisted exchange rate.
 * Used by `buildPlatformRuntimeProviderSettingsState` so a legacy row whose
 * `vcoinExchangeRate` column was added by migration without an admin save
 * (or that is otherwise missing/invalid) still surfaces a usable integer.
 */
function resolveStoredVcoinExchangeRate(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE;
  }
  if (value > MAX_PLATFORM_VCOIN_EXCHANGE_RATE) {
    return DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE;
  }
  return value;
}

/**
 * ADR-109 Slice 5 — normalize admin-input persona workspace limit.
 * Accepts `undefined`/`null` → returns `DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT`.
 * Rejects non-integers, zero, and negatives.
 */
function normalizeHeygenPersonaWorkspaceLimit(value: unknown, path: string): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  if (value > MAX_HEYGEN_PERSONA_WORKSPACE_LIMIT) {
    throw new Error(`${path} must be at most ${String(MAX_HEYGEN_PERSONA_WORKSPACE_LIMIT)}.`);
  }
  return value;
}

/**
 * ADR-109 Slice 5 — normalize admin-input persona creation VC cost.
 * Accepts `undefined`/`null` → returns `DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN`.
 * Rejects non-integers and negatives (0 is allowed: free creation).
 */
function normalizeHeygenPersonaCreationVcoin(value: unknown, path: string): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  if (value > MAX_HEYGEN_PERSONA_CREATION_VCOIN) {
    throw new Error(`${path} must be at most ${String(MAX_HEYGEN_PERSONA_CREATION_VCOIN)}.`);
  }
  return value;
}

/**
 * ADR-109 Slice 5 — read-side coercion for persisted persona limit.
 */
function resolveStoredHeygenPersonaWorkspaceLimit(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT;
  }
  if (value > MAX_HEYGEN_PERSONA_WORKSPACE_LIMIT) {
    return DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT;
  }
  return value;
}

/**
 * ADR-109 Slice 5 — read-side coercion for persisted persona creation cost.
 */
function resolveStoredHeygenPersonaCreationVcoin(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN;
  }
  if (value > MAX_HEYGEN_PERSONA_CREATION_VCOIN) {
    return DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN;
  }
  return value;
}

/**
 * ADR-111 Slice 3 — normalize admin-input cloned voice workspace limit.
 * Accepts `undefined`/`null` → returns `DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT`.
 * Rejects non-integers, zero, negatives, and values above the hard cap 10.
 */
function normalizeHeygenVoiceCloneWorkspaceLimit(value: unknown, path: string): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  if (value > MAX_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT) {
    throw new Error(`${path} must be at most ${String(MAX_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT)}.`);
  }
  return value;
}

/**
 * ADR-111 Slice 3 — normalize admin-input cloned voice creation VC cost.
 * Accepts `undefined`/`null` → returns `DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN`.
 * Rejects non-integers and negatives (0 is allowed: free creation).
 */
function normalizeHeygenVoiceCloneCreationVcoin(value: unknown, path: string): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  if (value > MAX_HEYGEN_VOICE_CLONE_CREATION_VCOIN) {
    throw new Error(`${path} must be at most ${String(MAX_HEYGEN_VOICE_CLONE_CREATION_VCOIN)}.`);
  }
  return value;
}

/**
 * ADR-111 Slice 3 — read-side coercion for persisted cloned voice limit.
 */
function resolveStoredHeygenVoiceCloneWorkspaceLimit(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT;
  }
  if (value > MAX_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT) {
    return DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT;
  }
  return value;
}

/**
 * ADR-111 Slice 3 — read-side coercion for persisted cloned voice creation cost.
 */
function resolveStoredHeygenVoiceCloneCreationVcoin(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN;
  }
  if (value > MAX_HEYGEN_VOICE_CLONE_CREATION_VCOIN) {
    return DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN;
  }
  return value;
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
      availableModelCatalogByProvider: createEmptyAvailableModelCatalogByProvider(),
      providerKeys: params.providerKeys,
      vcoinExchangeRate: DEFAULT_PLATFORM_VCOIN_EXCHANGE_RATE,
      heygenPersonaWorkspaceLimit: DEFAULT_HEYGEN_PERSONA_WORKSPACE_LIMIT,
      heygenPersonaCreationVcoin: DEFAULT_HEYGEN_PERSONA_CREATION_VCOIN,
      heygenVoiceCloneWorkspaceLimit: DEFAULT_HEYGEN_VOICE_CLONE_WORKSPACE_LIMIT,
      heygenVoiceCloneCreationVcoin: DEFAULT_HEYGEN_VOICE_CLONE_CREATION_VCOIN,
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
  const availableModelsFallback = normalizeAvailableModelsByProvider(
    params.settings.availableModelsByProvider
  );
  const availableModelCatalogByProvider = normalizeAvailableModelCatalogByProvider(
    params.settings.availableModelCatalogByProvider,
    availableModelsFallback
  );
  assertNoDuplicateActiveVideoModelsAcrossProviders(
    availableModelCatalogByProvider,
    "availableModelCatalogByProvider"
  );
  const availableModelsByProvider = deriveAvailableModelsFromProfileCatalog(
    availableModelCatalogByProvider
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
    availableModelCatalogByProvider,
    providerKeys: params.providerKeys,
    vcoinExchangeRate: resolveStoredVcoinExchangeRate(params.settings.vcoinExchangeRate),
    heygenPersonaWorkspaceLimit: resolveStoredHeygenPersonaWorkspaceLimit(
      params.settings.heygenPersonaWorkspaceLimit
    ),
    heygenPersonaCreationVcoin: resolveStoredHeygenPersonaCreationVcoin(
      params.settings.heygenPersonaCreationVcoin
    ),
    heygenVoiceCloneWorkspaceLimit: resolveStoredHeygenVoiceCloneWorkspaceLimit(
      params.settings.heygenVoiceCloneWorkspaceLimit
    ),
    heygenVoiceCloneCreationVcoin: resolveStoredHeygenVoiceCloneCreationVcoin(
      params.settings.heygenVoiceCloneCreationVcoin
    ),
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
      const label =
        provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "DeepSeek";
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
