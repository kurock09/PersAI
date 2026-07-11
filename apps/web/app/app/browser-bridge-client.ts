import type {
  LocalBrowserBridgeDeviceRegisterResult,
  LocalBrowserBridgeWebSocketConnectRequest,
  LocalBrowserCommand,
  LocalBrowserResult,
  RuntimeBrowserOperation
} from "@persai/runtime-contract";
import { PAGE_RUNNER_SOURCE } from "./browser-bridge-page-runner-source";

const BRIDGE_MESSAGE_SOURCE = "persai-browser-extension";

const EXTENSION_STATUS_TIMEOUT_MS = 1_200;
const MAX_OPERATION_COUNT = 12;
const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_EXTRACT_ITEMS = 50;
const MAX_DOM_READY_WAIT_MS = 10_000;
const DEFAULT_MUTATION_SETTLE_MS = 800;
const CURRENT_BRIDGE_STATUS_CACHE_MS = 30_000;
const DEFAULT_MAX_CHARS = 12_000;
/** Keep the serial Capacitor queue moving even if native executeCommand never returns. */
const NATIVE_COMMAND_TRANSPORT_RESERVE_MS = 5_000;
const MAX_NATIVE_COMMAND_WAIT_MS = 40_000;
const DEFAULT_NATIVE_COMMAND_TIMEOUT_MS = 45_000;
const NATIVE_REGISTRATION_SAFE_AGE_MS = 14 * 60 * 1000;
const NATIVE_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export const PERSAI_BROWSER_BRIDGE_WEB_STORE_URL: string | null = null;

type BridgeStatusRequestMessage = {
  type: "persai.bridge.status";
  /**
   * Optional defensive relay slot for extension-side completion decisions.
   * The primary desktop login UX keeps Готово/Отмена in the PersAI web modal,
   * where Clerk auth is available.
   */
  profileKey?: string;
};

type BridgeRegisterDeviceRequestMessage = {
  type: "persai.bridge.register_device_request";
  apiBaseUrl: string;
  bearerToken: string;
  payload: {
    assistantId: string;
    workspaceId: string;
    deviceKind: "extension";
    deviceLabel?: string | null;
    clientVersion?: string | null;
  };
};

type BridgeSetObserverLockMessage = {
  type: "persai.bridge.set_observer_lock";
  active: boolean;
  profileKey?: string;
};

type WebBridgeEnvelope = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  requestId: string;
  payload:
    | BridgeStatusRequestMessage
    | BridgeRegisterDeviceRequestMessage
    | BridgeSetObserverLockMessage;
};

type WebBridgeResponseEnvelope = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type ExtensionBridgePendingCompletionAction = "complete" | "cancel";

export type ExtensionBridgeStatus = {
  connected: boolean;
  desiredConnection: boolean;
  bridgeDeviceId: string | null;
  assistantId: string | null;
  workspaceId: string | null;
  profileCount: number;
  lastProfileKey: string | null;
  /**
   * Set only by extension-side fallback completion paths. `null` when no
   * decision is pending or no `profileKey` was requested. The extension clears
   * this value once reported, so it is delivered at most once per decision.
   */
  pendingCompletionAction?: ExtensionBridgePendingCompletionAction | null;
};

export type RegisterExtensionBridgeDeviceInput = {
  token: string;
  assistantId: string;
  workspaceId: string;
};

type NativeBridgeExecutePayload = {
  command: LocalBrowserCommand;
  runnerSource: string;
  hostPageScript?: string | null;
  segments: Array<{ navigateTo: string | null; operations: RuntimeBrowserOperation[] }>;
  maxChars: number;
  maxElements: number;
  maxExtractItems: number;
  settleAfterMutationMs: number;
  domReadyTimeoutMs: number;
};

type NativeBrowserBridgePlugin = {
  executeCommand(options: { payloadJson: string }): Promise<LocalBrowserResult>;
  addListener(
    eventName: "browserPreview",
    listener: (event: NativeBrowserPreviewEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
};

export type NativeBrowserPreviewEvent = {
  phase: "start" | "update" | "end" | "overlay_hidden";
  profileKey: string;
  pageUrl: string | null;
  imageDataUrl: string | null;
  faviconDataUrl?: string | null;
};

type NativeBridgeRuntimeState = {
  socket: WebSocket | null;
  registration: LocalBrowserBridgeDeviceRegisterResult | null;
  registrationAt: number | null;
  assistantId: string | null;
  workspaceId: string | null;
  commandQueue: Promise<void>;
};

const nativeBridgeState: NativeBridgeRuntimeState = {
  socket: null,
  registration: null,
  registrationAt: null,
  assistantId: null,
  workspaceId: null,
  commandQueue: Promise.resolve()
};

/**
 * Singleton connect attempt. Registration mints a new bridge device id, so two
 * overlapping connects would churn device identity and orphan the socket the
 * server is about to dispatch to.
 */
let nativeConnectInFlight: Promise<ExtensionBridgeStatus> | null = null;
let nativeReconnectTimer: number | null = null;
let nativeReconnectAttempts = 0;
const nativeObserverLockedProfileKeys = new Set<string>();

export function bypassesNativeBrowserExecutionQueue(
  action: LocalBrowserCommand["action"]
): boolean {
  return (
    action === "open_view" ||
    action === "close_view" ||
    action === "check_view" ||
    action === "set_observer_lock"
  );
}

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

function getBridgeApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv
      .trim()
      .replace(/\/$/, "")
      .replace(/\/api\/v1$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3001";
}

let currentBridgeStatusCache: { status: ExtensionBridgeStatus; observedAt: number } | null = null;

function rememberCurrentBridgeStatus(status: ExtensionBridgeStatus): ExtensionBridgeStatus {
  currentBridgeStatusCache = { status, observedAt: Date.now() };
  return status;
}

export function getCachedCurrentLocalBrowserBridgeStatus(): ExtensionBridgeStatus | null {
  if (
    currentBridgeStatusCache === null ||
    Date.now() - currentBridgeStatusCache.observedAt > CURRENT_BRIDGE_STATUS_CACHE_MS
  ) {
    return null;
  }
  return currentBridgeStatusCache.status;
}

function toBridgeStatus(): ExtensionBridgeStatus {
  return rememberCurrentBridgeStatus({
    connected: nativeBridgeState.socket?.readyState === WebSocket.OPEN,
    desiredConnection: nativeBridgeState.registration !== null,
    bridgeDeviceId: nativeBridgeState.registration?.bridgeDeviceId ?? null,
    assistantId: nativeBridgeState.assistantId,
    workspaceId: nativeBridgeState.workspaceId,
    profileCount: 0,
    lastProfileKey: null
  });
}

export async function getCurrentLocalBrowserBridgeStatus(
  timeoutMs = EXTENSION_STATUS_TIMEOUT_MS
): Promise<ExtensionBridgeStatus> {
  return isNativeBrowserBridgeShell() ? toBridgeStatus() : getExtensionBridgeStatus(timeoutMs);
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

/**
 * Cached Capacitor plugin proxy. CRITICAL: this proxy must never become the
 * resolution value of a Promise (e.g. returned from an async function).
 * Capacitor's plugin proxy answers EVERY property access — including `then` —
 * with a native method wrapper, so promise resolution treats it as a thenable
 * and calls `proxy.then()`, which throws
 * `"PersaiBrowserBridge.then()" is not implemented on android` and leaves the
 * awaiting caller hung forever (every native command then dies as
 * `bridge_command_timeout`).
 */
let nativeBrowserBridgePlugin: NativeBrowserBridgePlugin | null = null;

async function ensureNativeBrowserBridgePlugin(): Promise<void> {
  if (nativeBrowserBridgePlugin !== null) {
    return;
  }
  const { registerPlugin } = await import("@capacitor/core");
  nativeBrowserBridgePlugin = registerPlugin<NativeBrowserBridgePlugin>("PersaiBrowserBridge");
}

async function executeNativeCommand(command: LocalBrowserCommand): Promise<LocalBrowserResult> {
  await ensureNativeBrowserBridgePlugin();
  const plugin = nativeBrowserBridgePlugin!;
  const operations = (command.operations ?? []).slice(0, MAX_OPERATION_COUNT);
  const payload: NativeBridgeExecutePayload = {
    command: { ...command, operations },
    runnerSource: PAGE_RUNNER_SOURCE,
    hostPageScript: null,
    segments: splitOperationsByGoto(operations),
    maxChars: DEFAULT_MAX_CHARS,
    maxElements: MAX_INTERACTIVE_ELEMENTS,
    maxExtractItems: MAX_EXTRACT_ITEMS,
    settleAfterMutationMs: DEFAULT_MUTATION_SETTLE_MS,
    domReadyTimeoutMs: MAX_DOM_READY_WAIT_MS
  };
  return plugin.executeCommand({ payloadJson: JSON.stringify(payload) });
}

export async function subscribeNativeBrowserPreview(
  listener: (event: NativeBrowserPreviewEvent) => void
): Promise<() => Promise<void>> {
  if (!isNativeBrowserBridgeShell()) {
    return async () => undefined;
  }
  await ensureNativeBrowserBridgePlugin();
  const handle = await nativeBrowserBridgePlugin!.addListener("browserPreview", (event) => {
    if (event.phase !== "overlay_hidden") {
      nativeObserverLockedProfileKeys.add(event.profileKey);
    }
    listener(event);
  });
  return async () => {
    await handle.remove();
  };
}

async function sendNativeBridgeResult(result: LocalBrowserResult): Promise<void> {
  if (nativeBridgeState.socket?.readyState !== WebSocket.OPEN) {
    return;
  }
  nativeBridgeState.socket.send(JSON.stringify(result));
}

async function raceWithTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  if (!(timeoutMs > 0)) {
    throw new Error(timeoutMessage);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function computeNativeCommandDeadlineMs(command: LocalBrowserCommand): number {
  const timeoutMs =
    Number.isInteger(command.timeoutMs) && Number(command.timeoutMs) > 0
      ? Number(command.timeoutMs)
      : DEFAULT_NATIVE_COMMAND_TIMEOUT_MS;
  return Math.max(
    1_000,
    Math.min(MAX_NATIVE_COMMAND_WAIT_MS, timeoutMs - NATIVE_COMMAND_TRANSPORT_RESERVE_MS)
  );
}

async function handleNativeBridgeCommand(command: LocalBrowserCommand): Promise<void> {
  try {
    if (command.action === "snapshot" || command.action === "act") {
      nativeObserverLockedProfileKeys.add(command.profileKey);
    }
    const deadlineMs = computeNativeCommandDeadlineMs(command);
    const result = await raceWithTimeout(
      executeNativeCommand(command),
      deadlineMs,
      `Timed out after ${String(deadlineMs)}ms waiting for the native browser command.`
    );
    await sendNativeBridgeResult(result);
  } catch (error) {
    await sendNativeBridgeResult({
      commandId: command.commandId,
      ok: false,
      errorReason: "bridge_executor_error",
      warning: error instanceof Error ? error.message : "Native browser bridge command failed."
    });
  }
}

async function registerNativeBridgeDevice(
  input: RegisterExtensionBridgeDeviceInput
): Promise<LocalBrowserBridgeDeviceRegisterResult> {
  const storageKey = `persai:native-bridge:device:${input.assistantId}::${input.workspaceId}`;
  let previousBridgeDeviceId: string | null = null;
  try {
    previousBridgeDeviceId = window.localStorage.getItem(storageKey);
  } catch {
    // Storage-disabled WebViews degrade to a fresh device id.
  }
  const response = await fetch(`${getBridgeApiBaseUrl()}/api/v1/assistant/browser-bridge/devices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      deviceKind: "capacitor",
      ...(previousBridgeDeviceId === null ? {} : { bridgeDeviceId: previousBridgeDeviceId }),
      deviceLabel: "PersAI Mobile App",
      clientVersion: "0.0.0"
    })
  });
  if (!response.ok) {
    throw new Error(`Device registration failed with HTTP ${String(response.status)}.`);
  }
  const registration = (await response.json()) as LocalBrowserBridgeDeviceRegisterResult;
  try {
    window.localStorage.setItem(storageKey, registration.bridgeDeviceId);
  } catch {
    // Registration remains usable for this app process.
  }
  return registration;
}

async function connectNativeBridgeSocket(
  input: RegisterExtensionBridgeDeviceInput
): Promise<ExtensionBridgeStatus> {
  if (
    nativeBridgeState.socket?.readyState === WebSocket.OPEN &&
    nativeBridgeState.assistantId === input.assistantId &&
    nativeBridgeState.workspaceId === input.workspaceId
  ) {
    return toBridgeStatus();
  }
  if (nativeConnectInFlight !== null) {
    return nativeConnectInFlight;
  }
  nativeConnectInFlight = performNativeBridgeConnect(input).finally(() => {
    nativeConnectInFlight = null;
  });
  return nativeConnectInFlight;
}

async function performNativeBridgeConnect(
  input: RegisterExtensionBridgeDeviceInput
): Promise<ExtensionBridgeStatus> {
  if (nativeReconnectTimer !== null) {
    window.clearTimeout(nativeReconnectTimer);
    nativeReconnectTimer = null;
  }
  if (nativeBridgeState.socket !== null) {
    try {
      nativeBridgeState.socket.close(1000, "bridge_reconnect");
    } catch {
      // Ignore close failures on broken sockets.
    }
    nativeBridgeState.socket = null;
  }

  const registration = await registerNativeBridgeDevice(input);
  nativeBridgeState.registration = registration;
  nativeBridgeState.registrationAt = Date.now();
  nativeBridgeState.assistantId = input.assistantId;
  nativeBridgeState.workspaceId = input.workspaceId;
  nativeReconnectAttempts = 0;
  await openNativeBridgeSocket(input, registration);
  return toBridgeStatus();
}

async function openNativeBridgeSocket(
  input: RegisterExtensionBridgeDeviceInput,
  registration: LocalBrowserBridgeDeviceRegisterResult
): Promise<void> {
  const socket = new WebSocket(registration.websocketUrl);
  nativeBridgeState.socket = socket;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    socket.addEventListener("open", () => {
      const payload: LocalBrowserBridgeWebSocketConnectRequest = {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        bridgeDeviceId: registration.bridgeDeviceId,
        deviceKind: "capacitor",
        deviceToken: registration.deviceToken
      };
      socket.send(JSON.stringify(payload));
      nativeReconnectAttempts = 0;
      settled = true;
      resolve();
    });
    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data)) as LocalBrowserCommand;
      if (bypassesNativeBrowserExecutionQueue(parsed.action)) {
        void handleNativeBridgeCommand(parsed);
        return;
      }
      nativeBridgeState.commandQueue = nativeBridgeState.commandQueue.then(() =>
        handleNativeBridgeCommand(parsed)
      );
    });
    socket.addEventListener("close", () => {
      if (nativeBridgeState.socket === socket) {
        nativeBridgeState.socket = null;
      }
      if (!settled) {
        reject(new Error("Native browser bridge websocket closed before opening."));
        return;
      }
      scheduleNativeReconnect(input, registration);
    });
    socket.addEventListener("error", () => {
      if (!settled) {
        reject(new Error("Native browser bridge websocket connection failed."));
      }
    });
  });
}

function scheduleNativeReconnect(
  input: RegisterExtensionBridgeDeviceInput,
  registration: LocalBrowserBridgeDeviceRegisterResult
): void {
  if (
    nativeReconnectTimer !== null ||
    nativeBridgeState.registration !== registration ||
    nativeBridgeState.registrationAt === null ||
    Date.now() - nativeBridgeState.registrationAt >= NATIVE_REGISTRATION_SAFE_AGE_MS
  ) {
    return;
  }
  const delay =
    NATIVE_RECONNECT_DELAYS_MS[
      Math.min(nativeReconnectAttempts, NATIVE_RECONNECT_DELAYS_MS.length - 1)
    ] ?? 30_000;
  nativeReconnectAttempts += 1;
  nativeReconnectTimer = window.setTimeout(() => {
    nativeReconnectTimer = null;
    if (nativeBridgeState.socket !== null) {
      return;
    }
    void openNativeBridgeSocket(input, registration).catch(() => {
      scheduleNativeReconnect(input, registration);
    });
  }, delay);
}

async function requestExtensionBridgeStatus(
  payload: WebBridgeEnvelope["payload"],
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
        resolve(rememberCurrentBridgeStatus(envelope.result));
      });
    };

    const timerId = window.setTimeout(() => {
      finish(timerId, () => {
        reject(new Error("PersAI Browser Bridge extension was not detected."));
      });
    }, timeoutMs);

    window.addEventListener("message", onMessage);

    const envelope: WebBridgeEnvelope = {
      source: BRIDGE_MESSAGE_SOURCE,
      requestId,
      payload
    };
    window.postMessage(envelope, window.location.origin);
  });
}

export async function getExtensionBridgeStatus(
  timeoutMs = EXTENSION_STATUS_TIMEOUT_MS,
  profileKey?: string
): Promise<ExtensionBridgeStatus> {
  return requestExtensionBridgeStatus(
    profileKey ? { type: "persai.bridge.status", profileKey } : { type: "persai.bridge.status" },
    timeoutMs
  );
}

function postExtensionObserverLock(active: boolean, profileKey?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const envelope: WebBridgeEnvelope = {
    source: BRIDGE_MESSAGE_SOURCE,
    requestId: `persai-observer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    payload: {
      type: "persai.bridge.set_observer_lock",
      active,
      ...(profileKey ? { profileKey } : {})
    }
  };
  window.postMessage(envelope, window.location.origin);
}

const REGISTER_THROTTLE_MS = 15_000;

function registerThrottleStorageKey(assistantId: string, workspaceId: string): string {
  return `persai:bridge:last-register:${assistantId}::${workspaceId}`;
}

function readLastRegisterAttempt(storageKey: string): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Private-mode / storage-disabled browsers: fall back to no throttling.
    return null;
  }
}

function writeLastRegisterAttempt(storageKey: string, at: number): void {
  try {
    window.localStorage.setItem(storageKey, String(at));
  } catch {
    // Ignore storage failures; the throttle degrades to per-call only.
  }
}

/**
 * Registering mints a NEW bridge device id and makes the extension drop its
 * live socket and reconnect (see `dropSocketIfDeviceChanged` in
 * `background.ts`). The login modal polls this every 3s, and — critically —
 * every open PersAI tab/window runs its own independent poll loop. A
 * per-component throttle (a React ref) only protects a single tab; with two
 * tabs open (e.g. a settings page and a chat) each tab throttles to its own
 * 15s window, so the extension still sees a fresh registration every few
 * seconds, forcing a reconnect storm that kills any in-flight `open_view`
 * with `bridge_connection_closed`. Sharing the throttle window via
 * localStorage makes every tab in the browser respect the same cooldown.
 */
export async function registerExtensionBridgeDevice(
  input: RegisterExtensionBridgeDeviceInput,
  timeoutMs = 5_000
): Promise<ExtensionBridgeStatus> {
  const storageKey = registerThrottleStorageKey(input.assistantId, input.workspaceId);
  const lastAttempt = readLastRegisterAttempt(storageKey);
  const now = Date.now();
  if (lastAttempt !== null && now - lastAttempt < REGISTER_THROTTLE_MS) {
    try {
      return await getExtensionBridgeStatus(timeoutMs);
    } catch {
      // The extension cannot even answer a status probe — fall through to a
      // real registration attempt instead of failing outright.
    }
  }
  writeLastRegisterAttempt(storageKey, now);
  return requestExtensionBridgeStatus(
    {
      type: "persai.bridge.register_device_request",
      apiBaseUrl: getBridgeApiBaseUrl(),
      bearerToken: input.token,
      payload: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        deviceKind: "extension",
        deviceLabel: "PersAI Chrome Extension",
        clientVersion: "0.0.0"
      }
    },
    timeoutMs
  );
}

export async function registerNativeBrowserBridgeDevice(
  input: RegisterExtensionBridgeDeviceInput
): Promise<ExtensionBridgeStatus> {
  return connectNativeBridgeSocket(input);
}

/**
 * Hide the native browser overlay locally (no server round-trip). The native
 * `close_view` path persists the profile cookies before hiding, so a login
 * completed inside the overlay survives the hide. Used by the hardware Back
 * handler: the overlay covers the whole app, including the modal's Done
 * button, so Back is the user's way home.
 */
export async function hideNativeBrowserBridgeView(profileKey: string): Promise<void> {
  if (!isNativeBrowserBridgeShell()) {
    return;
  }
  await executeNativeCommand({
    commandId: `local-close-${Date.now()}`,
    profileKey,
    action: "close_view"
  });
}

/** Re-show the native overlay on its current page, locally. */
export async function showNativeBrowserBridgeView(profileKey: string): Promise<void> {
  if (!isNativeBrowserBridgeShell()) {
    return;
  }
  await executeNativeCommand({
    commandId: `local-open-${Date.now()}`,
    profileKey,
    action: "open_view",
    stayOnPage: true,
    observerOnly: true
  });
}

/**
 * End the turn-scoped observer state. Native profiles are known from commands
 * and preview events; the extension owns its complete retained-profile list.
 */
export async function releaseLocalBrowserObserverLocks(): Promise<void> {
  if (!isNativeBrowserBridgeShell()) {
    postExtensionObserverLock(false);
    return;
  }
  const profileKeys = Array.from(nativeObserverLockedProfileKeys);
  await Promise.all(
    profileKeys.map(async (profileKey) => {
      await executeNativeCommand({
        commandId: `local-observer-release-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        profileKey,
        action: "set_observer_lock",
        observerOnly: false
      });
      nativeObserverLockedProfileKeys.delete(profileKey);
    })
  );
}
