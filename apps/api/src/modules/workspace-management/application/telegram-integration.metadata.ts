import { randomBytes } from "node:crypto";

export type TelegramClaimStatus = "not_started" | "pending" | "claimed";
export type TelegramConnectionStatus =
  | "connected"
  | "not_connected"
  | "claim_required"
  | "invalid_token";
export type TelegramRuntimeHealth = "ok" | "invalid_token";

export type TelegramBindingMetadataState = {
  telegramUserId: number | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  telegramAccessMode: "owner_only";
  telegramOwnerClaimStatus: TelegramClaimStatus;
  telegramOwnerClaimToken: string | null;
  telegramOwnerClaimIssuedAt: string | null;
  telegramOwnerClaimedAt: string | null;
  telegramOwnerTelegramUserId: number | null;
  telegramOwnerTelegramUsername: string | null;
  telegramOwnerTelegramChatId: string | null;
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

export function createTelegramOwnerClaimToken(): string {
  return randomBytes(18).toString("hex");
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
    telegramAccessMode: "owner_only",
    telegramOwnerClaimStatus: toClaimStatus(row?.telegramOwnerClaimStatus),
    telegramOwnerClaimToken: toStringOrNull(row?.telegramOwnerClaimToken),
    telegramOwnerClaimIssuedAt: toStringOrNull(row?.telegramOwnerClaimIssuedAt),
    telegramOwnerClaimedAt: toStringOrNull(row?.telegramOwnerClaimedAt),
    telegramOwnerTelegramUserId: toNumberOrNull(row?.telegramOwnerTelegramUserId),
    telegramOwnerTelegramUsername: toStringOrNull(row?.telegramOwnerTelegramUsername),
    telegramOwnerTelegramChatId: toStringOrNull(row?.telegramOwnerTelegramChatId),
    telegramOwnerSystemWelcomeSentAt: toStringOrNull(row?.telegramOwnerSystemWelcomeSentAt),
    telegramRuntimeHealth: toRuntimeHealth(row?.telegramRuntimeHealth),
    telegramRuntimeHealthUpdatedAt: toStringOrNull(row?.telegramRuntimeHealthUpdatedAt),
    telegramRuntimeHealthMessage: toStringOrNull(row?.telegramRuntimeHealthMessage)
  };
}

export function buildTelegramClaimDeepLink(
  username: string | null,
  claimToken: string | null
): string | null {
  if (!username || !claimToken) {
    return null;
  }
  return `https://t.me/${username}?start=persai_claim_${claimToken}`;
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
    telegramUserId: input.telegramUserId,
    username: input.username,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    telegramAccessMode: "owner_only",
    telegramOwnerClaimStatus: "pending",
    telegramOwnerClaimToken: createTelegramOwnerClaimToken(),
    telegramOwnerClaimIssuedAt: new Date().toISOString(),
    telegramOwnerClaimedAt: null,
    telegramOwnerTelegramUserId: null,
    telegramOwnerTelegramUsername: null,
    telegramOwnerTelegramChatId: null,
    telegramOwnerSystemWelcomeSentAt: null,
    telegramRuntimeHealth: "ok",
    telegramRuntimeHealthUpdatedAt: null,
    telegramRuntimeHealthMessage: null
  };
}
