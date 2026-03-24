type SecretLifecyclePersistedStatus = "active" | "revoked" | "emergency_revoked";

export type SecretLifecycleComputedStatus =
  | SecretLifecyclePersistedStatus
  | "expired"
  | "legacy_unmanaged";

export type AssistantSecretRefEntry = {
  refKey: string;
  manager: "backend_vault_kms";
  providerKey: "telegram";
  surfaceType: "telegram_bot";
  version: number;
  status: SecretLifecyclePersistedStatus;
  rotatedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  emergencyRevokedAt: string | null;
  revokeReason: string | null;
  hints: {
    tokenFingerprintPrefix: string | null;
    tokenLastFour: string | null;
  };
};

export type AssistantSecretRefsEnvelope = {
  schema: "persai.secretRefs.v1";
  refs: {
    telegram_bot_token?: AssistantSecretRefEntry;
  };
};

export type TelegramSecretLifecycleState = {
  status: SecretLifecycleComputedStatus;
  refKey: string | null;
  manager: "backend_vault_kms" | null;
  version: number | null;
  rotatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  emergencyRevokedAt: string | null;
  revokeReason: string | null;
  legacyFallbackUsed: boolean;
};

const DEFAULT_SECRET_TTL_DAYS = 90;
const MAX_SECRET_TTL_DAYS = 365;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asIsoStringOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseTelegramSecretRefEntry(raw: unknown): AssistantSecretRefEntry | null {
  if (!isObject(raw)) {
    return null;
  }
  const refKey = asStringOrNull(raw.refKey);
  const manager = raw.manager === "backend_vault_kms" ? "backend_vault_kms" : null;
  const providerKey = raw.providerKey === "telegram" ? "telegram" : null;
  const surfaceType = raw.surfaceType === "telegram_bot" ? "telegram_bot" : null;
  const version = asPositiveInt(raw.version);
  const status =
    raw.status === "active" || raw.status === "revoked" || raw.status === "emergency_revoked"
      ? raw.status
      : null;
  const rotatedAt = asIsoStringOrNull(raw.rotatedAt);
  const expiresAt = asIsoStringOrNull(raw.expiresAt);
  const revokedAt = asIsoStringOrNull(raw.revokedAt);
  const emergencyRevokedAt = asIsoStringOrNull(raw.emergencyRevokedAt);
  const revokeReason = asStringOrNull(raw.revokeReason);
  const hints = isObject(raw.hints) ? raw.hints : {};
  const tokenFingerprintPrefix = asStringOrNull(hints.tokenFingerprintPrefix);
  const tokenLastFour = asStringOrNull(hints.tokenLastFour);
  if (
    refKey === null ||
    manager === null ||
    providerKey === null ||
    surfaceType === null ||
    version === null ||
    status === null ||
    rotatedAt === null
  ) {
    return null;
  }
  return {
    refKey,
    manager,
    providerKey,
    surfaceType,
    version,
    status,
    rotatedAt,
    expiresAt,
    revokedAt,
    emergencyRevokedAt,
    revokeReason,
    hints: {
      tokenFingerprintPrefix,
      tokenLastFour
    }
  };
}

function toTtlDays(ttlDays: number | null | undefined): number {
  if (ttlDays === null || ttlDays === undefined) {
    return DEFAULT_SECRET_TTL_DAYS;
  }
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > MAX_SECRET_TTL_DAYS) {
    throw new Error(`ttlDays must be an integer between 1 and ${MAX_SECRET_TTL_DAYS}.`);
  }
  return ttlDays;
}

function toExpiry(now: Date, ttlDays: number): string {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
}

function toComputedStatus(
  entry: AssistantSecretRefEntry,
  now: Date
): SecretLifecycleComputedStatus {
  if (entry.status !== "active") {
    return entry.status;
  }
  if (entry.expiresAt !== null) {
    const expiresAt = new Date(entry.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
      return "expired";
    }
  }
  return "active";
}

export function resolveAssistantSecretRefsEnvelope(raw: unknown): AssistantSecretRefsEnvelope {
  const root = isObject(raw) ? raw : {};
  const refsRaw = isObject(root.refs) ? root.refs : {};
  const telegramEntry = parseTelegramSecretRefEntry(refsRaw.telegram_bot_token);
  const refs: AssistantSecretRefsEnvelope["refs"] = {};
  if (telegramEntry !== null) {
    refs.telegram_bot_token = telegramEntry;
  }
  return {
    schema: "persai.secretRefs.v1",
    refs
  };
}

export function rotateTelegramBotSecretRef(
  raw: unknown,
  params: {
    assistantId: string;
    tokenFingerprintPrefix: string | null;
    tokenLastFour: string | null;
    ttlDays?: number | null;
    now?: Date;
  }
): AssistantSecretRefsEnvelope {
  const now = params.now ?? new Date();
  const envelope = resolveAssistantSecretRefsEnvelope(raw);
  const current = envelope.refs.telegram_bot_token;
  const nextVersion = (current?.version ?? 0) + 1;
  const ttlDays = toTtlDays(params.ttlDays ?? null);
  envelope.refs.telegram_bot_token = {
    refKey: `vault://assistants/${params.assistantId}/telegram_bot_token/v${nextVersion}`,
    manager: "backend_vault_kms",
    providerKey: "telegram",
    surfaceType: "telegram_bot",
    version: nextVersion,
    status: "active",
    rotatedAt: now.toISOString(),
    expiresAt: toExpiry(now, ttlDays),
    revokedAt: null,
    emergencyRevokedAt: null,
    revokeReason: null,
    hints: {
      tokenFingerprintPrefix: params.tokenFingerprintPrefix,
      tokenLastFour: params.tokenLastFour
    }
  };
  return envelope;
}

export function revokeTelegramBotSecretRef(
  raw: unknown,
  params: {
    emergency: boolean;
    reason: string | null;
    now?: Date;
  }
): AssistantSecretRefsEnvelope {
  const now = params.now ?? new Date();
  const envelope = resolveAssistantSecretRefsEnvelope(raw);
  const current = envelope.refs.telegram_bot_token;
  if (current === undefined) {
    return envelope;
  }
  envelope.refs.telegram_bot_token = {
    ...current,
    status: params.emergency ? "emergency_revoked" : "revoked",
    revokedAt: now.toISOString(),
    emergencyRevokedAt: params.emergency ? now.toISOString() : null,
    revokeReason: params.reason
  };
  return envelope;
}

export function resolveTelegramSecretLifecycleState(
  raw: unknown,
  params?: {
    now?: Date;
    legacyFallbackWhenMissing?: boolean;
  }
): TelegramSecretLifecycleState {
  const now = params?.now ?? new Date();
  const legacyFallback = params?.legacyFallbackWhenMissing === true;
  const envelope = resolveAssistantSecretRefsEnvelope(raw);
  const current = envelope.refs.telegram_bot_token;
  if (current === undefined) {
    if (legacyFallback) {
      return {
        status: "legacy_unmanaged",
        refKey: null,
        manager: null,
        version: null,
        rotatedAt: null,
        expiresAt: null,
        revokedAt: null,
        emergencyRevokedAt: null,
        revokeReason: null,
        legacyFallbackUsed: true
      };
    }
    return {
      status: "revoked",
      refKey: null,
      manager: null,
      version: null,
      rotatedAt: null,
      expiresAt: null,
      revokedAt: null,
      emergencyRevokedAt: null,
      revokeReason: null,
      legacyFallbackUsed: false
    };
  }
  return {
    status: toComputedStatus(current, now),
    refKey: current.refKey,
    manager: current.manager,
    version: current.version,
    rotatedAt: current.rotatedAt,
    expiresAt: current.expiresAt,
    revokedAt: current.revokedAt,
    emergencyRevokedAt: current.emergencyRevokedAt,
    revokeReason: current.revokeReason,
    legacyFallbackUsed: false
  };
}

export function isTelegramSecretUsable(raw: unknown, params?: { now?: Date }): boolean {
  const lifecycle = resolveTelegramSecretLifecycleState(
    raw,
    params?.now === undefined
      ? undefined
      : {
          now: params.now
        }
  );
  return lifecycle.status === "active";
}
