import { buildOriginPermissionPattern } from "./permissions.js";
import { readState } from "./storage.js";

const port = chrome.runtime.connect({ name: "persai-popup-keepalive" });
void port;

const statusNode = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const bridgeSection = document.getElementById("bridge-section");
const permissionTitleNode = document.getElementById("permission-title");
const permissionStatusNode = document.getElementById("permission-status");
const grantPermissionButton = document.getElementById("grant-permission");
const requestedPermissionPattern = resolveRequestedPermissionPattern();
const russian = navigator.language.toLowerCase().startsWith("ru");

function resolveRequestedPermissionPattern(): string | null {
  const requested = new URLSearchParams(window.location.search).get("grant");
  if (
    requested === null ||
    (requested !== "<all_urls>" && !/^https?:\/\/[^/?#]+(?::\d+)?\/\*$/iu.test(requested))
  ) {
    return null;
  }
  return requested;
}

async function resolveCurrentPermissionPattern(): Promise<string | null> {
  if (requestedPermissionPattern !== null) {
    return requestedPermissionPattern;
  }
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
  const screenshotAccess = pattern === "<all_urls>";
  if (requestedPermissionPattern !== null) {
    permissionStatusNode.textContent = granted
      ? russian
        ? "Доступ уже выдан. Это окно можно закрыть."
        : "Access is already granted. You can close this window."
      : screenshotAccess
        ? russian
          ? "Chrome требует одно общее разрешение, чтобы PersAI мог читать, управлять и делать скриншоты выбранных страниц. Расширение работает только с браузерными сессиями PersAI."
          : "Chrome requires one broad permission so PersAI can read, interact with, and capture selected pages. The extension only works with PersAI browser sessions."
        : russian
          ? `Разрешите PersAI читать страницу и выполнять действия на ${pattern.replace(/\/\*$/u, "")}.`
          : `Allow PersAI to read and interact with ${pattern.replace(/\/\*$/u, "")}.`;
  } else {
    permissionStatusNode.textContent = granted
      ? `Access granted for ${pattern}`
      : `Access is required for ${pattern}`;
  }
  grantPermissionButton.textContent = granted
    ? russian
      ? "Разрешение выдано"
      : "Access granted"
    : screenshotAccess
      ? russian
        ? "Разрешить работу с браузером"
        : "Allow browser access"
      : russian
        ? "Разрешить доступ"
        : "Grant access";
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

if (requestedPermissionPattern !== null) {
  if (bridgeSection instanceof HTMLElement) {
    bridgeSection.hidden = true;
  }
  if (permissionTitleNode instanceof HTMLElement) {
    permissionTitleNode.textContent =
      requestedPermissionPattern === "<all_urls>"
        ? russian
          ? "Доступ PersAI к браузеру"
          : "PersAI browser access"
        : russian
          ? "Доступ к сайту"
          : "Site access";
  }
}

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
  const granted = await chrome.permissions.request({ origins: [pattern] });
  await refreshPermissionStatus();
  if (granted) {
    window.close();
  }
});

if (requestedPermissionPattern === null) {
  void refreshStatus();
} else {
  void refreshPermissionStatus();
}
