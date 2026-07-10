import type {
  LocalBrowserBridgeDeviceRegisterResult,
  LocalBrowserBridgeWebSocketConnectRequest,
  LocalBrowserCommand,
  LocalBrowserResult,
  RuntimeBrowserOperation
} from "./contract.js";
import {
  BRIDGE_MESSAGE_SOURCE,
  DEFAULT_MAX_CHARS,
  DEFAULT_MUTATION_SETTLE_MS,
  EXECUTOR_ERROR_REASON,
  EXTENSION_DEVICE_KIND,
  MAX_DOM_READY_WAIT_MS,
  MAX_EXTRACT_ITEMS,
  MAX_INTERACTIVE_ELEMENTS,
  MAX_OPERATION_COUNT,
  SOCKET_IDLE_CLOSE_REASON
} from "./constants.js";
import {
  buildExecutorFailureResult,
  buildPermissionDeniedResult,
  buildUnsupportedPdfResult,
  buildUnsupportedScreenshotResult,
  computeReconnectDelayMs,
  mergeWarnings,
  normalizeCommandTimeout
} from "./executor-core.js";
import { resolveHostScriptSource } from "./host-scripts.js";
import type { WebBridgeEnvelope, WebBridgeRequestMessage } from "./messages.js";
import {
  buildOriginPermissionPattern,
  isPersaiWebOrigin,
  normalizeApiBaseUrl
} from "./permissions.js";
import {
  consumePendingCompletion,
  type ExtensionStorageState,
  listAwaitingCompletionProfiles,
  type PendingCompletionAction,
  type ProfileSessionRecord,
  resolvePendingCompletion,
  setAwaitingCompletion,
  storeRegistration,
  upsertProfileRecord
} from "./profile-state.js";
import { runPageCommandInPage, type PageRunnerResult } from "./page-runner.js";
import { readState, reconcileProfileRecord, updateState, writeState } from "./storage.js";

const KEEPALIVE_PORT_NAMES = new Set(["persai-page-keepalive", "persai-popup-keepalive"]);

/**
 * Server bridge device tokens live 15 minutes; treat a stored registration
 * older than 14 minutes as unusable for dialing (see connectSocketIfNeeded).
 */
const REGISTRATION_TOKEN_SAFE_AGE_MS = 14 * 60 * 1000;
const PERMISSION_GRANT_TIMEOUT_MS = 90_000;
const PERMISSION_GRANT_POLL_MS = 250;
const SCREENSHOT_PERMISSION_PATTERN = "<all_urls>";
const ASSISTANT_OWNERSHIP_OVERLAY_ID = "__persai_assistant_ownership__";

let socket: WebSocket | null = null;
/** Bridge device id the current socket authenticated with. */
let socketDeviceId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let desiredConnection = false;
let keepalivePortCount = 0;
let activeCommandCount = 0;
let commandQueue = Promise.resolve();
let viewCommandQueue = Promise.resolve();
const permissionGrantInFlight = new Map<string, Promise<boolean>>();
const assistantOwnedProfileKeys = new Set<string>();

function hasLiveSocket(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (!desiredConnection) {
    return;
  }
  clearReconnectTimer();
  const delayMs = computeReconnectDelayMs(reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    void connectSocketIfNeeded();
  }, delayMs);
}

async function syncDesiredConnection(): Promise<void> {
  desiredConnection = keepalivePortCount > 0 || activeCommandCount > 0;
  if (desiredConnection) {
    await connectSocketIfNeeded();
    return;
  }
  clearReconnectTimer();
  if (socket !== null) {
    const nextSocket = socket;
    socket = null;
    try {
      nextSocket.close(1000, SOCKET_IDLE_CLOSE_REASON);
    } catch {
      // Ignore close failures on torn-down workers.
    }
  }
}

function parseDataUrl(input: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(input);
  const mimeType = match?.[1];
  const base64 = match?.[2];
  return typeof mimeType === "string" && typeof base64 === "string" ? { mimeType, base64 } : null;
}

async function connectSocketIfNeeded(): Promise<void> {
  if (!desiredConnection || hasLiveSocket()) {
    return;
  }
  const state = await readState();
  const registration = state.registration;
  if (registration === null || registration === undefined) {
    return;
  }
  // Server device tokens expire after 15 minutes and the extension cannot
  // mint a new one (registration needs the user's Clerk session in the web
  // tab). Dialing with a stale token just spams the relay with
  // "Device token has expired" rejections forever — stop and wait for the
  // web modal to push a fresh registration, which restarts the connection.
  if (Date.now() - registration.updatedAt > REGISTRATION_TOKEN_SAFE_AGE_MS) {
    return;
  }
  const nextSocket = new WebSocket(registration.websocketUrl);
  socket = nextSocket;
  socketDeviceId = registration.bridgeDeviceId;
  nextSocket.addEventListener("open", () => {
    reconnectAttempts = 0;
    const payload: LocalBrowserBridgeWebSocketConnectRequest = {
      assistantId: registration.assistantId,
      workspaceId: registration.workspaceId,
      bridgeDeviceId: registration.bridgeDeviceId,
      deviceKind: registration.deviceKind,
      deviceToken: registration.deviceToken
    };
    nextSocket.send(JSON.stringify(payload));
  });
  nextSocket.addEventListener("message", (event) => {
    const parsed = JSON.parse(String(event.data)) as LocalBrowserCommand;
    if (
      parsed.action === "open_view" ||
      parsed.action === "close_view" ||
      parsed.action === "check_view"
    ) {
      viewCommandQueue = viewCommandQueue
        .then(() => handleIncomingCommand(parsed))
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Unknown view command failure.";
          if (hasLiveSocket()) {
            socket?.send(
              JSON.stringify({
                commandId: parsed.commandId,
                ok: false,
                errorReason: EXECUTOR_ERROR_REASON,
                warning: message
              } satisfies LocalBrowserResult)
            );
          }
        });
      return;
    }
    commandQueue = commandQueue
      .then(() => handleIncomingCommand(parsed))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown command failure.";
        if (hasLiveSocket()) {
          socket?.send(
            JSON.stringify({
              commandId: parsed.commandId,
              ok: false,
              errorReason: EXECUTOR_ERROR_REASON,
              warning: message
            } satisfies LocalBrowserResult)
          );
        }
      });
  });
  nextSocket.addEventListener("close", () => {
    if (socket === nextSocket) {
      socket = null;
      socketDeviceId = null;
    }
    if (desiredConnection) {
      scheduleReconnect();
    }
  });
  nextSocket.addEventListener("error", () => {
    try {
      nextSocket.close();
    } catch {
      // Ignore.
    }
  });
}

async function saveRegistration(
  input: LocalBrowserBridgeDeviceRegisterResult & {
    assistantId: string;
    workspaceId: string;
    apiBaseUrl?: string | null;
    deviceLabel?: string | null;
    clientVersion?: string | null;
  }
): Promise<ExtensionStorageState> {
  return updateState((state) =>
    storeRegistration(state, {
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      bridgeDeviceId: input.bridgeDeviceId,
      deviceKind: EXTENSION_DEVICE_KIND,
      deviceToken: input.deviceToken,
      websocketUrl: input.websocketUrl,
      apiBaseUrl: input.apiBaseUrl ?? null,
      deviceLabel: input.deviceLabel ?? null,
      clientVersion: input.clientVersion ?? null,
      updatedAt: Date.now()
    })
  );
}

/**
 * A new registration mints a new bridge device id. If the live socket still
 * authenticates as the OLD device id, the web modal targets a device the
 * server considers disconnected and every dispatch 409s. Drop the stale
 * socket so the reconnect uses the fresh registration.
 */
function dropSocketIfDeviceChanged(nextBridgeDeviceId: string): void {
  if (socket === null || socketDeviceId === nextBridgeDeviceId) {
    return;
  }
  const staleSocket = socket;
  socket = null;
  socketDeviceId = null;
  try {
    staleSocket.close(1000, "registration_replaced");
  } catch {
    // Ignore close failures on torn-down sockets.
  }
}

async function registerDeviceViaApi(
  message: Extract<WebBridgeRequestMessage, { type: "persai.bridge.register_device_request" }>
): Promise<unknown> {
  const apiBaseUrl = normalizeApiBaseUrl(message.apiBaseUrl);
  const currentState = await readState();
  const previousRegistration = currentState.registration;
  const reusableBridgeDeviceId =
    previousRegistration?.assistantId === message.payload.assistantId &&
    previousRegistration.workspaceId === message.payload.workspaceId
      ? previousRegistration.bridgeDeviceId
      : null;
  const response = await fetch(`${apiBaseUrl}/api/v1/assistant/browser-bridge/devices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${message.bearerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...message.payload,
      ...(reusableBridgeDeviceId === null ? {} : { bridgeDeviceId: reusableBridgeDeviceId }),
      deviceKind: EXTENSION_DEVICE_KIND
    })
  });
  if (!response.ok) {
    throw new Error(`Device registration failed with HTTP ${String(response.status)}.`);
  }
  const payload = (await response.json()) as LocalBrowserBridgeDeviceRegisterResult;
  const state = await saveRegistration({
    ...payload,
    assistantId: message.payload.assistantId,
    workspaceId: message.payload.workspaceId,
    apiBaseUrl,
    deviceLabel: message.payload.deviceLabel ?? null,
    clientVersion: message.payload.clientVersion ?? null
  });
  dropSocketIfDeviceChanged(payload.bridgeDeviceId);
  await syncDesiredConnection();
  return buildStatus(state);
}

async function storeDeviceRegistrationResult(
  message: Extract<WebBridgeRequestMessage, { type: "persai.bridge.register_device_result" }>
): Promise<unknown> {
  const state = await saveRegistration({
    ...message.payload,
    apiBaseUrl: message.apiBaseUrl ? normalizeApiBaseUrl(message.apiBaseUrl) : null
  });
  dropSocketIfDeviceChanged(message.payload.bridgeDeviceId);
  await syncDesiredConnection();
  return buildStatus(state);
}

function buildStatus(state: ExtensionStorageState): Record<string, unknown> {
  return {
    connected: hasLiveSocket(),
    desiredConnection,
    bridgeDeviceId: state.registration?.bridgeDeviceId ?? null,
    assistantId: state.registration?.assistantId ?? null,
    workspaceId: state.registration?.workspaceId ?? null,
    profileCount: Object.keys(state.profiles).length,
    lastProfileKey: state.lastProfileKey ?? null
  };
}

const BADGE_COLOR = "#4f46e5";

async function refreshBadgeFromState(): Promise<void> {
  const state = await readState();
  const pendingCount = listAwaitingCompletionProfiles(state).length;
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: pendingCount > 0 ? String(pendingCount) : "" });
}

async function buildStatusForWeb(profileKey: string | null): Promise<Record<string, unknown>> {
  const state = await readState();
  const base = buildStatus(state);
  if (profileKey === null) {
    return { ...base, pendingCompletionAction: null };
  }
  const { state: nextState, action } = consumePendingCompletion(state, profileKey);
  if (action !== null) {
    await writeState(nextState);
    await refreshBadgeFromState();
  }
  return { ...base, pendingCompletionAction: action };
}

async function resolvePendingCompletionFromPopup(
  profileKey: string,
  action: PendingCompletionAction
): Promise<void> {
  await updateState((state) => resolvePendingCompletion(state, profileKey, action));
  await refreshBadgeFromState();
}

async function handleWebBridgeRequest(message: WebBridgeRequestMessage): Promise<unknown> {
  switch (message.type) {
    case "persai.bridge.register_device_request":
      return registerDeviceViaApi(message);
    case "persai.bridge.register_device_result":
      return storeDeviceRegistrationResult(message);
    case "persai.bridge.status":
      return buildStatusForWeb(message.profileKey ?? null);
  }
}

function isKeepalivePort(port: ChromeRuntimePort): boolean {
  return KEEPALIVE_PORT_NAMES.has(String(port?.name ?? ""));
}

function bindKeepalivePort(port: ChromeRuntimePort): void {
  keepalivePortCount += 1;
  void syncDesiredConnection();

  port.onDisconnect.addListener(() => {
    keepalivePortCount = Math.max(0, keepalivePortCount - 1);
    void syncDesiredConnection();
  });

  port.onMessage.addListener((message) => {
    const envelope = message as WebBridgeEnvelope;
    if (envelope?.source !== BRIDGE_MESSAGE_SOURCE || typeof envelope.requestId !== "string") {
      return;
    }
    void handleWebBridgeRequest(envelope.payload)
      .then((result) => {
        port.postMessage({
          source: BRIDGE_MESSAGE_SOURCE,
          requestId: envelope.requestId,
          ok: true,
          result
        });
      })
      .catch((error) => {
        port.postMessage({
          source: BRIDGE_MESSAGE_SOURCE,
          requestId: envelope.requestId,
          ok: false,
          error: error instanceof Error ? error.message : "Bridge request failed."
        });
      });
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (!isKeepalivePort(port)) {
    return;
  }
  bindKeepalivePort(port);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender: unknown, sendResponse: (value: unknown) => void) => {
    const type =
      message && typeof message === "object" ? (message as { type?: string }).type : undefined;

    if (type === "popup.status") {
      void readState().then((state) => sendResponse(buildStatus(state)));
      return true;
    }

    if (type === "popup.pending_profiles") {
      void readState().then((state) => sendResponse(listAwaitingCompletionProfiles(state)));
      return true;
    }

    if (type === "popup.resolve_pending") {
      const request = message as { profileKey?: unknown; action?: unknown };
      const profileKey = typeof request.profileKey === "string" ? request.profileKey : null;
      const action =
        request.action === "complete" || request.action === "cancel" ? request.action : null;
      if (profileKey === null || action === null) {
        sendResponse({ ok: false, error: "Invalid pending completion request." });
        return false;
      }
      void resolvePendingCompletionFromPopup(profileKey, action).then(() =>
        sendResponse({ ok: true })
      );
      return true;
    }

    return false;
  }
);

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isPersaiWebOrigin(sender?.url ?? null)) {
    sendResponse({ ok: false, error: "External sender origin is not allowed." });
    return false;
  }
  void handleWebBridgeRequest(message as WebBridgeRequestMessage)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Bridge request failed."
      })
    );
  return true;
});

async function ensureOriginPermission(pattern: string): Promise<boolean> {
  const contains = await chrome.permissions.contains({ origins: [pattern] });
  if (contains) {
    return true;
  }
  const existing = permissionGrantInFlight.get(pattern);
  if (existing !== undefined) {
    return existing;
  }
  const pending = waitForPermissionGrant(pattern).finally(() => {
    permissionGrantInFlight.delete(pattern);
  });
  permissionGrantInFlight.set(pattern, pending);
  return pending;
}

async function waitForPermissionGrant(pattern: string): Promise<boolean> {
  await openPermissionGrantWindow(pattern);
  const deadline = Date.now() + PERMISSION_GRANT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await chrome.permissions.contains({ origins: [pattern] })) {
      return true;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, PERMISSION_GRANT_POLL_MS);
    });
  }
  return false;
}

async function openPermissionGrantWindow(pattern: string): Promise<void> {
  const base = await computeProfileWindowBounds();
  const width = 460;
  const height = 340;
  const left =
    typeof base.left === "number" && typeof base.width === "number"
      ? base.left + Math.max(0, Math.round((base.width - width) / 2))
      : undefined;
  const top =
    typeof base.top === "number" && typeof base.height === "number"
      ? base.top + Math.max(0, Math.round((base.height - height) / 2))
      : undefined;
  await chrome.windows.create({
    url: `${chrome.runtime.getURL("popup.html")}?grant=${encodeURIComponent(pattern)}`,
    type: "popup",
    focused: true,
    state: "normal",
    width,
    height,
    ...(left === undefined ? {} : { left }),
    ...(top === undefined ? {} : { top })
  });
}

async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.status === "complete") {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out waiting for tab navigation."));
    }, timeoutMs);
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function persistProfilePatch(
  profileKey: string,
  patch: Partial<ProfileSessionRecord>
): Promise<ProfileSessionRecord> {
  const next = await updateState((state) => upsertProfileRecord(state, profileKey, patch));
  return next.profiles[profileKey] as ProfileSessionRecord;
}

async function setWindowVisibility(
  record: ProfileSessionRecord,
  visible: boolean
): Promise<ProfileSessionRecord> {
  if (typeof record.windowId === "number") {
    const bounds = visible ? await computeProfileWindowBounds() : {};
    await chrome.windows.update(record.windowId, {
      state: visible ? "normal" : "minimized",
      focused: visible,
      ...bounds
    });
  }
  return persistProfilePatch(record.profileKey, { visible, updatedAt: Date.now() });
}

/**
 * Size the login popup at roughly 70% of the user's current window footprint
 * with a 16:9 shape, centered — instead of Chrome's tiny default popup.
 */
async function computeProfileWindowBounds(): Promise<{
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}> {
  try {
    // Never derive new bounds from an already-open PersAI popup: focusing a
    // smaller popup made later profile windows shrink. Anchor every open to
    // the largest normal Chrome window in this installation instead.
    const normalWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const base =
      normalWindows.reduce<(typeof normalWindows)[number] | null>((largest, candidate) => {
        const candidateArea = (candidate.width ?? 0) * (candidate.height ?? 0);
        const largestArea = (largest?.width ?? 0) * (largest?.height ?? 0);
        return candidateArea > largestArea ? candidate : largest;
      }, null) ?? (await chrome.windows.getLastFocused());
    const baseWidth = base.width ?? 1600;
    const baseHeight = base.height ?? 900;
    let width = Math.max(960, Math.round(baseWidth * 0.7));
    let height = Math.round((width * 9) / 16);
    const maxHeight = Math.round(baseHeight * 0.9);
    if (height > maxHeight) {
      height = maxHeight;
      width = Math.round((height * 16) / 9);
    }
    const left = (base.left ?? 0) + Math.max(0, Math.round((baseWidth - width) / 2));
    const top = (base.top ?? 0) + Math.max(0, Math.round((baseHeight - height) / 2));
    return { left, top, width, height };
  } catch {
    return { width: 1280, height: 720 };
  }
}

async function createProfileWindow(
  profileKey: string,
  targetUrl: string | null,
  visible: boolean
): Promise<ProfileSessionRecord> {
  const bounds = visible ? await computeProfileWindowBounds() : {};
  const nextWindow = await chrome.windows.create({
    url: targetUrl && targetUrl.length > 0 ? targetUrl : "about:blank",
    type: "popup",
    focused: visible,
    state: visible ? "normal" : "minimized",
    ...bounds
  });
  const tabId = nextWindow.tabs?.[0]?.id;
  if (typeof nextWindow.id !== "number" || typeof tabId !== "number") {
    throw new Error("Chrome did not create a usable bridge window.");
  }
  return persistProfilePatch(profileKey, {
    windowId: nextWindow.id,
    tabId,
    lastKnownUrl: targetUrl,
    originPattern: targetUrl ? buildOriginPermissionPattern(targetUrl) : null,
    visible,
    updatedAt: Date.now()
  });
}

async function resolveOrCreateProfileWindow(
  profileKey: string,
  targetUrl: string | null,
  visible: boolean
): Promise<ProfileSessionRecord> {
  const existing = await reconcileProfileRecord(profileKey);
  if (existing && typeof existing.windowId === "number" && typeof existing.tabId === "number") {
    if (visible) {
      // Normalize bounds on every visible open. An earlier command may have
      // left the window marked visible while the user resized it (or while an
      // old extension build created it at the legacy tiny popup size).
      return setWindowVisibility(existing, true);
    }
    return existing;
  }
  return createProfileWindow(profileKey, targetUrl, visible);
}

function splitOperationsByGoto(
  operations: RuntimeBrowserOperation[]
): Array<{ navigateTo: string | null; operations: RuntimeBrowserOperation[] }> {
  const segments: Array<{ navigateTo: string | null; operations: RuntimeBrowserOperation[] }> = [];
  let pendingNavigateTo: string | null = null;
  let bucket: RuntimeBrowserOperation[] = [];
  for (const operation of operations) {
    if (operation.kind === "goto") {
      if (pendingNavigateTo !== null || bucket.length > 0) {
        segments.push({ navigateTo: pendingNavigateTo, operations: bucket });
      }
      pendingNavigateTo = operation.url;
      bucket = [];
      continue;
    }
    bucket.push(operation);
  }
  if (pendingNavigateTo !== null || bucket.length > 0) {
    segments.push({ navigateTo: pendingNavigateTo, operations: bucket });
  }
  return segments;
}

async function navigateTab(
  record: ProfileSessionRecord,
  url: string,
  timeoutMs: number
): Promise<ProfileSessionRecord> {
  if (typeof record.tabId !== "number") {
    throw new Error("No bridge tab exists for this profile.");
  }
  await chrome.tabs.update(record.tabId, { url });
  await waitForTabLoad(record.tabId, timeoutMs);
  if (assistantOwnedProfileKeys.has(record.profileKey)) {
    await setAssistantOwnershipOverlay(record, true);
  }
  return persistProfilePatch(record.profileKey, {
    tabId: record.tabId,
    lastKnownUrl: url,
    originPattern: buildOriginPermissionPattern(url),
    updatedAt: Date.now()
  });
}

function urlsEquivalent(leftValue: string, rightValue?: string | null): boolean {
  if (!rightValue) {
    return false;
  }
  try {
    const left = new URL(leftValue);
    const right = new URL(rightValue);
    const leftPath = left.pathname || "/";
    const rightPath = right.pathname || "/";
    return (
      left.protocol.toLowerCase() === right.protocol.toLowerCase() &&
      left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
      left.port === right.port &&
      leftPath === rightPath &&
      left.search === right.search
    );
  } catch {
    return leftValue === rightValue;
  }
}

async function setAssistantOwnershipOverlay(
  record: ProfileSessionRecord,
  active: boolean
): Promise<void> {
  if (typeof record.tabId !== "number") {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: record.tabId },
      func: (overlayId: string, enabled: boolean) => {
        document.getElementById(overlayId)?.remove();
        if (!enabled || !document.documentElement) {
          return;
        }
        const host = document.createElement("div");
        host.id = overlayId;
        host.setAttribute("aria-label", "PersAI assistant browser ownership");
        Object.assign(host.style, {
          position: "fixed",
          inset: "0",
          zIndex: "2147483647",
          pointerEvents: "auto",
          cursor: "not-allowed",
          background: "transparent"
        });
        const shadow = host.attachShadow({ mode: "closed" });
        const root = document.createElement("div");
        root.className = "lock";
        const russian = /^ru(?:-|$)/iu.test(navigator.language);
        root.innerHTML = `<style>
          .lock { position: fixed; inset: 0; display: grid; place-items: center; }
          .pill {
            opacity: 0; transform: translateY(4px); transition: opacity .14s ease, transform .14s ease;
            padding: 10px 16px; border-radius: 999px; color: #fff; background: rgba(18,18,24,.82);
            box-shadow: 0 8px 28px rgba(0,0,0,.22); backdrop-filter: blur(10px);
            font: 600 14px/1.25 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            user-select: none;
          }
          .lock:hover .pill, .lock:active .pill { opacity: 1; transform: translateY(0); }
        </style><div class="pill" role="status">${
          russian ? "Работает ассистент!" : "Assistant is working!"
        }</div>`;
        shadow.appendChild(root);
        document.documentElement.appendChild(host);
      },
      args: [ASSISTANT_OWNERSHIP_OVERLAY_ID, active]
    });
  } catch {
    // Restricted Chrome pages cannot host the observer lock. The command will
    // return its normal structured browser error if page execution is blocked.
  }
}

async function executePageRunner(
  record: ProfileSessionRecord,
  operations: RuntimeBrowserOperation[],
  hostPageScript: string | null
): Promise<PageRunnerResult> {
  if (typeof record.tabId !== "number") {
    throw new Error("No bridge tab exists for this profile.");
  }
  const injection = await chrome.scripting.executeScript({
    target: { tabId: record.tabId },
    func: runPageCommandInPage,
    args: [
      {
        maxChars: DEFAULT_MAX_CHARS,
        maxElements: MAX_INTERACTIVE_ELEMENTS,
        maxExtractItems: MAX_EXTRACT_ITEMS,
        settleAfterMutationMs: DEFAULT_MUTATION_SETTLE_MS,
        domReadyTimeoutMs: MAX_DOM_READY_WAIT_MS,
        hostPageScript,
        operations: operations.slice(0, MAX_OPERATION_COUNT)
      }
    ]
  });
  const result = injection?.[0]?.result as PageRunnerResult | undefined;
  if (!result) {
    throw new Error("The page runner returned no result.");
  }
  return result;
}

async function captureArtifact(
  record: ProfileSessionRecord,
  format: LocalBrowserCommand["format"]
): Promise<{ mimeType: string; base64: string } | null> {
  if (format !== "png" && format !== "jpeg") {
    return null;
  }
  if (typeof record.windowId !== "number") {
    return null;
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(record.windowId, { format });
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("Chrome returned an invalid screenshot payload.");
  }
  return parsed;
}

/**
 * `open_view` only needs to show the user a site so they can complete a
 * login or manual step. Creating/showing a window and navigating a tab you
 * own does not require a Chrome host permission grant — only DOM access
 * (`chrome.scripting.executeScript`, `chrome.tabs.captureVisibleTab`) does.
 * So this path deliberately skips the browser-access permission gate and never
 * blocks on `waitForTabLoad`; it kicks the navigation and returns
 * immediately so the API `open-live` call resolves well under its timeout
 * instead of racing a fast permission-denied 409 or a slow page-load 409.
 */
async function handleOpenView(
  record: ProfileSessionRecord,
  command: LocalBrowserCommand
): Promise<LocalBrowserResult> {
  const targetUrl = typeof command.url === "string" && command.url.length > 0 ? command.url : null;
  let finalRecord = record;
  let navigationWarning: string | null = null;

  if (targetUrl !== null && targetUrl !== record.lastKnownUrl && typeof record.tabId === "number") {
    try {
      await chrome.tabs.update(record.tabId, { url: targetUrl });
      finalRecord = await persistProfilePatch(record.profileKey, {
        lastKnownUrl: targetUrl,
        originPattern: buildOriginPermissionPattern(targetUrl),
        updatedAt: Date.now()
      });
    } catch (error) {
      navigationWarning =
        error instanceof Error ? error.message : "Failed to start navigation in the bridge window.";
    }
  }

  await updateState((state) => setAwaitingCompletion(state, record.profileKey, true));
  await refreshBadgeFromState();

  return {
    commandId: command.commandId,
    ok: true,
    finalUrl: finalRecord.lastKnownUrl ?? targetUrl,
    warning:
      mergeWarnings(
        "Bridge window opened for user assistance; return to PersAI and press Done when login is finished.",
        navigationWarning
      ) ?? null
  };
}

/**
 * `check_view` is the permission-free liveness check used by `complete-login`
 * on desktop. MV3 cannot run a DOM snapshot on a third-party origin without a
 * host permission, and a WebSocket-dispatched command has no user gesture to
 * request one — so login verification must not depend on DOM access. The
 * device answering at all proves the bridge is alive; the human pressing Done
 * in PersAI is the login truth source. Never creates or focuses a window.
 */
async function handleCheckView(command: LocalBrowserCommand): Promise<LocalBrowserResult> {
  const record = await reconcileProfileRecord(command.profileKey);
  let currentUrl: string | null = record?.lastKnownUrl ?? null;
  if (record && typeof record.tabId === "number") {
    try {
      const tab = await chrome.tabs.get(record.tabId);
      currentUrl = tab?.url ?? currentUrl;
    } catch {
      // Tab is gone; fall back to the last known URL.
    }
  }
  const windowOpen = record !== null && typeof record.windowId === "number";
  return {
    commandId: command.commandId,
    ok: true,
    finalUrl: currentUrl,
    warning: windowOpen ? null : "Bridge window is no longer open; using last known state."
  };
}

async function executeBrowserCommand(command: LocalBrowserCommand): Promise<LocalBrowserResult> {
  if (command.action === "check_view") {
    return handleCheckView(command);
  }
  if (command.action === "close_view") {
    const existing = await reconcileProfileRecord(command.profileKey);
    if (existing === null) {
      return {
        commandId: command.commandId,
        ok: true,
        finalUrl: null,
        warning: null
      };
    }
    const hidden = await setWindowVisibility(existing, false);
    await updateState((state) => setAwaitingCompletion(state, hidden.profileKey, false));
    await refreshBadgeFromState();
    return {
      commandId: command.commandId,
      ok: true,
      finalUrl: hidden.lastKnownUrl ?? null,
      warning: "Bridge window minimized."
    };
  }
  const showWindow = command.action === "open_view" || command.showWindow === true;
  let record = await resolveOrCreateProfileWindow(
    command.profileKey,
    command.url ?? null,
    showWindow
  );
  if (showWindow && !record.visible) {
    record = await setWindowVisibility(record, true);
  }

  if (command.action === "open_view") {
    return handleOpenView(record, command);
  }

  const currentTab = typeof record.tabId === "number" ? await chrome.tabs.get(record.tabId) : null;
  const browserAccessGranted = await ensureOriginPermission(SCREENSHOT_PERMISSION_PATTERN);
  if (!browserAccessGranted) {
    return buildPermissionDeniedResult(command.commandId, SCREENSHOT_PERMISSION_PATTERN);
  }

  assistantOwnedProfileKeys.add(record.profileKey);
  await setAssistantOwnershipOverlay(record, true);
  try {
    const timeoutMs = normalizeCommandTimeout(command);

    const currentUrl = currentTab?.url ?? record.lastKnownUrl;
    if (
      !command.stayOnPage &&
      typeof command.url === "string" &&
      command.url.length > 0 &&
      !urlsEquivalent(command.url, currentUrl)
    ) {
      record = await navigateTab(record, command.url, timeoutMs);
    } else if (command.stayOnPage !== true && !record.lastKnownUrl && currentTab?.url) {
      record = await persistProfilePatch(record.profileKey, {
        lastKnownUrl: currentTab.url,
        originPattern: buildOriginPermissionPattern(currentTab.url),
        updatedAt: Date.now()
      });
    }

    const hostPageScript = await resolveHostScriptSource(command);
    const segments = splitOperationsByGoto(command.operations ?? []);
    let finalResult: PageRunnerResult | null = null;

    if (segments.length === 0) {
      finalResult = await executePageRunner(record, [], hostPageScript);
    } else {
      for (const segment of segments) {
        if (segment.navigateTo) {
          record = await navigateTab(record, segment.navigateTo, timeoutMs);
        }
        finalResult = await executePageRunner(record, segment.operations, hostPageScript);
      }
    }

    if (finalResult === null) {
      finalResult = await executePageRunner(record, [], hostPageScript);
    }

    if (command.format === "pdf") {
      return {
        ...buildUnsupportedPdfResult(command.commandId),
        finalUrl: finalResult.finalUrl,
        title: finalResult.title
      };
    }

    if (command.format === "png" || command.format === "jpeg" || command.format === "webp") {
      if (command.format === "webp") {
        return {
          ...buildUnsupportedScreenshotResult(
            command.commandId,
            "Chrome tab capture only supports png and jpeg here."
          ),
          finalUrl: finalResult.finalUrl,
          title: finalResult.title
        };
      }
      try {
        // Keep the observer lock out of assistant screenshots. The page stays
        // unlocked only for the capture tick and is re-locked before returning.
        await setAssistantOwnershipOverlay(record, false);
        const artifact = await captureArtifact(record, command.format);
        await setAssistantOwnershipOverlay(record, true);
        if (!artifact) {
          return {
            ...buildUnsupportedScreenshotResult(command.commandId),
            finalUrl: finalResult.finalUrl,
            title: finalResult.title
          };
        }
        return {
          commandId: command.commandId,
          ok: true,
          finalUrl: finalResult.finalUrl,
          title: finalResult.title,
          warning: finalResult.warning ?? null,
          artifact
        };
      } catch (error) {
        await setAssistantOwnershipOverlay(record, true);
        return {
          ...buildUnsupportedScreenshotResult(
            command.commandId,
            error instanceof Error ? error.message : "Chrome screenshot capture failed."
          ),
          finalUrl: finalResult.finalUrl,
          title: finalResult.title
        };
      }
    }

    return {
      commandId: command.commandId,
      ok: true,
      finalUrl: finalResult.finalUrl,
      title: finalResult.title,
      content: finalResult.content,
      truncated: finalResult.truncated,
      elements: finalResult.elements,
      extracted: finalResult.extracted,
      warning: finalResult.warning ?? null
    };
  } finally {
    assistantOwnedProfileKeys.delete(record.profileKey);
    await setAssistantOwnershipOverlay(record, false);
  }
}

async function handleIncomingCommand(command: LocalBrowserCommand): Promise<void> {
  activeCommandCount += 1;
  await syncDesiredConnection();
  try {
    const result = await executeBrowserCommand(command);
    if (hasLiveSocket()) {
      socket?.send(JSON.stringify(result));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command execution failed.";
    if (hasLiveSocket()) {
      socket?.send(JSON.stringify(buildExecutorFailureResult(command.commandId, message)));
    }
  } finally {
    activeCommandCount = Math.max(0, activeCommandCount - 1);
    await syncDesiredConnection();
  }
}
