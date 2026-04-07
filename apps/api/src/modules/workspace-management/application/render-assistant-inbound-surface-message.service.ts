import { Injectable } from "@nestjs/common";
import type { AssistantInboundSurface } from "./assistant-inbound.types";

type RenderedSurfaceMessage = {
  text: string;
  code: string;
};

@Injectable()
export class RenderAssistantInboundSurfaceMessageService {
  renderError(
    surface: AssistantInboundSurface,
    code: string,
    fallbackMessage: string
  ): RenderedSurfaceMessage {
    if (surface === "telegram" || surface === "whatsapp" || surface === "max") {
      return {
        code,
        text: this.renderMessengerError(code, fallbackMessage)
      };
    }

    if (surface === "reminder_callback") {
      return {
        code,
        text: this.renderReminderError(code, fallbackMessage)
      };
    }

    return {
      code,
      text: fallbackMessage
    };
  }

  private renderMessengerError(code: string, fallbackMessage: string): string {
    switch (code) {
      case "assistant_not_live":
        return "Assistant is not live yet. Please publish/apply the latest version first.";
      case "plan_feature_unavailable":
        return "This channel is not available on the current plan.";
      case "media_storage_quota_exceeded":
        return "Media storage is full. Delete old chats or files to free up space before sending new files.";
      case "quota_limit_reached":
        return "Usage limit reached for the current plan. Please try again later.";
      case "tool_daily_limit_reached":
        return "Daily tool usage limit reached. Please try again later.";
      case "rate_limited":
        return "Requests are temporarily limited right now. Please try again in a moment.";
      case "runtime_timeout":
        return "The assistant took too long to respond. Please try again.";
      case "runtime_degraded":
      case "runtime_unreachable":
      case "runtime_auth_failure":
      case "runtime_invalid_response":
      case "assistant_turn_failed":
        return "Assistant is temporarily unavailable. Please try again.";
      default:
        return fallbackMessage;
    }
  }

  private renderReminderError(code: string, fallbackMessage: string): string {
    switch (code) {
      case "plan_feature_unavailable":
        return "Reminder delivery is unavailable on the current plan.";
      case "quota_limit_reached":
        return "Reminder could not be delivered because the current plan limit was reached.";
      case "tool_daily_limit_reached":
        return "Reminder could not be delivered because a daily tool limit was reached.";
      case "rate_limited":
        return "Reminder delivery is temporarily rate-limited.";
      case "runtime_timeout":
      case "runtime_degraded":
      case "runtime_unreachable":
      case "runtime_auth_failure":
      case "runtime_invalid_response":
      case "assistant_turn_failed":
        return "Reminder delivery is temporarily unavailable.";
      default:
        return fallbackMessage;
    }
  }
}
