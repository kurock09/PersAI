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
import { buildOriginPermissionPattern, isPersaiWebOrigin, listCommandOriginPatterns, normalizeApiBaseUrl } from "./permissions.js";
import {
  type ExtensionStorageState,
  storeRegistration,
  type ProfileSessionRecord,
  upsertProfileRecord
} from "./profile-state.js";
import { runPageCommandInPage, type PageRunnerResult } from "./page-runner.js";
import { readState, reconcileProfileRecord, updateState } from "./storage.js";

const KEEPALIVE_PORT_NAMES = new Set(["persai-page-keepalive", "persai-popup-keepalive"]);

let socket: WebSocket | null = null;
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

async function registerDeviceViaApi(message: Extract<WebBridgeRequestMessage, { type: "persai.bridge.register_device_request" }>): Promise<unknown> {
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

async function handleWebBridgeRequest(message: WebBridgeRequestMessage): Promise<unknown> {
  switch (message.type) {
    case "persai.bridge.register_device_request":
      return registerDeviceViaApi(message);
    case "persai.bridge.register_device_result":
      return storeDeviceRegistrationResult(message);
    case "persai.bridge.status":
      return buildStatus(await readState());
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

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (value: unknown) => void) => {
  if (message && typeof message === "object" && (message as { type?: string }).type === "popup.status") {
    void readState().then((state) => sendResponse(buildStatus(state)));
    return true;
  }
  return false;
});

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (!isPersaiWebOrigin(sender?.url ?? null)) {
      sendResponse({ ok: false, error: "External sender origin is not allowed." });
      return false;
    }
    void handleWebBridgeRequest(message as WebBridgeRequestMessage)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Bridge request failed." })
      );
    return true;
  }
);

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

async function persistProfilePatch(profileKey: string, patch: Partial<ProfileSessionRecord>): Promise<ProfileSessionRecord> {
  const next = await updateState((state) => upsertProfileRecord(state, profileKey, patch));
  return next.profiles[profileKey] as ProfileSessionRecord;
}

async function setWindowVisibility(record: ProfileSessionRecord, visible: boolean): Promise<ProfileSessionRecord> {
  if (typeof record.windowId === "number") {
    await chrome.windows.update(record.windowId, {
      state: visible ? "normal" : "minimized",
      focused: visible
    });
  }
  return persistProfilePatch(record.profileKey, { visible, updatedAt: Date.now() });
}

async function createProfileWindow(profileKey: string, targetUrl: string | null, visible: boolean): Promise<ProfileSessionRecord> {
  const nextWindow = await chrome.windows.create({
    url: targetUrl && targetUrl.length > 0 ? targetUrl : "about:blank",
    type: "popup",
    focused: visible,
    state: visible ? "normal" : "minimized"
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

function splitOperationsByGoto(operations: RuntimeBrowserOperation[]): Array<{ navigateTo: string | null; operations: RuntimeBrowserOperation[] }> {
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

async function navigateTab(record: ProfileSessionRecord, url: string, timeoutMs: number): Promise<ProfileSessionRecord> {
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

async function executeBrowserCommand(command: LocalBrowserCommand): Promise<LocalBrowserResult> {
  const showWindow = command.action === "open_view" || command.showWindow === true;
  let record = await resolveOrCreateProfileWindow(command.profileKey, command.url ?? null, showWindow);
  if (command.action === "close_view") {
    record = await setWindowVisibility(record, false);
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

  const currentTab = typeof record.tabId === "number" ? await chrome.tabs.get(record.tabId) : null;
  const permissionCheck = await ensureCommandPermissions(command, currentTab?.url ?? record.lastKnownUrl ?? null);
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

  if (command.action === "open_view") {
    return {
      commandId: command.commandId,
      ok: true,
      finalUrl: record.lastKnownUrl ?? currentTab?.url ?? null,
      warning: "Bridge window opened for user assistance."
    };
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
          warning: mergeWarnings("User action is required in the visible browser window.", finalResult.warning) ?? null
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
      warning: mergeWarnings("User action is required in the visible browser window.", finalResult.warning) ?? null
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
        ...buildUnsupportedScreenshotResult(command.commandId, "Chrome tab capture only supports png and jpeg here."),
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
