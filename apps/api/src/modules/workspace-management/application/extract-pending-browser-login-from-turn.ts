import type {
  PendingBrowserLoginState,
  ProviderGatewayToolExchange,
  RuntimeTurnToolInvocation
} from "@persai/runtime-contract";
import type { ClientRuntimeTurnToolInvocation } from "./strip-tool-invocations-for-client";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parsePendingBrowserLoginState(value: unknown): PendingBrowserLoginState | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.profileId) ||
    !isNonEmptyString(candidate.profileKey) ||
    !isNonEmptyString(candidate.displayName) ||
    !isNonEmptyString(candidate.liveUrl) ||
    !isNonEmptyString(candidate.loginUrl)
  ) {
    return null;
  }
  return {
    profileId: candidate.profileId.trim(),
    profileKey: candidate.profileKey.trim(),
    displayName: candidate.displayName.trim(),
    liveUrl: candidate.liveUrl.trim(),
    loginUrl: candidate.loginUrl.trim(),
    ...(candidate.completionMode === "assist" || candidate.completionMode === "login"
      ? { completionMode: candidate.completionMode }
      : {})
  };
}

function parsePendingBrowserLoginFromToolResultContent(
  content: string
): PendingBrowserLoginState | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const payload = parsed as Record<string, unknown>;
    const direct = parsePendingBrowserLoginState(payload.pendingBrowserLogin);
    if (direct !== null) {
      return direct;
    }
    if (payload.action === "login" && payload.login !== null && typeof payload.login === "object") {
      const login = payload.login as Record<string, unknown>;
      if (isNonEmptyString(login.profileKey)) {
        return parsePendingBrowserLoginState({
          profileId: login.profileId ?? payload.profileId,
          profileKey: login.profileKey,
          displayName: login.displayName,
          liveUrl: login.liveUrl,
          loginUrl: login.loginUrl,
          completionMode: "login"
        });
      }
    }
    if (
      (payload.action === "opened_live" || payload.requestedAction === "open_live") &&
      payload.login !== null &&
      typeof payload.login === "object"
    ) {
      const login = payload.login as Record<string, unknown>;
      if (isNonEmptyString(login.profileKey)) {
        return parsePendingBrowserLoginState({
          profileId: payload.profileId,
          profileKey: login.profileKey,
          displayName: login.displayName,
          liveUrl: login.liveUrl,
          loginUrl: login.loginUrl,
          completionMode: login.status === "active" ? "assist" : "login"
        });
      }
    }
    return null;
  } catch {
    return null;
  }
}

function isBrowserToolExchange(exchange: ProviderGatewayToolExchange): boolean {
  return exchange.toolResult.name === "browser" && exchange.toolResult.isError !== true;
}

function browserLoginSucceeded(
  toolInvocations: readonly RuntimeTurnToolInvocation[] | undefined,
  exchange: ProviderGatewayToolExchange
): boolean {
  if (toolInvocations === undefined || toolInvocations.length === 0) {
    return true;
  }
  const toolCallId = exchange.toolResult.toolCallId;
  const matching = toolInvocations.filter((invocation) => {
    if (invocation.name !== "browser") {
      return false;
    }
    if (typeof toolCallId === "string" && toolCallId.length > 0) {
      return invocation.toolCallId === toolCallId;
    }
    return true;
  });
  if (matching.length === 0) {
    return false;
  }
  return matching.some((invocation) => invocation.ok === true);
}

export function extractPendingBrowserLoginFromTurn(
  toolInvocations?:
    | readonly RuntimeTurnToolInvocation[]
    | readonly ClientRuntimeTurnToolInvocation[]
    | undefined,
  toolExchanges?: readonly ProviderGatewayToolExchange[] | undefined
): PendingBrowserLoginState | null {
  if (toolExchanges === undefined || toolExchanges.length === 0) {
    return null;
  }

  for (let index = toolExchanges.length - 1; index >= 0; index -= 1) {
    const exchange = toolExchanges[index];
    if (exchange === undefined || !isBrowserToolExchange(exchange)) {
      continue;
    }
    if (!browserLoginSucceeded(toolInvocations, exchange)) {
      continue;
    }
    const pending = parsePendingBrowserLoginFromToolResultContent(exchange.toolResult.content);
    if (pending !== null) {
      return pending;
    }
  }

  return null;
}

export function appendTelegramBrowserLoginLink(
  locale: "ru" | "en",
  message: string,
  pending: PendingBrowserLoginState
): string {
  const trimmed = message.trim();
  const label =
    locale === "ru"
      ? `Чтобы продолжить вход для «${pending.displayName}», откройте PersAI в браузере: https://persai.dev`
      : `To continue login for "${pending.displayName}", open PersAI on the web: https://persai.dev`;
  return trimmed.length > 0 ? `${trimmed}\n\n${label}` : label;
}
