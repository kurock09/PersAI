import type {
  AdminRuntimeProviderSettingsRequest,
  AdminRuntimeProviderSettingsState,
  ManagedRuntimeProvider,
  RuntimeOptimizationPolicyState
} from "@persai/contracts";

export const MANAGED_RUNTIME_PROVIDERS: ManagedRuntimeProvider[] = ["openai", "anthropic"];

type RuntimeProviderSelectionDraft = {
  provider: ManagedRuntimeProvider;
  model: string;
};

type RuntimeProviderProviderKeyDraft = Record<ManagedRuntimeProvider, string>;
type RuntimeProviderAvailableModelsTextDraft = Record<ManagedRuntimeProvider, string>;
type RuntimeProviderProviderKeyState = NonNullable<
  AdminRuntimeProviderSettingsState["providerKeys"]
>;
export type RuntimeProviderSettingsProviderKeyState = RuntimeProviderProviderKeyState;

export type RuntimeProviderSettingsAdminDraft = {
  primary: RuntimeProviderSelectionDraft;
  fallbackEnabled: boolean;
  fallback: RuntimeProviderSelectionDraft;
  availableModelsTextByProvider: RuntimeProviderAvailableModelsTextDraft;
  providerKeys: RuntimeProviderProviderKeyDraft;
};

export type RuntimeProviderSettingsAdminFormState = {
  mode: AdminRuntimeProviderSettingsState["mode"];
  notes: string[];
  draft: RuntimeProviderSettingsAdminDraft;
  optimizationPolicy: RuntimeOptimizationPolicyState | null;
  providerKeyState: RuntimeProviderProviderKeyState;
};

function createDefaultOptimizationPolicy(): RuntimeOptimizationPolicyState {
  return {
    heartbeat: {
      every: "0m",
      target: "none",
      lightContext: true,
      isolatedSession: true
    },
    contextPruning: {
      mode: "cache-ttl",
      ttl: "5m",
      keepLastAssistants: 3,
      softTrimRatio: 0.3,
      hardClearRatio: 0.5,
      minPrunableToolChars: 12000,
      softTrim: {
        maxChars: 3000,
        headChars: 1000,
        tailChars: 1000
      },
      hardClear: {
        enabled: true,
        placeholder: "[Old tool result content cleared]"
      }
    },
    compaction: {
      mode: "safeguard",
      reserveTokens: 24000,
      keepRecentTokens: 16000,
      recentTurnsPreserve: 4,
      identifierPolicy: "strict",
      postIndexSync: "async",
      truncateAfterCompaction: true,
      suggestCompactionByMessageCount: false
    },
    openai: {
      fastMode: false,
      serviceTier: "default",
      responsesServerCompaction: true,
      openaiWsWarmup: true
    }
  };
}

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
    availableModelsTextByProvider: {
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

function toMultilineValue(values: string[]): string {
  return values.join("\n");
}

function parseModelCatalogText(value: string): string[] {
  const deduped = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const model = line.trim();
    if (model.length > 0) {
      deduped.add(model);
    }
  }
  return Array.from(deduped);
}

function providerLabel(provider: ManagedRuntimeProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

function hasListedModel(params: {
  provider: ManagedRuntimeProvider;
  model: string;
  availableModelsByProvider: RuntimeProviderAvailableModelsTextDraft;
}): boolean {
  const listedModels = parseModelCatalogText(params.availableModelsByProvider[params.provider]);
  return listedModels.includes(params.model.trim());
}

export function resolveRuntimeProviderSettingsAdminFormState(
  settings: AdminRuntimeProviderSettingsState | null | undefined
): RuntimeProviderSettingsAdminFormState {
  const draft = createDefaultRuntimeProviderSettingsAdminDraft();
  if (settings === null || settings === undefined) {
    return {
      mode: "legacy_openclaw_default",
      notes: [],
      draft,
      optimizationPolicy: createDefaultOptimizationPolicy(),
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
  draft.availableModelsTextByProvider = {
    openai: toMultilineValue(settings.availableModelsByProvider.openai),
    anthropic: toMultilineValue(settings.availableModelsByProvider.anthropic)
  };

  return {
    mode: settings.mode,
    notes: settings.notes,
    draft,
    optimizationPolicy: settings.optimizationPolicy,
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
      availableModelsByProvider: draft.availableModelsTextByProvider
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
      availableModelsByProvider: draft.availableModelsTextByProvider
    })
  ) {
    return `Fallback model must be listed under ${providerLabel(draft.fallback.provider)} available models.`;
  }
  return null;
}

export function buildRuntimeProviderSettingsRequest(params: {
  draft: RuntimeProviderSettingsAdminDraft;
  optimizationPolicy: RuntimeOptimizationPolicyState;
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

  const availableModelsByProvider = {
    openai: parseModelCatalogText(params.draft.availableModelsTextByProvider.openai),
    anthropic: parseModelCatalogText(params.draft.availableModelsTextByProvider.anthropic)
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
    optimizationPolicy: params.optimizationPolicy,
    fallback
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
