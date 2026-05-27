import { randomInt, randomUUID } from "node:crypto";

export type TelegramClaimStatus = "not_started" | "pending" | "claimed";
export type TelegramConnectionStatus =
  | "connected"
  | "not_connected"
  | "claim_required"
  | "invalid_token";
export type TelegramRuntimeHealth = "ok" | "invalid_token";
export type TelegramAccessMode = "owner_only" | "group_members";

export const TELEGRAM_OWNER_CLAIM_CODE_LENGTH = 6;
export const TELEGRAM_OWNER_CLAIM_TTL_MS = 15 * 60_000;

export type TelegramBindingMetadataState = {
  telegramUserId: number | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  telegramAccessMode: TelegramAccessMode;
  telegramOwnerClaimStatus: TelegramClaimStatus;
  telegramOwnerClaimCode: string | null;
  telegramOwnerClaimIssuedAt: string | null;
  telegramOwnerClaimExpiresAt: string | null;
  telegramOwnerClaimedAt: string | null;
  telegramOwnerTelegramUserId: number | null;
  telegramOwnerTelegramUsername: string | null;
  telegramOwnerTelegramChatId: string | null;
  telegramSessionThreadKey: string;
  telegramSessionRotatedAt: string | null;
  telegramOwnerSystemWelcomeSentAt: string | null;
  telegramRuntimeHealth: TelegramRuntimeHealth;
  telegramRuntimeHealthUpdatedAt: string | null;
  telegramRuntimeHealthMessage: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toClaimStatus(value: unknown): TelegramClaimStatus {
  return value === "claimed" || value === "not_started" ? value : "pending";
}

function toRuntimeHealth(value: unknown): TelegramRuntimeHealth {
  return value === "invalid_token" ? "invalid_token" : "ok";
}

function toTelegramAccessMode(value: unknown): TelegramAccessMode {
  return value === "group_members" ? "group_members" : "owner_only";
}

export function createTelegramOwnerClaimCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(TELEGRAM_OWNER_CLAIM_CODE_LENGTH, "0");
}

export function createTelegramSessionThreadKey(): string {
  return randomUUID();
}

function createTelegramOwnerClaimExpiresAt(issuedAt: Date): string {
  return new Date(issuedAt.getTime() + TELEGRAM_OWNER_CLAIM_TTL_MS).toISOString();
}

export function isTelegramOwnerClaimExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts <= Date.now();
}

export function refreshTelegramOwnerClaimMetadata(metadata: unknown): Record<string, unknown> {
  const current = resolveTelegramBindingMetadataState(metadata);
  const claimIssuedAt = new Date();
  return {
    ...current,
    telegramOwnerClaimStatus: "pending",
    telegramOwnerClaimCode: createTelegramOwnerClaimCode(),
    telegramOwnerClaimIssuedAt: claimIssuedAt.toISOString(),
    telegramOwnerClaimExpiresAt: createTelegramOwnerClaimExpiresAt(claimIssuedAt),
    telegramOwnerClaimedAt: null,
    telegramOwnerTelegramUserId: null,
    telegramOwnerTelegramUsername: null,
    telegramOwnerTelegramChatId: null,
    telegramSessionThreadKey: current.telegramSessionThreadKey,
    telegramSessionRotatedAt: current.telegramSessionRotatedAt,
    telegramOwnerSystemWelcomeSentAt: null
  };
}

export function resolveTelegramBindingMetadataState(
  metadata: unknown,
  fallbackBot: {
    telegramUserId?: number | null;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  } = {}
): TelegramBindingMetadataState {
  const row = asObject(metadata);
  return {
    telegramUserId: toNumberOrNull(row?.telegramUserId) ?? fallbackBot.telegramUserId ?? null,
    username: toStringOrNull(row?.username) ?? fallbackBot.username ?? null,
    displayName: toStringOrNull(row?.displayName) ?? fallbackBot.displayName ?? null,
    avatarUrl: toStringOrNull(row?.avatarUrl) ?? fallbackBot.avatarUrl ?? null,
    telegramAccessMode: toTelegramAccessMode(row?.telegramAccessMode),
    telegramOwnerClaimStatus: toClaimStatus(row?.telegramOwnerClaimStatus),
    telegramOwnerClaimCode: toStringOrNull(row?.telegramOwnerClaimCode),
    telegramOwnerClaimIssuedAt: toStringOrNull(row?.telegramOwnerClaimIssuedAt),
    telegramOwnerClaimExpiresAt: toStringOrNull(row?.telegramOwnerClaimExpiresAt),
    telegramOwnerClaimedAt: toStringOrNull(row?.telegramOwnerClaimedAt),
    telegramOwnerTelegramUserId: toNumberOrNull(row?.telegramOwnerTelegramUserId),
    telegramOwnerTelegramUsername: toStringOrNull(row?.telegramOwnerTelegramUsername),
    telegramOwnerTelegramChatId: toStringOrNull(row?.telegramOwnerTelegramChatId),
    telegramSessionThreadKey: toStringOrNull(row?.telegramSessionThreadKey) ?? "default_session",
    telegramSessionRotatedAt: toStringOrNull(row?.telegramSessionRotatedAt),
    telegramOwnerSystemWelcomeSentAt: toStringOrNull(row?.telegramOwnerSystemWelcomeSentAt),
    telegramRuntimeHealth: toRuntimeHealth(row?.telegramRuntimeHealth),
    telegramRuntimeHealthUpdatedAt: toStringOrNull(row?.telegramRuntimeHealthUpdatedAt),
    telegramRuntimeHealthMessage: toStringOrNull(row?.telegramRuntimeHealthMessage)
  };
}

export function resolveTelegramConnectionStatus(params: {
  hasConnectedBinding: boolean;
  runtimeHealth: TelegramRuntimeHealth;
  claimStatus: TelegramClaimStatus;
}): TelegramConnectionStatus {
  if (!params.hasConnectedBinding) {
    return "not_connected";
  }
  if (params.runtimeHealth === "invalid_token") {
    return "invalid_token";
  }
  if (params.claimStatus !== "claimed") {
    return "claim_required";
  }
  return "connected";
}

export function applyTelegramRuntimeHealth(
  metadata: unknown,
  runtimeHealth: TelegramRuntimeHealth,
  message: string | null
): Record<string, unknown> {
  const current = resolveTelegramBindingMetadataState(metadata);
  return {
    ...current,
    telegramRuntimeHealth: runtimeHealth,
    telegramRuntimeHealthUpdatedAt: new Date().toISOString(),
    telegramRuntimeHealthMessage: message
  };
}

export function createTelegramConnectedMetadata(input: {
  telegramUserId: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}): Record<string, unknown> {
  return {
    ...refreshTelegramOwnerClaimMetadata(null),
    telegramUserId: input.telegramUserId,
    username: input.username,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    telegramAccessMode: "owner_only",
    telegramSessionThreadKey: createTelegramSessionThreadKey(),
    telegramSessionRotatedAt: null,
    telegramRuntimeHealth: "ok",
    telegramRuntimeHealthUpdatedAt: null,
    telegramRuntimeHealthMessage: null
  };
}

export function rotateTelegramSessionMetadata(metadata: unknown): Record<string, unknown> {
  const current = resolveTelegramBindingMetadataState(metadata);
  return {
    ...current,
    telegramSessionThreadKey: createTelegramSessionThreadKey(),
    telegramSessionRotatedAt: new Date().toISOString()
  };
}
