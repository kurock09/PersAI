import { buildOriginPermissionPattern } from "./permissions.js";
import { readState } from "./storage.js";

const port = chrome.runtime.connect({ name: "persai-popup-keepalive" });
void port;

const statusNode = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const permissionStatusNode = document.getElementById("permission-status");
const grantPermissionButton = document.getElementById("grant-permission");

async function resolveCurrentPermissionPattern(): Promise<string | null> {
  const state = await readState();
  const profileKey = state.lastProfileKey;
  const lastKnownUrl = profileKey ? state.profiles[profileKey]?.lastKnownUrl : null;
  return typeof lastKnownUrl === "string" ? buildOriginPermissionPattern(lastKnownUrl) : null;
}

async function refreshPermissionStatus(): Promise<void> {
  if (
    !(permissionStatusNode instanceof HTMLElement) ||
    !(grantPermissionButton instanceof HTMLButtonElement)
  ) {
    return;
  }
  const pattern = await resolveCurrentPermissionPattern();
  if (pattern === null) {
    permissionStatusNode.textContent = "Open a profile window to choose a site.";
    grantPermissionButton.disabled = true;
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  permissionStatusNode.textContent = granted
    ? `Access granted for ${pattern}`
    : `Access is required for ${pattern}`;
  grantPermissionButton.textContent = granted ? "Access granted" : "Grant access";
  grantPermissionButton.disabled = granted;
  grantPermissionButton.dataset.originPattern = pattern;
}

async function refreshStatus(): Promise<void> {
  if (!(statusNode instanceof HTMLElement)) {
    return;
  }
  statusNode.textContent = "Loading bridge status…";
  const status = (await chrome.runtime.sendMessage({ type: "popup.status" })) as {
    connected?: boolean;
    desiredConnection?: boolean;
    profileCount?: number;
    lastProfileKey?: string | null;
    bridgeDeviceId?: string | null;
  };
  statusNode.innerHTML = [
    `Connected: ${status.connected === true ? "yes" : "no"}`,
    `Socket desired: ${status.desiredConnection === true ? "yes" : "no"}`,
    `Registered device: ${status.bridgeDeviceId ?? "none"}`,
    `Profiles tracked: ${String(status.profileCount ?? 0)}`,
    `Last profile: ${status.lastProfileKey ?? "none"}`
  ].join("<br />");
  await refreshPermissionStatus();
}

refreshButton?.addEventListener("click", () => {
  void refreshStatus();
});

grantPermissionButton?.addEventListener("click", async () => {
  if (!(grantPermissionButton instanceof HTMLButtonElement)) {
    return;
  }
  const pattern = grantPermissionButton.dataset.originPattern;
  if (!pattern) {
    return;
  }
  // This call lives directly in the extension-popup click handler so Chrome
  // sees a real user gesture. A WebSocket/background command cannot legally
  // request optional host permission under MV3.
  await chrome.permissions.request({ origins: [pattern] });
  await refreshPermissionStatus();
});

void refreshStatus();
