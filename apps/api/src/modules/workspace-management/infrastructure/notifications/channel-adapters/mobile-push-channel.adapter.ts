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
 * Mobile Push (FCM/APNs via Capacitor) channel adapter stub.
 * Real implementation deferred to a future ADR.
 * ADR-088 Slice 1 – interface stub only.
 */
@Injectable()
export class MobilePushChannelAdapter implements NotificationChannelAdapter {
  readonly channelType = NotificationChannelType.mobile_push;

  deliver(
    _intent: NotificationIntentRecord,
    _renderedPayload: RenderedPayload,
    _channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    return Promise.resolve({
      status: "failed",
      error: { reason: "mobile_push_not_implemented_until_future_adr" }
    });
  }
}
