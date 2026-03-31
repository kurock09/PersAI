export type AssistantInboundSurface =
  | "web_chat"
  | "telegram"
  | "whatsapp"
  | "max"
  | "reminder_callback";

export type AssistantInboundAbuseSurface = "web_chat" | "telegram" | "whatsapp" | "max";

export function toAssistantInboundAbuseSurface(
  surface: AssistantInboundSurface
): AssistantInboundAbuseSurface | null {
  switch (surface) {
    case "web_chat":
      return "web_chat";
    case "telegram":
      return "telegram";
    case "whatsapp":
      return "whatsapp";
    case "max":
      return "max";
    case "reminder_callback":
      return null;
  }
}
