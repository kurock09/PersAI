import type {
  NotificationChannelType,
  DeliveryResult,
  RenderedPayload,
  NotificationIntentRecord,
  ChannelRegistryRow
} from "../../../application/notifications/notification-platform.types";

export const NOTIFICATION_CHANNEL_ADAPTERS = Symbol("NOTIFICATION_CHANNEL_ADAPTERS");

/**
 * All channel adapters implement this interface.
 * Adapters are dumb: they deliver and report result. No policy/routing/dedupe logic.
 * ADR-088 §Core principles #4.
 */
export interface NotificationChannelAdapter {
  readonly channelType: NotificationChannelType;

  deliver(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult>;
}
