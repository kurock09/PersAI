export type AssistantChannelProviderKey =
  | "web_internal"
  | "telegram"
  | "whatsapp"
  | "max"
  | "system_notifications";

export type AssistantChannelSurfaceType =
  | "web_chat"
  | "telegram_bot"
  | "whatsapp_business"
  | "max_bot"
  | "max_mini_app"
  | "system_notification";

export type AssistantChannelBindingState = "active" | "inactive" | "unconfigured";

export type AssistantChannelSurfaceBindingsState = {
  schema: "persai.assistantChannelSurfaceBindings.v1";
  derivedFrom: {
    effectiveCapabilitiesSchema: string | null;
    planCode: string | null;
  };
  providers: Array<{
    provider: AssistantChannelProviderKey;
    assistantBinding: {
      assistantId: string;
      bound: boolean;
      state: AssistantChannelBindingState;
    };
    policy: {
      inboundUserMessages: boolean;
      outboundAssistantMessages: boolean;
      supportsInteractiveChat: boolean;
    };
    config: {
      mode: "native" | "token_secret" | "provider_api" | "system" | "unconfigured";
      configRef: string | null;
    };
    surfaces: Array<{
      surfaceType: AssistantChannelSurfaceType;
      allowed: boolean;
      state: AssistantChannelBindingState;
      denyReason: null | "capability_denied" | "provider_unconfigured";
      policy: {
        interactionMode: "chat" | "notification";
        inboundUserMessages: boolean;
        outboundAssistantMessages: boolean;
      };
      config: {
        routingKey: string;
      };
    }>;
  }>;
  suppression: {
    suppressUnavailableSurfaces: true;
    deniedSurfaceTypes: AssistantChannelSurfaceType[];
    declaredSurfaceTypes: AssistantChannelSurfaceType[];
  };
};
