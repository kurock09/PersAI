export const RUNTIME_PROVIDER_PROFILE_SCHEMA = "persai.runtimeProviderProfile.v1";
export const RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA = "persai.runtimeProviderCredentialRefs.v1";

export type ManagedRuntimeProvider = "openai" | "anthropic";
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

export type AdminManagedRuntimeProviderProfileState = {
  schema: typeof RUNTIME_PROVIDER_PROFILE_SCHEMA;
  mode: "admin_managed";
  derivedFrom: {
    policyEnvelopeSchema: typeof RUNTIME_PROVIDER_PROFILE_SCHEMA;
    secretRefsSchema: typeof RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA;
  };
  allowedProviders: ManagedRuntimeProvider[];
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
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
  mode: "legacy_openclaw_default";
  derivedFrom: {
    policyEnvelopeSchema: null;
    secretRefsSchema: typeof RUNTIME_PROVIDER_CREDENTIAL_REFS_SCHEMA | null;
  };
  allowedProviders: ManagedRuntimeProvider[];
  availableModelsByProvider: RuntimeProviderAvailableModelsByProvider;
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
  primary: RuntimeProviderProfileSelection;
  fallback: RuntimeProviderProfileSelection | null;
};

const ALLOWED_RUNTIME_PROVIDERS: ManagedRuntimeProvider[] = ["openai", "anthropic"];
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
  if (normalized === "openai" || normalized === "anthropic") {
    return normalized;
  }
  throw new Error(`${path} must be one of: ${ALLOWED_RUNTIME_PROVIDERS.join(", ")}.`);
}

function normalizeModelId(value: unknown, path: string): string {
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

function createEmptyAvailableModelsByProvider(): RuntimeProviderAvailableModelsByProvider {
  return {
    openai: [],
    anthropic: []
  };
}

function parseAvailableModelsByProvider(value: unknown): RuntimeProviderAvailableModelsByProvider {
  const result = createEmptyAvailableModelsByProvider();
  const row = asObject(value);
  if (row === null) {
    return result;
  }
  for (const provider of ALLOWED_RUNTIME_PROVIDERS) {
    const models = row[provider];
    if (!Array.isArray(models)) {
      continue;
    }
    const deduped = new Set<string>();
    for (const entry of models) {
      const model = asNonEmptyString(entry);
      if (model === null) {
        continue;
      }
      if (model.length > MAX_MODEL_LENGTH || containsControlCharacters(model)) {
        continue;
      }
      deduped.add(model);
    }
    result[provider] = Array.from(deduped);
  }
  return result;
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
  const secretRef = parseRuntimeCredentialSecretRef(
    row.secretRef ?? row.openclawSecretRef ?? row.ref,
    `${path}.secretRef`
  );
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
    if (key !== "openai" && key !== "anthropic") {
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
  return {
    schema: RUNTIME_PROVIDER_PROFILE_SCHEMA,
    availableModelsByProvider: parseAvailableModelsByProvider(profile.availableModelsByProvider),
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
      mode: "legacy_openclaw_default",
      derivedFrom: {
        policyEnvelopeSchema: null,
        secretRefsSchema: credentials?.schema ?? null
      },
      allowedProviders: [...ALLOWED_RUNTIME_PROVIDERS],
      availableModelsByProvider: createEmptyAvailableModelsByProvider(),
      primary: null,
      fallback: null,
      notes: [
        "No admin-managed runtime provider profile is configured.",
        "OpenClaw should keep its legacy configured default model path."
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
    allowedProviders: [...ALLOWED_RUNTIME_PROVIDERS],
    availableModelsByProvider: profile.availableModelsByProvider,
    primary: {
      provider: profile.primary.provider,
      model: profile.primary.model,
      credentialRef: primaryCredential
    },
    fallback: resolvedFallback,
    notes: [
      "Admin-managed runtime provider profile is active for the native OpenClaw apply/chat path.",
      "PersAI stores provider/model choice and credential refs; OpenClaw remains the runtime secret resolver."
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
