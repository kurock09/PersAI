export type AssistantPreferredNotificationChannel = "web" | "telegram" | "whatsapp";

export interface AssistantNotificationPreferenceState {
  selectedChannel: AssistantPreferredNotificationChannel;
  availableChannels: AssistantPreferredNotificationChannel[];
}
