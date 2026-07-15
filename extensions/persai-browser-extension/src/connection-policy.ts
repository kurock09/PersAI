export function shouldKeepBridgeConnection(input: {
  keepalivePortCount: number;
  activeCommandCount: number;
  registrationUpdatedAt: number | null;
  now: number;
  registrationMaxAgeMs: number;
}): boolean {
  const hasFreshRegistration =
    input.registrationUpdatedAt !== null &&
    input.now - input.registrationUpdatedAt <= input.registrationMaxAgeMs;
  return input.keepalivePortCount > 0 || input.activeCommandCount > 0 || hasFreshRegistration;
}

/**
 * Gate actual `new WebSocket(...)` dials. Chromium still records failed WS
 * dials on the extension Errors page even with `error` listeners; avoid dialing
 * while offline or after a short consecutive-failure budget so Web Store review
 * does not see a reconnect spam of net::ERR_* entries.
 *
 * The budget covers only dials that never reached OPEN. Mid-session drops
 * (LB `ERR_CONNECTION_RESET` after a healthy open) must reconnect freely.
 */
export function shouldAttemptBridgeDial(input: {
  desiredConnection: boolean;
  online: boolean;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
}): boolean {
  if (!input.desiredConnection || !input.online) {
    return false;
  }
  if (!Number.isFinite(input.consecutiveFailures) || input.consecutiveFailures < 0) {
    return false;
  }
  if (
    !Number.isFinite(input.maxConsecutiveFailures) ||
    input.maxConsecutiveFailures < 1
  ) {
    return false;
  }
  return input.consecutiveFailures < input.maxConsecutiveFailures;
}

/** Count toward the dial spam budget only when the socket never reached OPEN. */
export function shouldCountBridgeConnectFailure(dialReachedOpen: boolean): boolean {
  return dialReachedOpen !== true;
}

export function isAllowedBridgeWebSocketUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "wss:" && url.protocol !== "ws:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return (
      host === "api.persai.dev" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".persai.dev")
    );
  } catch {
    return false;
  }
}
