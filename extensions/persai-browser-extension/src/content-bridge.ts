const BRIDGE_MESSAGE_SOURCE = "persai-browser-extension";

type WebBridgeEnvelope = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  requestId: string;
  payload: unknown;
};

type WebBridgeResponseEnvelope = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

let port: ChromeRuntimePort | null = null;
let extensionContextAvailable = true;

function hasLiveExtensionContext(): boolean {
  const runtime = chrome?.runtime as (ChromeRuntimeApi & { id?: string }) | undefined;
  return typeof runtime?.id === "string";
}

function buildContextUnavailableResponse(requestId: string): WebBridgeResponseEnvelope {
  return {
    source: BRIDGE_MESSAGE_SOURCE,
    requestId,
    ok: false,
    error: "Bridge extension context is unavailable. Reload this PersAI tab after reloading the extension."
  };
}

function ensurePort(): ChromeRuntimePort | null {
  if (port !== null) {
    return port;
  }
  if (!extensionContextAvailable || !hasLiveExtensionContext()) {
    extensionContextAvailable = false;
    return null;
  }
  try {
    port = chrome.runtime.connect({ name: "persai-page-keepalive" });
  } catch {
    extensionContextAvailable = false;
    port = null;
    return null;
  }
  port.onDisconnect.addListener(() => {
    if (!hasLiveExtensionContext()) {
      extensionContextAvailable = false;
    }
    port = null;
  });
  port.onMessage.addListener((message) => {
    window.postMessage(message as WebBridgeResponseEnvelope, window.location.origin);
  });
  return port;
}

window.addEventListener("message", (event: MessageEvent<WebBridgeEnvelope>) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }
  if (event.data?.source !== BRIDGE_MESSAGE_SOURCE || typeof event.data.requestId !== "string") {
    return;
  }
  const nextPort = ensurePort();
  if (nextPort === null) {
    window.postMessage(buildContextUnavailableResponse(event.data.requestId), window.location.origin);
    return;
  }
  try {
    nextPort.postMessage(event.data);
  } catch {
    port = null;
    window.postMessage(buildContextUnavailableResponse(event.data.requestId), window.location.origin);
  }
});

ensurePort();
