import type {
  AdminRuntimeProviderSettingsRequest,
  AdminRuntimeProviderSettingsState,
  ManagedRuntimeProvider,
  RuntimeProviderModelProfileState
} from "@persai/contracts";

export const MANAGED_RUNTIME_PROVIDERS: ManagedRuntimeProvider[] = ["openai", "anthropic"];

type RuntimeProviderSelectionDraft = {
  provider: ManagedRuntimeProvider;
  model: string;
};

type RuntimeProviderProviderKeyDraft = Record<ManagedRuntimeProvider, string>;
type RuntimeProviderModelProfilesTextDraft = Record<ManagedRuntimeProvider, string>;
type RuntimeProviderProviderKeyState = NonNullable<
  AdminRuntimeProviderSettingsState["providerKeys"]
>;
type RuntimeProviderBillingModeState = RuntimeProviderModelProfileState["billingMode"];
type RuntimeProviderModelProfileForMode<M extends RuntimeProviderBillingModeState> = Extract<
  RuntimeProviderModelProfileState,
  { billingMode: M }
>;
export type RuntimeProviderSettingsProviderKeyState = RuntimeProviderProviderKeyState;

export type RuntimeProviderSettingsAdminDraft = {
  primary: RuntimeProviderSelectionDraft;
  fallbackEnabled: boolean;
  fallback: RuntimeProviderSelectionDraft;
  modelProfilesTextByProvider: RuntimeProviderModelProfilesTextDraft;
  providerKeys: RuntimeProviderProviderKeyDraft;
};

export type RuntimeProviderSettingsAdminFormState = {
  mode: AdminRuntimeProviderSettingsState["mode"];
  notes: string[];
  draft: RuntimeProviderSettingsAdminDraft;
  providerKeyState: RuntimeProviderProviderKeyState;
};

function createEmptyProviderKeyState(): RuntimeProviderProviderKeyState {
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

export function createDefaultRuntimeProviderSettingsAdminDraft(): RuntimeProviderSettingsAdminDraft {
  return {
    primary: {
      provider: "openai",
      model: ""
    },
    fallbackEnabled: true,
    fallback: {
      provider: "anthropic",
      model: ""
    },
    modelProfilesTextByProvider: {
      openai: "",
      anthropic: ""
    },
    providerKeys: {
      openai: "",
      anthropic: ""
    }
  };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseCapabilityText(value: string): RuntimeProviderModelProfileState["capabilities"] {
  const deduped = new Set<string>();
  for (const entry of value.split(/[,+]/)) {
    const capability = entry.trim();
    if (
      capability === "chat" ||
      capability === "image" ||
      capability === "video" ||
      capability === "speech_to_text" ||
      capability === "text_to_speech"
    ) {
      deduped.add(capability);
    }
  }
  return Array.from(deduped) as RuntimeProviderModelProfileState["capabilities"];
}

function inferBillingMode(
  capabilities: RuntimeProviderModelProfileState["capabilities"]
): RuntimeProviderModelProfileState["billingMode"] {
  if (capabilities.includes("chat")) {
    return "token_metered";
  }
  if (capabilities.includes("speech_to_text")) {
    return "time_metered";
  }
  if (capabilities.includes("text_to_speech")) {
    return "text_chars_metered";
  }
  return "fixed_operation";
}

function createDefaultProviderPriceMetadata(
  billingMode: "token_metered"
): RuntimeProviderModelProfileForMode<"token_metered">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "time_metered"
): RuntimeProviderModelProfileForMode<"time_metered">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "text_chars_metered"
): RuntimeProviderModelProfileForMode<"text_chars_metered">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "fixed_operation"
): RuntimeProviderModelProfileForMode<"fixed_operation">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "tiered_operation"
): RuntimeProviderModelProfileForMode<"tiered_operation">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: RuntimeProviderBillingModeState
): RuntimeProviderModelProfileState["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: RuntimeProviderBillingModeState
): RuntimeProviderModelProfileState["providerPriceMetadata"] {
  switch (billingMode) {
    case "token_metered":
      return {
        currency: "USD",
        tokenPricing: {
          inputPer1M: 0,
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

export function formatRuntimeProviderModelProfilesText(
  profiles: RuntimeProviderModelProfileState[]
): string {
  return profiles
    .map((profile) =>
      [
        profile.model,
        profile.capabilities.join(","),
        String(profile.inputTokenWeight),
        String(profile.cachedInputTokenWeight),
        String(profile.outputTokenWeight),
        profile.displayLabel ?? ""
      ].join(" | ")
    )
    .join("\n");
}

export function parseRuntimeProviderModelProfilesText(
  value: string
): RuntimeProviderModelProfileState[] {
  const profiles: RuntimeProviderModelProfileState[] = [];
  const seen = new Set<string>();
  for (const [index, line] of value.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const [modelRaw, capabilitiesRaw, inputRaw, cachedRaw, outputRaw, labelRaw = ""] = trimmed
      .split("|")
      .map((entry) => entry.trim());
    if (!modelRaw) {
      throw new Error(`Model profile line ${String(index + 1)} is missing a model id.`);
    }
    if (seen.has(modelRaw)) {
      throw new Error(`Model profile line ${String(index + 1)} duplicates "${modelRaw}".`);
    }
    const capabilities = parseCapabilityText(capabilitiesRaw ?? "");
    if (capabilities.length === 0) {
      throw new Error(`Model profile line ${String(index + 1)} must include a capability.`);
    }
    const inputTokenWeight = Number(inputRaw);
    const cachedInputTokenWeight = Number(cachedRaw);
    const outputTokenWeight = Number(outputRaw);
    if (
      !Number.isFinite(inputTokenWeight) ||
      inputTokenWeight < 0 ||
      !Number.isFinite(cachedInputTokenWeight) ||
      cachedInputTokenWeight < 0 ||
      !Number.isFinite(outputTokenWeight) ||
      outputTokenWeight < 0
    ) {
      throw new Error(
        `Model profile line ${String(index + 1)} must include non-negative input, cached input, and output weights.`
      );
    }
    seen.add(modelRaw);
    const billingMode = inferBillingMode(capabilities);
    const base = {
      model: modelRaw,
      capabilities,
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      inputTokenWeight,
      cachedInputTokenWeight,
      outputTokenWeight,
      displayLabel: labelRaw.length > 0 ? labelRaw : null,
      notes: null
    };
    switch (billingMode) {
      case "token_metered":
        profiles.push({
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("token_metered")
        });
        break;
      case "time_metered":
        profiles.push({
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("time_metered")
        });
        break;
      case "text_chars_metered":
        profiles.push({
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("text_chars_metered")
        });
        break;
      case "fixed_operation":
        profiles.push({
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("fixed_operation")
        });
        break;
      case "tiered_operation":
        profiles.push({
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("tiered_operation")
        });
        break;
    }
  }
  return profiles;
}

function providerLabel(provider: ManagedRuntimeProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

function hasListedModel(params: {
  provider: ManagedRuntimeProvider;
  model: string;
  modelProfilesTextByProvider: RuntimeProviderModelProfilesTextDraft;
}): boolean {
  return parseRuntimeProviderModelProfilesText(params.modelProfilesTextByProvider[params.provider])
    .filter((profile) => profile.capabilities.includes("chat"))
    .some((profile) => profile.model === params.model.trim());
}

export function resolveRuntimeProviderSettingsAdminFormState(
  settings: AdminRuntimeProviderSettingsState | null | undefined
): RuntimeProviderSettingsAdminFormState {
  const draft = createDefaultRuntimeProviderSettingsAdminDraft();
  if (settings === null || settings === undefined) {
    return {
      mode: "unconfigured_default",
      notes: [],
      draft,
      providerKeyState: createEmptyProviderKeyState()
    };
  }

  draft.primary = {
    provider: settings.primary?.provider ?? draft.primary.provider,
    model: settings.primary?.model ?? draft.primary.model
  };
  draft.fallbackEnabled = settings.fallback !== null;
  draft.fallback = {
    provider: settings.fallback?.provider ?? draft.fallback.provider,
    model: settings.fallback?.model ?? draft.fallback.model
  };
  draft.modelProfilesTextByProvider = {
    openai: formatRuntimeProviderModelProfilesText(
      settings.availableModelCatalogByProvider.openai.models
    ),
    anthropic: formatRuntimeProviderModelProfilesText(
      settings.availableModelCatalogByProvider.anthropic.models
    )
  };

  return {
    mode: settings.mode,
    notes: settings.notes,
    draft,
    providerKeyState: settings.providerKeys
  };
}

export function validateRuntimeProviderSettingsAdminDraft(
  draft: RuntimeProviderSettingsAdminDraft
): string | null {
  if (draft.primary.model.trim().length === 0) {
    return "Primary model is required.";
  }
  if (
    !hasListedModel({
      provider: draft.primary.provider,
      model: draft.primary.model,
      modelProfilesTextByProvider: draft.modelProfilesTextByProvider
    })
  ) {
    return `Primary model must be listed under ${providerLabel(draft.primary.provider)} available models.`;
  }
  if (draft.fallbackEnabled && draft.fallback.model.trim().length === 0) {
    return "Fallback model is required when fallback is enabled.";
  }
  if (
    draft.fallbackEnabled &&
    !hasListedModel({
      provider: draft.fallback.provider,
      model: draft.fallback.model,
      modelProfilesTextByProvider: draft.modelProfilesTextByProvider
    })
  ) {
    return `Fallback model must be listed under ${providerLabel(draft.fallback.provider)} available models.`;
  }
  return null;
}

export function buildRuntimeProviderSettingsRequest(params: {
  draft: RuntimeProviderSettingsAdminDraft;
  providerKeyState: RuntimeProviderProviderKeyState;
}): AdminRuntimeProviderSettingsRequest {
  const validationError = validateRuntimeProviderSettingsAdminDraft(params.draft);
  if (validationError !== null) {
    throw new Error(validationError);
  }

  const primary = {
    provider: params.draft.primary.provider,
    model: params.draft.primary.model.trim()
  };
  const fallback = params.draft.fallbackEnabled
    ? {
        provider: params.draft.fallback.provider,
        model: params.draft.fallback.model.trim()
      }
    : null;

  const openaiProfiles = parseRuntimeProviderModelProfilesText(
    params.draft.modelProfilesTextByProvider.openai
  );
  const anthropicProfiles = parseRuntimeProviderModelProfilesText(
    params.draft.modelProfilesTextByProvider.anthropic
  );
  const availableModelsByProvider = {
    openai: openaiProfiles
      .filter((profile) => profile.capabilities.includes("chat"))
      .map((profile) => profile.model),
    anthropic: anthropicProfiles
      .filter((profile) => profile.capabilities.includes("chat"))
      .map((profile) => profile.model)
  };
  const availableModelCatalogByProvider = {
    openai: {
      models: openaiProfiles
    },
    anthropic: {
      models: anthropicProfiles
    }
  };

  const providerKeys: Partial<Record<ManagedRuntimeProvider, string>> = {};
  for (const provider of MANAGED_RUNTIME_PROVIDERS) {
    const maybeKey = asNonEmptyString(params.draft.providerKeys[provider]);
    if (maybeKey !== null) {
      providerKeys[provider] = maybeKey;
    }
  }

  const selectedProviders = new Set<ManagedRuntimeProvider>([primary.provider]);
  if (fallback !== null) {
    selectedProviders.add(fallback.provider);
  }
  for (const provider of selectedProviders) {
    if (!params.providerKeyState[provider].configured && providerKeys[provider] === undefined) {
      throw new Error(`${providerLabel(provider)} API key is required for the selected provider.`);
    }
  }

  const request: AdminRuntimeProviderSettingsRequest = {
    primary,
    availableModelsByProvider,
    availableModelCatalogByProvider,
    fallback,
    routingFastModelKey: null,
    routerPolicy: {
      enabled: false,
      mode: "shadow",
      classifierFailureFallbackMode: "normal",
      clarifyOnMissingContext: true,
      precheckRuleOverrides: null
    },
    skillRoutingPolicy: {
      initialCheckUserMessageIndex: 3,
      backgroundRecheckIntervalMessages: 5
    }
  };
  if (Object.keys(providerKeys).length > 0) {
    request.providerKeys = providerKeys;
  }
  return request;
}

export function formatRuntimeProviderKeyStatus(
  provider: ManagedRuntimeProvider,
  keyState: RuntimeProviderProviderKeyState
): string {
  const state = keyState[provider];
  if (!state.configured) {
    return `${providerLabel(provider)} key not configured yet.`;
  }
  const suffix = state.lastFour !== null ? ` ending in ${state.lastFour}` : "";
  const updatedAt =
    state.updatedAt !== null ? ` Updated ${new Date(state.updatedAt).toLocaleString()}.` : "";
  return `${providerLabel(provider)} key is configured${suffix}.${updatedAt}`;
}
