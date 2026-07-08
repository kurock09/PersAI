const BRIDGE_MESSAGE_SOURCE = "persai-browser-extension";

const EXTENSION_STATUS_TIMEOUT_MS = 1_200;

export const PERSAI_BROWSER_BRIDGE_WEB_STORE_URL: string | null = null;

type BridgeStatusRequestMessage = {
  type: "persai.bridge.status";
};

type WebBridgeEnvelope = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  requestId: string;
  payload: BridgeStatusRequestMessage;
};

type WebBridgeResponseEnvelope = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type ExtensionBridgeStatus = {
  connected: boolean;
  desiredConnection: boolean;
  bridgeDeviceId: string | null;
  assistantId: string | null;
  workspaceId: string | null;
  profileCount: number;
  lastProfileKey: string | null;
};

export function isNativeBrowserBridgeShell(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const maybeNative = window as typeof window & {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return (
    typeof maybeNative.Capacitor?.isNativePlatform === "function" &&
    maybeNative.Capacitor.isNativePlatform()
  );
}

function isBridgeResponseEnvelope(value: unknown): value is WebBridgeResponseEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    row.source === BRIDGE_MESSAGE_SOURCE &&
    typeof row.requestId === "string" &&
    typeof row.ok === "boolean"
  );
}

function isExtensionBridgeStatus(value: unknown): value is ExtensionBridgeStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.connected === "boolean" &&
    typeof row.desiredConnection === "boolean" &&
    (typeof row.bridgeDeviceId === "string" || row.bridgeDeviceId === null) &&
    (typeof row.assistantId === "string" || row.assistantId === null) &&
    (typeof row.workspaceId === "string" || row.workspaceId === null) &&
    typeof row.profileCount === "number" &&
    (typeof row.lastProfileKey === "string" || row.lastProfileKey === null)
  );
}

export async function getExtensionBridgeStatus(
  timeoutMs = EXTENSION_STATUS_TIMEOUT_MS
): Promise<ExtensionBridgeStatus> {
  if (typeof window === "undefined") {
    throw new Error("Browser bridge status can only be checked in the browser.");
  }

  return await new Promise<ExtensionBridgeStatus>((resolve, reject) => {
    const requestId = `persai-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;

    const cleanup = (timerId: number) => {
      window.clearTimeout(timerId);
      window.removeEventListener("message", onMessage);
    };

    const finish = (timerId: number, fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(timerId);
      fn();
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      const envelope = isBridgeResponseEnvelope(event.data) ? event.data : null;
      if (envelope === null || envelope.requestId !== requestId) {
        return;
      }
      finish(timerId, () => {
        if (!envelope.ok) {
          reject(new Error(envelope.error ?? "Bridge status request failed."));
          return;
        }
        if (!isExtensionBridgeStatus(envelope.result)) {
          reject(new Error("Bridge status response was malformed."));
          return;
        }
        resolve(envelope.result);
      });
    };

    const timerId = window.setTimeout(() => {
      finish(timerId, () => {
        reject(new Error("PersAI Browser Bridge extension was not detected."));
      });
    }, timeoutMs);

    window.addEventListener("message", onMessage);

    const payload: WebBridgeEnvelope = {
      source: BRIDGE_MESSAGE_SOURCE,
      requestId,
      payload: { type: "persai.bridge.status" }
    };
    window.postMessage(payload, window.location.origin);
  });
}
