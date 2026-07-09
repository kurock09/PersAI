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
  NEEDS_USER_ACTION_REASON,
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
  listCommandOriginPatterns,
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

let socket: WebSocket | null = null;
/** Bridge device id the current socket authenticated with. */
let socketDeviceId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let desiredConnection = false;
let keepalivePortCount = 0;
let activeCommandCount = 0;
let commandQueue = Promise.resolve();

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
  const response = await fetch(`${apiBaseUrl}/api/v1/assistant/browser-bridge/devices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${message.bearerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...message.payload,
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
  return chrome.permissions.request({ origins: [pattern] });
}

async function ensureCommandPermissions(
  command: LocalBrowserCommand,
  currentUrl?: string | null
): Promise<{ granted: true } | { granted: false; pattern: string }> {
  for (const pattern of listCommandOriginPatterns(command, currentUrl)) {
    const granted = await ensureOriginPermission(pattern);
    if (!granted) {
      return { granted: false, pattern };
    }
  }
  return { granted: true };
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
    await chrome.windows.update(record.windowId, {
      state: visible ? "normal" : "minimized",
      focused: visible
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
    const focused = await chrome.windows.getLastFocused();
    const baseWidth = focused.width ?? 1600;
    const baseHeight = focused.height ?? 900;
    let width = Math.max(960, Math.round(baseWidth * 0.7));
    let height = Math.round((width * 9) / 16);
    const maxHeight = Math.round(baseHeight * 0.9);
    if (height > maxHeight) {
      height = maxHeight;
      width = Math.round((height * 16) / 9);
    }
    const left = (focused.left ?? 0) + Math.max(0, Math.round((baseWidth - width) / 2));
    const top = (focused.top ?? 0) + Math.max(0, Math.round((baseHeight - height) / 2));
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
    if (visible && !existing.visible) {
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
  return persistProfilePatch(record.profileKey, {
    tabId: record.tabId,
    lastKnownUrl: url,
    originPattern: buildOriginPermissionPattern(url),
    updatedAt: Date.now()
  });
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
 * So this path deliberately skips `ensureCommandPermissions` and never
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
  const showWindow = command.action === "open_view" || command.showWindow === true;
  let record = await resolveOrCreateProfileWindow(
    command.profileKey,
    command.url ?? null,
    showWindow
  );
  if (command.action === "close_view") {
    record = await setWindowVisibility(record, false);
    await updateState((state) => setAwaitingCompletion(state, record.profileKey, false));
    await refreshBadgeFromState();
    return {
      commandId: command.commandId,
      ok: true,
      finalUrl: record.lastKnownUrl ?? null,
      warning: "Bridge window minimized."
    };
  }

  if (showWindow && !record.visible) {
    record = await setWindowVisibility(record, true);
  }

  if (command.action === "open_view") {
    return handleOpenView(record, command);
  }

  const currentTab = typeof record.tabId === "number" ? await chrome.tabs.get(record.tabId) : null;
  const permissionCheck = await ensureCommandPermissions(
    command,
    currentTab?.url ?? record.lastKnownUrl ?? null
  );
  if (permissionCheck.granted === false) {
    return buildPermissionDeniedResult(command.commandId, permissionCheck.pattern);
  }

  const timeoutMs = normalizeCommandTimeout(command);

  if (!command.stayOnPage && typeof command.url === "string" && command.url.length > 0) {
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
      if (finalResult.needsUserAction) {
        await setWindowVisibility(record, true);
        return {
          commandId: command.commandId,
          ok: false,
          finalUrl: finalResult.finalUrl,
          title: finalResult.title,
          content: finalResult.content,
          truncated: finalResult.truncated,
          elements: finalResult.elements,
          extracted: finalResult.extracted,
          errorReason: NEEDS_USER_ACTION_REASON,
          warning:
            mergeWarnings(
              "User action is required in the visible browser window.",
              finalResult.warning
            ) ?? null
        };
      }
    }
  }

  if (finalResult === null) {
    finalResult = await executePageRunner(record, [], hostPageScript);
  }

  if (finalResult.needsUserAction) {
    await setWindowVisibility(record, true);
    return {
      commandId: command.commandId,
      ok: false,
      finalUrl: finalResult.finalUrl,
      title: finalResult.title,
      content: finalResult.content,
      truncated: finalResult.truncated,
      elements: finalResult.elements,
      extracted: finalResult.extracted,
      errorReason: NEEDS_USER_ACTION_REASON,
      warning:
        mergeWarnings(
          "User action is required in the visible browser window.",
          finalResult.warning
        ) ?? null
    };
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
      const artifact = await captureArtifact(record, command.format);
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
