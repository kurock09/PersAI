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
const DEFAULT_MAX_CHARS = 12_000;

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

type WebBridgeEnvelope = {
  source: typeof BRIDGE_MESSAGE_SOURCE;
  requestId: string;
  payload: BridgeStatusRequestMessage | BridgeRegisterDeviceRequestMessage;
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
};

type NativeBridgeRuntimeState = {
  socket: WebSocket | null;
  registration: LocalBrowserBridgeDeviceRegisterResult | null;
  assistantId: string | null;
  workspaceId: string | null;
  commandQueue: Promise<void>;
};

const nativeBridgeState: NativeBridgeRuntimeState = {
  socket: null,
  registration: null,
  assistantId: null,
  workspaceId: null,
  commandQueue: Promise.resolve()
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

function toBridgeStatus(): ExtensionBridgeStatus {
  return {
    connected: nativeBridgeState.socket?.readyState === WebSocket.OPEN,
    desiredConnection: nativeBridgeState.registration !== null,
    bridgeDeviceId: nativeBridgeState.registration?.bridgeDeviceId ?? null,
    assistantId: nativeBridgeState.assistantId,
    workspaceId: nativeBridgeState.workspaceId,
    profileCount: 0,
    lastProfileKey: null
  };
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

async function getNativeBrowserBridgePlugin(): Promise<NativeBrowserBridgePlugin> {
  const { registerPlugin } = await import("@capacitor/core");
  return registerPlugin<NativeBrowserBridgePlugin>("PersaiBrowserBridge");
}

async function executeNativeCommand(command: LocalBrowserCommand): Promise<LocalBrowserResult> {
  const plugin = await getNativeBrowserBridgePlugin();
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

async function sendNativeBridgeResult(result: LocalBrowserResult): Promise<void> {
  if (nativeBridgeState.socket?.readyState !== WebSocket.OPEN) {
    return;
  }
  nativeBridgeState.socket.send(JSON.stringify(result));
}

async function handleNativeBridgeCommand(command: LocalBrowserCommand): Promise<void> {
  try {
    await sendNativeBridgeResult(await executeNativeCommand(command));
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
      deviceLabel: "PersAI Mobile App",
      clientVersion: "0.0.0"
    })
  });
  if (!response.ok) {
    throw new Error(`Device registration failed with HTTP ${String(response.status)}.`);
  }
  return (await response.json()) as LocalBrowserBridgeDeviceRegisterResult;
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
  nativeBridgeState.assistantId = input.assistantId;
  nativeBridgeState.workspaceId = input.workspaceId;

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
      settled = true;
      resolve();
    });
    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data)) as LocalBrowserCommand;
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
      }
    });
    socket.addEventListener("error", () => {
      if (!settled) {
        reject(new Error("Native browser bridge websocket connection failed."));
      }
    });
  });

  return toBridgeStatus();
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
        resolve(envelope.result);
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

export async function registerExtensionBridgeDevice(
  input: RegisterExtensionBridgeDeviceInput,
  timeoutMs = 5_000
): Promise<ExtensionBridgeStatus> {
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
