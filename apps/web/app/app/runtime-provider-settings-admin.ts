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
    if (capability === "chat" || capability === "image" || capability === "video") {
      deduped.add(capability);
    }
  }
  return Array.from(deduped) as RuntimeProviderModelProfileState["capabilities"];
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
    profiles.push({
      model: modelRaw,
      capabilities,
      inputTokenWeight,
      cachedInputTokenWeight,
      outputTokenWeight,
      displayLabel: labelRaw.length > 0 ? labelRaw : null,
      notes: null,
      providerPriceMetadata: null
    });
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
