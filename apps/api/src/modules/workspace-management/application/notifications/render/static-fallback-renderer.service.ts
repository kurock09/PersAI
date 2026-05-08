import { Injectable } from "@nestjs/common";
import type { NotificationIntentRecord, RenderedPayload } from "../notification-platform.types";

/**
 * Emergency fallback renderer.
 * Produces minimal deliverable output from raw fact payload when the intended
 * renderer cannot produce output. Never used as primary unless renderStrategy
 * is explicitly 'static_fallback'.
 * ADR-088 §Core principles #3.
 */
@Injectable()
export class StaticFallbackRendererService {
  render(intent: NotificationIntentRecord): Promise<RenderedPayload> {
    const body = this.buildFallbackBody(intent);
    return Promise.resolve({ body, plainText: body });
  }

  private buildFallbackBody(intent: NotificationIntentRecord): string {
    const facts = intent.factPayload;
    if (typeof facts["message"] === "string" && facts["message"]) {
      return facts["message"];
    }
    if (typeof facts["text"] === "string" && facts["text"]) {
      return facts["text"];
    }
    return `Notification [${intent.source}]`;
  }
}
