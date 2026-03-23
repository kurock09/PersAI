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
};

export type TelegramConfigUpdateInput = {
  defaultParseMode?: "plain_text" | "markdown";
  inboundUserMessagesEnabled?: boolean;
  outboundAssistantMessagesEnabled?: boolean;
  notes?: string | null;
};
