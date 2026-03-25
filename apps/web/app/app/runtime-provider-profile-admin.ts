import type { AssistantGovernanceState } from "@persai/contracts";

export const RUNTIME_PROVIDER_PROFILE_SCHEMA = "persai.runtimeProviderProfile.v1";
export const RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA = "persai.runtimeProviderCredentialRefs.v1";
export const ASSISTANT_SECRET_REFS_SCHEMA = "persai.secretRefs.v1";

export const MANAGED_RUNTIME_PROVIDERS = ["openai", "anthropic"] as const;
export const RUNTIME_SECRET_REF_SOURCES = ["env", "file", "exec"] as const;

export type ManagedRuntimeProvider = (typeof MANAGED_RUNTIME_PROVIDERS)[number];
export type RuntimeSecretRefSource = (typeof RUNTIME_SECRET_REF_SOURCES)[number];

export type RuntimeProviderSelectionDraft = {
  provider: ManagedRuntimeProvider;
  model: string;
};

export type RuntimeProviderCredentialDraft = {
  refKey: string;
  secretSource: RuntimeSecretRefSource;
  secretProvider: string;
  secretId: string;
};

export type RuntimeProviderAdminDraft = {
  primary: RuntimeProviderSelectionDraft;
  fallbackEnabled: boolean;
  fallback: RuntimeProviderSelectionDraft;
  credentials: Record<ManagedRuntimeProvider, RuntimeProviderCredentialDraft>;
};

export type RuntimeProviderAdminFormState = {
  mode: "legacy_openclaw_default" | "admin_managed";
  draft: RuntimeProviderAdminDraft;
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

function normalizeProvider(value: unknown): ManagedRuntimeProvider | null {
  return value === "openai" || value === "anthropic" ? value : null;
}

function normalizeSecretSource(value: unknown): RuntimeSecretRefSource {
  return value === "env" || value === "file" || value === "exec" ? value : "env";
}

function createEmptyCredentialDraft(): RuntimeProviderCredentialDraft {
  return {
    refKey: "",
    secretSource: "env",
    secretProvider: "",
    secretId: ""
  };
}

export function createDefaultRuntimeProviderAdminDraft(): RuntimeProviderAdminDraft {
  return {
    primary: {
      provider: "openai",
      model: ""
    },
    fallbackEnabled: false,
    fallback: {
      provider: "anthropic",
      model: ""
    },
    credentials: {
      openai: createEmptyCredentialDraft(),
      anthropic: createEmptyCredentialDraft()
    }
  };
}

function parseSelection(
  value: unknown,
  fallback: RuntimeProviderSelectionDraft
): RuntimeProviderSelectionDraft {
  const row = asObject(value);
  const provider = normalizeProvider(row?.provider) ?? fallback.provider;
  const model = asNonEmptyString(row?.model) ?? fallback.model;
  return {
    provider,
    model
  };
}

function parseCredentialDraft(
  value: unknown,
  fallback: RuntimeProviderCredentialDraft
): RuntimeProviderCredentialDraft {
  const row = asObject(value);
  const secretRef = asObject(row?.secretRef ?? row?.openclawSecretRef ?? row?.ref ?? null);
  return {
    refKey: asNonEmptyString(row?.refKey) ?? fallback.refKey,
    secretSource: normalizeSecretSource(secretRef?.source),
    secretProvider: asNonEmptyString(secretRef?.provider) ?? fallback.secretProvider,
    secretId: asNonEmptyString(secretRef?.id) ?? fallback.secretId
  };
}

export function resolveRuntimeProviderAdminFormState(
  governance: Pick<AssistantGovernanceState, "policyEnvelope" | "secretRefs"> | null | undefined
): RuntimeProviderAdminFormState {
  const draft = createDefaultRuntimeProviderAdminDraft();
  const policyEnvelope = asObject(governance?.policyEnvelope ?? null);
  const profile = asObject(
    policyEnvelope?.runtimeProviderProfile ?? policyEnvelope?.runtime_provider_profile ?? null
  );
  const secretRefs = asObject(governance?.secretRefs ?? null);
  const refs = asObject(secretRefs?.refs);
  const credentialEnvelope = asObject(
    refs?.runtime_provider_credentials ?? refs?.runtimeProviderCredentials ?? null
  );
  const providers = asObject(credentialEnvelope?.providers);

  draft.credentials.openai = parseCredentialDraft(providers?.openai, draft.credentials.openai);
  draft.credentials.anthropic = parseCredentialDraft(
    providers?.anthropic,
    draft.credentials.anthropic
  );

  if (profile === null || profile.schema !== RUNTIME_PROVIDER_PROFILE_SCHEMA) {
    return {
      mode: "legacy_openclaw_default",
      draft
    };
  }

  draft.primary = parseSelection(profile.primary, draft.primary);
  if (profile.fallback === null || profile.fallback === undefined) {
    draft.fallbackEnabled = false;
  } else {
    draft.fallbackEnabled = true;
    draft.fallback = parseSelection(profile.fallback, draft.fallback);
  }

  return {
    mode: "admin_managed",
    draft
  };
}

function isCredentialDraftComplete(value: RuntimeProviderCredentialDraft): boolean {
  return value.secretProvider.trim().length > 0 && value.secretId.trim().length > 0;
}

function isCredentialDraftTouched(value: RuntimeProviderCredentialDraft): boolean {
  return (
    value.refKey.trim().length > 0 ||
    value.secretProvider.trim().length > 0 ||
    value.secretId.trim().length > 0
  );
}

function providerLabel(provider: ManagedRuntimeProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

export function validateRuntimeProviderAdminDraft(draft: RuntimeProviderAdminDraft): string | null {
  if (draft.primary.model.trim().length === 0) {
    return "Primary model is required.";
  }

  if (draft.fallbackEnabled && draft.fallback.model.trim().length === 0) {
    return "Fallback model is required when fallback is enabled.";
  }

  const requiredProviders = new Set<ManagedRuntimeProvider>([draft.primary.provider]);
  if (draft.fallbackEnabled) {
    requiredProviders.add(draft.fallback.provider);
  }

  for (const provider of MANAGED_RUNTIME_PROVIDERS) {
    const credential = draft.credentials[provider];
    if (requiredProviders.has(provider) && !isCredentialDraftComplete(credential)) {
      return `${providerLabel(provider)} credential ref is required for the selected provider.`;
    }
    if (
      !requiredProviders.has(provider) &&
      isCredentialDraftTouched(credential) &&
      !isCredentialDraftComplete(credential)
    ) {
      return `Complete or clear the ${providerLabel(provider)} credential ref fields.`;
    }
  }

  return null;
}

function buildCredentialEntry(
  value: RuntimeProviderCredentialDraft
): Record<string, unknown> | null {
  if (!isCredentialDraftComplete(value)) {
    return null;
  }

  const entry: Record<string, unknown> = {
    secretRef: {
      source: value.secretSource,
      provider: value.secretProvider.trim(),
      id: value.secretId.trim()
    }
  };

  if (value.refKey.trim().length > 0) {
    entry.refKey = value.refKey.trim();
  }

  return entry;
}

export function buildRuntimeProviderRolloutPatch(params: {
  governance: Pick<AssistantGovernanceState, "policyEnvelope" | "secretRefs"> | null | undefined;
  draft: RuntimeProviderAdminDraft;
}): Record<string, unknown> {
  const policyEnvelope = asObject(params.governance?.policyEnvelope ?? null) ?? {};
  const secretRefs = asObject(params.governance?.secretRefs ?? null) ?? {};
  const refs = asObject(secretRefs.refs) ?? {};
  const providers: Record<string, unknown> = {};

  const validationError = validateRuntimeProviderAdminDraft(params.draft);
  if (validationError !== null) {
    throw new Error(validationError);
  }

  for (const provider of MANAGED_RUNTIME_PROVIDERS) {
    const entry = buildCredentialEntry(params.draft.credentials[provider]);
    if (entry !== null) {
      providers[provider] = entry;
    }
  }

  const nextPolicyEnvelope: Record<string, unknown> = { ...policyEnvelope };
  delete nextPolicyEnvelope.runtime_provider_profile;
  nextPolicyEnvelope.runtimeProviderProfile = {
    schema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
    primary: {
      provider: params.draft.primary.provider,
      model: params.draft.primary.model.trim()
    },
    fallback: params.draft.fallbackEnabled
      ? {
          provider: params.draft.fallback.provider,
          model: params.draft.fallback.model.trim()
        }
      : null
  };

  const nextRefs: Record<string, unknown> = { ...refs };
  delete nextRefs.runtimeProviderCredentials;
  nextRefs.runtime_provider_credentials = {
    schema: RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA,
    providers
  };

  return {
    policyEnvelope: nextPolicyEnvelope,
    secretRefs: {
      ...secretRefs,
      schema:
        typeof secretRefs.schema === "string" && secretRefs.schema.trim().length > 0
          ? secretRefs.schema
          : ASSISTANT_SECRET_REFS_SCHEMA,
      refs: nextRefs
    }
  };
}
