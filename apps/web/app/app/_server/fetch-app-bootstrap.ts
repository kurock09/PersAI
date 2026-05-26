import "server-only";
import { auth } from "@clerk/nextjs/server";
import type {
  AssistantLimitState,
  AssistantLifecycleState,
  AssistantListItemState,
  AssistantWebChatListItemState,
  TelegramIntegrationState,
  UserPlanVisibilityState,
  AdminPlanVisibilityState
} from "@persai/contracts";
import type { AssistantNotificationPreferenceState } from "../assistant-api-client";

/**
 * ADR-076 Slice 3 — server-side fetch for the single bootstrap endpoint.
 *
 * Called from `apps/web/app/app/layout.tsx` (a React Server Component) during
 * the very first paint. The result is forwarded to `AppShell` as
 * `initialData`, eliminating the post-hydration loading flash from the six
 * legacy fan-out calls. This file is `server-only` so client bundles never
 * see the bearer token / upstream URL resolution logic.
 */

export interface BootstrapErrorState {
  code: string;
  category: "auth" | "forbidden" | "validation" | "infra" | "unknown";
  message: string;
}

export type BootstrapSection<T> = { ok: true; data: T } | { ok: false; error: BootstrapErrorState };

export interface AppBootstrapAssistantState {
  assistant: AssistantLifecycleState | null;
  assistants: AssistantListItemState[];
  activeAssistantId: string | null;
  assistantLimit: AssistantLimitState;
}

export interface AppBootstrapInitialData {
  assistant: BootstrapSection<AppBootstrapAssistantState>;
  chats: BootstrapSection<AssistantWebChatListItemState[]>;
  telegram: BootstrapSection<TelegramIntegrationState>;
  notificationPreference: BootstrapSection<AssistantNotificationPreferenceState>;
  plan: BootstrapSection<UserPlanVisibilityState>;
  admin: BootstrapSection<AdminPlanVisibilityState>;
}

const FALLBACK_INFRA_ERROR: BootstrapErrorState = {
  code: "bootstrap_unreachable",
  category: "infra",
  message: "Bootstrap endpoint did not respond."
};

function emptyInitialData(error: BootstrapErrorState): AppBootstrapInitialData {
  return {
    assistant: { ok: false, error },
    chats: { ok: false, error },
    telegram: { ok: false, error },
    notificationPreference: { ok: false, error },
    plan: { ok: false, error },
    admin: { ok: false, error }
  };
}

function resolveUpstreamApiBase(): string {
  const raw = process.env.PERSAI_WEB_API_PROXY_TARGET?.trim();
  if (raw) {
    return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "") + "/api/v1";
  }
  return "http://localhost:3001/api/v1";
}

export async function fetchAppBootstrap(): Promise<AppBootstrapInitialData | null> {
  const session = await auth();
  if (!session.userId) {
    return null;
  }

  let token: string | null = null;
  try {
    token = await session.getToken();
  } catch {
    return emptyInitialData({
      code: "auth_unavailable",
      category: "auth",
      message: "Could not obtain authentication token for bootstrap."
    });
  }

  if (!token) {
    return null;
  }

  const upstream = `${resolveUpstreamApiBase()}/app/bootstrap`;
  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
  } catch {
    return emptyInitialData(FALLBACK_INFRA_ERROR);
  }

  if (!response.ok) {
    return emptyInitialData({
      code: "bootstrap_http_error",
      category: response.status === 401 ? "auth" : "infra",
      message: `Bootstrap upstream returned ${String(response.status)}.`
    });
  }

  try {
    const payload = (await response.json()) as { sections?: AppBootstrapInitialData };
    return payload.sections ?? null;
  } catch {
    return emptyInitialData({
      code: "bootstrap_parse_error",
      category: "infra",
      message: "Bootstrap response could not be parsed."
    });
  }
}
