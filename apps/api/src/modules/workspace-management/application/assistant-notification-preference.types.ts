export type AssistantPreferredNotificationChannel = "web" | "telegram";

export interface AssistantNotificationPreferenceState {
  selectedChannel: AssistantPreferredNotificationChannel;
  availableChannels: AssistantPreferredNotificationChannel[];
}
