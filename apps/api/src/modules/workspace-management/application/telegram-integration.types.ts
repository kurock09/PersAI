export type TelegramIntegrationState = {
  schema: "persai.telegramIntegration.v1";
  provider: "telegram";
  surfaceType: "telegram_bot";
  capabilityAllowed: boolean;
  connectionStatus: "connected" | "not_connected" | "claim_required" | "invalid_token";
  bindingState: "active" | "inactive" | "unconfigured";
  connectedAt: string | null;
  bot: {
    telegramUserId: number | null;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    ownerTelegramUserId: number | null;
    ownerTelegramUsername: string | null;
    ownerTelegramChatId: string | null;
  };
  tokenHint: {
    lastFour: string | null;
  };
  ownerClaim: {
    required: boolean;
    status: "not_started" | "pending" | "claimed";
    code: string | null;
    claimIssuedAt: string | null;
    claimExpiresAt: string | null;
    claimedAt: string | null;
    systemWelcomeSentAt: string | null;
  };
  runtime: {
    health: "ok" | "invalid_token";
    lastError: string | null;
    checkedAt: string | null;
  };
  secretLifecycle: {
    status: "active" | "revoked" | "emergency_revoked" | "expired" | "legacy_unmanaged";
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
  configPanel: {
    available: boolean;
    settings: {
      autoCompactionEnabled: boolean;
      defaultParseMode: "plain_text" | "markdown";
      defaultDeepModeEnabled: boolean;
      inboundUserMessagesEnabled: boolean;
      outboundAssistantMessagesEnabled: boolean;
      groupReplyMode: "mention_reply" | "all_messages";
      notes: string | null;
    };
  };
  notes: string[];
};

export type TelegramConnectInput = {
  botToken: string;
  ttlDays?: number | null;
};

export type TelegramSecretRevokeInput = {
  reason: string | null;
};

export type TelegramConfigUpdateInput = {
  autoCompactionEnabled?: boolean;
  defaultParseMode?: "plain_text" | "markdown";
  defaultDeepModeEnabled?: boolean;
  inboundUserMessagesEnabled?: boolean;
  outboundAssistantMessagesEnabled?: boolean;
  groupReplyMode?: "mention_reply" | "all_messages";
  notes?: string | null;
};
