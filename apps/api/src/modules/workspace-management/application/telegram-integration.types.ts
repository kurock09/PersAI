export type TelegramIntegrationState = {
  schema: "persai.telegramIntegration.v1";
  provider: "telegram";
  surfaceType: "telegram_bot";
  capabilityAllowed: boolean;
  connectionStatus: "connected" | "not_connected";
  bindingState: "active" | "inactive" | "unconfigured";
  connectedAt: string | null;
  bot: {
    telegramUserId: number | null;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  tokenHint: {
    lastFour: string | null;
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
      defaultParseMode: "plain_text" | "markdown";
      inboundUserMessagesEnabled: boolean;
      outboundAssistantMessagesEnabled: boolean;
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
  defaultParseMode?: "plain_text" | "markdown";
  inboundUserMessagesEnabled?: boolean;
  outboundAssistantMessagesEnabled?: boolean;
  notes?: string | null;
};
