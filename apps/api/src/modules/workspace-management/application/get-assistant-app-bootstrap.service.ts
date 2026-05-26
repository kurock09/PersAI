import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import type { AssistantLifecycleViewState } from "./assistant-lifecycle.types";
import type { AssistantNotificationPreferenceState } from "./assistant-notification-preference.types";
import type { AdminPlanVisibilityState, UserPlanVisibilityState } from "./plan-visibility.types";
import type { TelegramIntegrationState } from "./telegram-integration.types";
import type { AssistantWebChatListItemState } from "./web-chat.types";
import { ManageWebChatListService } from "./manage-web-chat-list.service";
import { ResolveAssistantLifecycleViewService } from "./resolve-assistant-lifecycle-view.service";
import { ResolveAssistantNotificationPreferenceService } from "./resolve-assistant-notification-preference.service";
import { ResolvePlanVisibilityService } from "./resolve-plan-visibility.service";
import { ResolveTelegramIntegrationStateService } from "./resolve-telegram-integration-state.service";

/**
 * ADR-076 Slice 3 — single bootstrap surface.
 *
 * The web app (Server Component `apps/web/app/app/layout.tsx`) calls this
 * once during the first paint instead of fan-firing six client-side requests
 * after hydration. Each section reports `{ ok: true, data }` or
 * `{ ok: false, error }` independently so a slow/non-critical surface
 * (e.g. telegram integration) never holds up the rest. The shape mirrors
 * the per-endpoint responses that already exist; the per-endpoint clients
 * remain as the refresh path after mutations.
 */

export interface BootstrapErrorState {
  code: string;
  category: "auth" | "forbidden" | "validation" | "infra" | "unknown";
  message: string;
}

export type BootstrapSection<T> = { ok: true; data: T } | { ok: false; error: BootstrapErrorState };

export interface AppBootstrapSectionsState {
  assistant: BootstrapSection<AssistantLifecycleViewState>;
  chats: BootstrapSection<AssistantWebChatListItemState[]>;
  telegram: BootstrapSection<TelegramIntegrationState>;
  notificationPreference: BootstrapSection<AssistantNotificationPreferenceState>;
  plan: BootstrapSection<UserPlanVisibilityState>;
  admin: BootstrapSection<AdminPlanVisibilityState>;
}

function classifyError(error: unknown): BootstrapErrorState {
  if (error instanceof UnauthorizedException) {
    return {
      code: "auth_required",
      category: "auth",
      message: error.message
    };
  }
  if (error instanceof ForbiddenException) {
    return {
      code: "forbidden",
      category: "forbidden",
      message: error.message
    };
  }
  if (error instanceof NotFoundException) {
    return {
      code: "not_found",
      category: "validation",
      message: error.message
    };
  }
  if (error instanceof ConflictException) {
    return {
      code: "conflict",
      category: "validation",
      message: error.message
    };
  }
  if (error instanceof Error) {
    return {
      code: "bootstrap_section_failed",
      category: "infra",
      message: error.message
    };
  }
  return {
    code: "bootstrap_section_failed",
    category: "unknown",
    message: "Bootstrap section failed."
  };
}

function toSection<T>(result: PromiseSettledResult<T>): BootstrapSection<T> {
  if (result.status === "fulfilled") {
    return { ok: true, data: result.value };
  }
  return { ok: false, error: classifyError(result.reason) };
}

@Injectable()
export class GetAssistantAppBootstrapService {
  constructor(
    private readonly resolveAssistantLifecycleViewService: ResolveAssistantLifecycleViewService,
    private readonly manageWebChatListService: ManageWebChatListService,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService,
    private readonly resolveAssistantNotificationPreferenceService: ResolveAssistantNotificationPreferenceService,
    private readonly resolvePlanVisibilityService: ResolvePlanVisibilityService
  ) {}

  async execute(userId: string): Promise<AppBootstrapSectionsState> {
    const [
      assistantResult,
      chatsResult,
      telegramResult,
      notificationResult,
      planResult,
      adminResult
    ] = await Promise.allSettled([
      this.resolveAssistantLifecycleViewService.execute(userId),
      this.manageWebChatListService.listChats(userId),
      this.resolveTelegramIntegrationStateService.execute(userId),
      this.resolveAssistantNotificationPreferenceService.execute(userId),
      this.resolvePlanVisibilityService.getUserVisibility(userId),
      this.resolvePlanVisibilityService.getAdminVisibility(userId)
    ]);

    return {
      assistant: toSection(assistantResult),
      chats: toSection(chatsResult),
      telegram: toSection(telegramResult),
      notificationPreference: toSection(notificationResult),
      plan: toSection(planResult),
      admin: toSection(adminResult)
    };
  }
}
