import { Injectable } from "@nestjs/common";
import type {
  ChannelRegistryRow,
  DeliveryResult,
  NotificationIntentRecord,
  RenderedPayload
} from "../../../application/notifications/notification-platform.types";
import { NotificationChannelType } from "../../../application/notifications/notification-platform.types";
import type { NotificationChannelAdapter } from "./channel-adapter.interface";

/**
 * Web Push channel adapter stub.
 * Real implementation deferred to a future ADR (FCM/service-worker subscriptions).
 * ADR-088 Slice 1 – interface stub only.
 */
@Injectable()
export class WebPushChannelAdapter implements NotificationChannelAdapter {
  readonly channelType = NotificationChannelType.web_push;

  deliver(
    _intent: NotificationIntentRecord,
    _renderedPayload: RenderedPayload,
    _channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    return Promise.resolve({
      status: "failed",
      error: { reason: "web_push_not_implemented_until_future_adr" }
    });
  }
}
