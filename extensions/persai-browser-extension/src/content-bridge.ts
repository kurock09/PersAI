import type { WebBridgeEnvelope, WebBridgeResponseEnvelope } from "./messages.js";

const BRIDGE_MESSAGE_SOURCE = "persai-browser-extension";

let port: ChromeRuntimePort | null = null;

function ensurePort(): ChromeRuntimePort {
  if (port !== null) {
    return port;
  }
  port = chrome.runtime.connect({ name: "persai-page-keepalive" });
  port.onDisconnect.addListener(() => {
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
  ensurePort().postMessage(event.data);
});

ensurePort();
