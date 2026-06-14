import { Injectable } from "@nestjs/common";
import type { SupportedLocale } from "@persai/types";
import type { AssistantInboundSurface } from "./assistant-inbound.types";
import {
  resolveMessengerSurfaceErrorCopy,
  resolveReminderSurfaceErrorCopy
} from "./system-copy/system-copy-catalog";

type RenderedSurfaceMessage = {
  text: string;
  code: string;
};

type RenderAssistantInboundSurfaceMessageOptions = {
  reasonCode?: string | null;
};

@Injectable()
export class RenderAssistantInboundSurfaceMessageService {
  renderError(
    surface: AssistantInboundSurface,
    code: string,
    fallbackMessage: string,
    locale: SupportedLocale = "en",
    options?: RenderAssistantInboundSurfaceMessageOptions
  ): RenderedSurfaceMessage {
    if (surface === "telegram" || surface === "whatsapp" || surface === "max") {
      return {
        code,
        text: resolveMessengerSurfaceErrorCopy(code, locale, fallbackMessage, {
          reasonCode: options?.reasonCode ?? null
        })
      };
    }

    if (surface === "reminder_callback") {
      return {
        code,
        text: resolveReminderSurfaceErrorCopy(code, locale, fallbackMessage)
      };
    }

    return {
      code,
      text: fallbackMessage
    };
  }
}
