export type OpenClawProviderKey =
  | "web_internal"
  | "telegram"
  | "whatsapp"
  | "max"
  | "system_notifications";

export type OpenClawSurfaceType =
  | "web_chat"
  | "telegram_bot"
  | "whatsapp_business"
  | "max_bot"
  | "max_mini_app"
  | "system_notification";

export type OpenClawBindingState = "active" | "inactive" | "unconfigured";

export type OpenClawChannelSurfaceBindingsState = {
  schema: "persai.openclawChannelSurfaceBindings.v1";
  derivedFrom: {
    effectiveCapabilitiesSchema: string | null;
    planCode: string | null;
  };
  providers: Array<{
    provider: OpenClawProviderKey;
    assistantBinding: {
      assistantId: string;
      bound: boolean;
      state: OpenClawBindingState;
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
      surfaceType: OpenClawSurfaceType;
      allowed: boolean;
      state: OpenClawBindingState;
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
    deniedSurfaceTypes: OpenClawSurfaceType[];
    declaredSurfaceTypes: OpenClawSurfaceType[];
  };
};
