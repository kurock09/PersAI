export type AssistantIntegrationProviderKey =
  | "web_internal"
  | "telegram"
  | "whatsapp"
  | "max"
  | "system_notifications";

export type AssistantIntegrationSurfaceType =
  | "web_chat"
  | "telegram_bot"
  | "whatsapp_business"
  | "max_bot"
  | "max_mini_app"
  | "system_notification";

export type AssistantChannelBindingState = "active" | "inactive" | "unconfigured";

export type AssistantChannelSurfaceBinding = {
  id: string;
  assistantId: string;
  providerKey: AssistantIntegrationProviderKey;
  surfaceType: AssistantIntegrationSurfaceType;
  bindingState: AssistantChannelBindingState;
  tokenFingerprint: string | null;
  tokenLastFour: string | null;
  policy: unknown | null;
  config: unknown | null;
  metadata: unknown | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
