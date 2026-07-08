import { randomUUID, createHmac } from "node:crypto";
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import type {
  LocalBrowserBridgeDeviceKind,
  LocalBrowserBridgeDeviceRegisterRequest,
  LocalBrowserBridgeDeviceRegisterResult,
  LocalBrowserBridgeDispatchCommandRequest,
  LocalBrowserBridgeDispatchCommandResult,
  LocalBrowserBridgeGetCommandResultResult,
  LocalBrowserBridgeWebSocketConnectRequest,
  LocalBrowserCommand,
  LocalBrowserResult
} from "@persai/runtime-contract";
import {
  DEFAULT_RUNTIME_BROWSER_TIMEOUT_MS,
  LOCAL_BROWSER_BRIDGE_DEVICE_KINDS,
  MAX_RUNTIME_BROWSER_TIMEOUT_MS
} from "@persai/runtime-contract";

const DEVICE_TOKEN_VERSION = "v1";
const DEVICE_TOKEN_TTL_MS = 15 * 60 * 1000;
const COMMAND_RESULT_RETENTION_MS = 5 * 60 * 1000;
const DISPATCH_RATE_WINDOW_MS = 60_000;
const MAX_DISPATCHES_PER_WINDOW = 20;
const CONNECTION_REPLACED_CLOSE_CODE = 4002;
const CONNECTION_REPLACED_CLOSE_REASON = "duplicate_connection_replaced";
const COMMAND_TIMEOUT_ERROR = "bridge_command_timeout";
const CONNECTION_CLOSED_ERROR = "bridge_connection_closed";
const COMMAND_UNKNOWN_ERROR = "bridge_command_not_found_or_expired";

type DeviceTokenClaims = {
  version: typeof DEVICE_TOKEN_VERSION;
  assistantId: string;
  workspaceId: string;
  bridgeDeviceId: string;
  deviceKind: LocalBrowserBridgeDeviceKind;
  issuedAt: number;
  expiresAt: number;
};

type BridgeSocketLike = {
  send(payload: string): void;
  close(code?: number, reason?: string): void;
};

type ActiveConnectionRecord = {
  connectionKey: string;
  assistantId: string;
  workspaceId: string;
  bridgeDeviceId: string;
  deviceKind: LocalBrowserBridgeDeviceKind;
  socket: BridgeSocketLike;
  connectedAt: number;
};

type PendingCommandRecord = {
  commandId: string;
  assistantId: string;
  workspaceId: string;
  bridgeDeviceId: string;
  connectionKey: string;
  timeoutAt: number;
  timeoutHandle: NodeJS.Timeout;
  completedAt?: number;
  result?: LocalBrowserResult;
};

type DispatchRateRecord = {
  windowStartedAt: number;
  count: number;
};

export type BrowserBridgeDispatchUnavailableCode =
  | "bridge_unavailable"
  | "bridge_device_not_connected"
  | "bridge_device_ambiguous";

export type BrowserBridgeDispatchUnavailableResult = {
  accepted: false;
  commandId: string;
  code: BrowserBridgeDispatchUnavailableCode;
  message: string;
  activeBridgeDeviceIds: string[];
  requestedBridgeDeviceId?: string | null;
};

export type BrowserBridgeDispatchOutcome =
  | LocalBrowserBridgeDispatchCommandResult
  | BrowserBridgeDispatchUnavailableResult;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLocalBrowserBridgeDeviceKind(value: unknown): value is LocalBrowserBridgeDeviceKind {
  return (
    typeof value === "string" &&
    (LOCAL_BROWSER_BRIDGE_DEVICE_KINDS as readonly string[]).includes(value)
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function setSafeTimeout(callback: () => void, timeoutMs: number): NodeJS.Timeout {
  const handle = setTimeout(callback, timeoutMs);
  handle.unref();
  return handle;
}

@Injectable()
export class BrowserBridgeRelayService {
  private readonly logger = new Logger(BrowserBridgeRelayService.name);
  private readonly connectionsByKey = new Map<string, ActiveConnectionRecord>();
  private readonly scopeToConnectionKeys = new Map<string, Set<string>>();
  private readonly pendingCommands = new Map<string, PendingCommandRecord>();
  private readonly dispatchRates = new Map<string, DispatchRateRecord>();

  registerDevice(
    input: LocalBrowserBridgeDeviceRegisterRequest,
    websocketUrl: string
  ): LocalBrowserBridgeDeviceRegisterResult {
    this.pruneState();
    const bridgeDeviceId = randomUUID();
    const now = Date.now();
    const claims: DeviceTokenClaims = {
      version: DEVICE_TOKEN_VERSION,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      bridgeDeviceId,
      deviceKind: input.deviceKind,
      issuedAt: now,
      expiresAt: now + DEVICE_TOKEN_TTL_MS
    };

    return {
      bridgeDeviceId,
      deviceKind: input.deviceKind,
      deviceToken: this.signDeviceToken(claims),
      websocketUrl
    };
  }

  attachConnection(
    input: LocalBrowserBridgeWebSocketConnectRequest,
    socket: BridgeSocketLike
  ): string {
    this.pruneState();
    const claims = this.verifyDeviceToken(input);
    const connectionKey = this.buildConnectionKey(
      claims.workspaceId,
      claims.assistantId,
      claims.bridgeDeviceId
    );
    const existing = this.connectionsByKey.get(connectionKey);
    if (existing !== undefined) {
      this.disconnectConnection(existing.connectionKey, CONNECTION_CLOSED_ERROR);
      try {
        existing.socket.close(CONNECTION_REPLACED_CLOSE_CODE, CONNECTION_REPLACED_CLOSE_REASON);
      } catch {
        // Closing an already broken socket is best-effort only.
      }
    }

    const record: ActiveConnectionRecord = {
      connectionKey,
      assistantId: claims.assistantId,
      workspaceId: claims.workspaceId,
      bridgeDeviceId: claims.bridgeDeviceId,
      deviceKind: claims.deviceKind,
      socket,
      connectedAt: Date.now()
    };
    this.connectionsByKey.set(connectionKey, record);
    const scopeKey = this.buildAssistantScopeKey(record.workspaceId, record.assistantId);
    const keys = this.scopeToConnectionKeys.get(scopeKey) ?? new Set<string>();
    keys.add(connectionKey);
    this.scopeToConnectionKeys.set(scopeKey, keys);
    return connectionKey;
  }

  disconnectConnection(connectionKey: string, errorReason: string): void {
    const record = this.connectionsByKey.get(connectionKey);
    if (record === undefined) {
      return;
    }
    this.connectionsByKey.delete(connectionKey);
    const scopeKey = this.buildAssistantScopeKey(record.workspaceId, record.assistantId);
    const keys = this.scopeToConnectionKeys.get(scopeKey);
    if (keys !== undefined) {
      keys.delete(connectionKey);
      if (keys.size === 0) {
        this.scopeToConnectionKeys.delete(scopeKey);
      }
    }

    const now = Date.now();
    for (const pending of this.pendingCommands.values()) {
      if (pending.connectionKey !== connectionKey || pending.result !== undefined) {
        continue;
      }
      this.completeCommand(
        pending.commandId,
        this.buildErrorResult(pending.commandId, errorReason),
        now
      );
    }
  }

  acceptDeviceResult(connectionKey: string, result: LocalBrowserResult): boolean {
    this.pruneState();
    const pending = this.pendingCommands.get(result.commandId);
    if (
      pending === undefined ||
      pending.connectionKey !== connectionKey ||
      pending.result !== undefined
    ) {
      return false;
    }
    this.completeCommand(result.commandId, result, Date.now());
    return true;
  }

  dispatchCommand(input: LocalBrowserBridgeDispatchCommandRequest): BrowserBridgeDispatchOutcome {
    this.pruneState();
    this.enforceDispatchRateLimit(input.workspaceId, input.assistantId);
    const commandId = this.requiredString(input.command.commandId, "command.commandId");
    if (this.pendingCommands.has(commandId)) {
      throw new BadRequestException(`Command "${commandId}" is already pending.`);
    }

    const selection = this.selectConnection(
      input.workspaceId,
      input.assistantId,
      input.bridgeDeviceId ?? null,
      commandId
    );
    if (!("socket" in selection)) {
      return selection;
    }

    const timeoutMs = this.normalizeTimeoutMs(input.command.timeoutMs ?? null);
    const command: LocalBrowserCommand = {
      ...input.command,
      commandId,
      timeoutMs
    };
    const timeoutAt = Date.now() + timeoutMs;
    const timeoutHandle = setSafeTimeout(() => {
      this.completeCommand(
        commandId,
        this.buildErrorResult(commandId, COMMAND_TIMEOUT_ERROR),
        Date.now()
      );
    }, timeoutMs);
    const pending: PendingCommandRecord = {
      commandId,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      bridgeDeviceId: selection.bridgeDeviceId,
      connectionKey: selection.connectionKey,
      timeoutAt,
      timeoutHandle
    };
    this.pendingCommands.set(commandId, pending);
    try {
      selection.socket.send(JSON.stringify(command));
    } catch (error) {
      clearTimeout(timeoutHandle);
      this.pendingCommands.delete(commandId);
      this.disconnectConnection(selection.connectionKey, CONNECTION_CLOSED_ERROR);
      this.logger.warn(
        `[browser-bridge] failed to send command=${commandId} device=${selection.bridgeDeviceId}: ${String(error)}`
      );
      return {
        accepted: false,
        commandId,
        code: "bridge_device_not_connected",
        message: "The requested browser bridge device is no longer connected.",
        activeBridgeDeviceIds: this.listActiveDeviceIds(input.workspaceId, input.assistantId),
        requestedBridgeDeviceId: selection.bridgeDeviceId
      };
    }

    return {
      accepted: true,
      commandId,
      bridgeDeviceId: selection.bridgeDeviceId
    };
  }

  getCommandResult(commandId: string): LocalBrowserBridgeGetCommandResultResult {
    this.pruneState();
    const pending = this.pendingCommands.get(commandId);
    if (pending === undefined) {
      return {
        status: "completed",
        result: this.buildErrorResult(commandId, COMMAND_UNKNOWN_ERROR)
      };
    }
    if (pending.result === undefined) {
      if (pending.timeoutAt <= Date.now()) {
        this.completeCommand(
          commandId,
          this.buildErrorResult(commandId, COMMAND_TIMEOUT_ERROR),
          Date.now()
        );
      } else {
        return { status: "pending" };
      }
    }
    const completed = this.pendingCommands.get(commandId);
    return {
      status: "completed",
      result: completed?.result ?? this.buildErrorResult(commandId, COMMAND_UNKNOWN_ERROR)
    };
  }

  private selectConnection(
    workspaceId: string,
    assistantId: string,
    requestedBridgeDeviceId: string | null,
    commandId: string
  ):
    | { connectionKey: string; bridgeDeviceId: string; socket: BridgeSocketLike }
    | BrowserBridgeDispatchUnavailableResult {
    const scopeKey = this.buildAssistantScopeKey(workspaceId, assistantId);
    const connectionKeys = [...(this.scopeToConnectionKeys.get(scopeKey) ?? [])].filter((key) =>
      this.connectionsByKey.has(key)
    );
    const activeDeviceIds = connectionKeys
      .map((key) => this.connectionsByKey.get(key)?.bridgeDeviceId)
      .filter((value): value is string => typeof value === "string");

    if (requestedBridgeDeviceId !== null) {
      const key = this.buildConnectionKey(workspaceId, assistantId, requestedBridgeDeviceId);
      const record = this.connectionsByKey.get(key);
      if (record === undefined) {
        return {
          accepted: false,
          commandId,
          code: "bridge_device_not_connected",
          message: "The requested browser bridge device is not connected.",
          activeBridgeDeviceIds: activeDeviceIds,
          requestedBridgeDeviceId
        };
      }
      return {
        connectionKey: record.connectionKey,
        bridgeDeviceId: record.bridgeDeviceId,
        socket: record.socket
      };
    }

    if (connectionKeys.length === 0) {
      return {
        accepted: false,
        commandId,
        code: "bridge_unavailable",
        message: "No active browser bridge device is connected for this assistant.",
        activeBridgeDeviceIds: []
      };
    }
    if (connectionKeys.length > 1) {
      return {
        accepted: false,
        commandId,
        code: "bridge_device_ambiguous",
        message: "Multiple browser bridge devices are connected; specify bridgeDeviceId.",
        activeBridgeDeviceIds: activeDeviceIds
      };
    }
    const record = this.connectionsByKey.get(connectionKeys[0]!);
    if (record === undefined) {
      return {
        accepted: false,
        commandId,
        code: "bridge_unavailable",
        message: "No active browser bridge device is connected for this assistant.",
        activeBridgeDeviceIds: []
      };
    }
    return {
      connectionKey: record.connectionKey,
      bridgeDeviceId: record.bridgeDeviceId,
      socket: record.socket
    };
  }

  private enforceDispatchRateLimit(workspaceId: string, assistantId: string): void {
    const now = Date.now();
    const rateKey = this.buildAssistantScopeKey(workspaceId, assistantId);
    const current = this.dispatchRates.get(rateKey);
    if (current === undefined || now - current.windowStartedAt >= DISPATCH_RATE_WINDOW_MS) {
      this.dispatchRates.set(rateKey, { windowStartedAt: now, count: 1 });
      return;
    }
    if (current.count >= MAX_DISPATCHES_PER_WINDOW) {
      throw new HttpException(
        {
          code: "bridge_dispatch_rate_limited",
          message: "Browser bridge dispatch rate limit exceeded for this assistant."
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    current.count += 1;
  }

  private completeCommand(
    commandId: string,
    result: LocalBrowserResult,
    completedAt: number
  ): void {
    const pending = this.pendingCommands.get(commandId);
    if (pending === undefined || pending.result !== undefined) {
      return;
    }
    clearTimeout(pending.timeoutHandle);
    pending.result = result;
    pending.completedAt = completedAt;
  }

  private pruneState(): void {
    const now = Date.now();
    for (const [commandId, pending] of this.pendingCommands.entries()) {
      if (pending.result === undefined && pending.timeoutAt <= now) {
        this.completeCommand(
          commandId,
          this.buildErrorResult(commandId, COMMAND_TIMEOUT_ERROR),
          now
        );
      }
      if (
        pending.result !== undefined &&
        pending.completedAt !== undefined &&
        now - pending.completedAt > COMMAND_RESULT_RETENTION_MS
      ) {
        clearTimeout(pending.timeoutHandle);
        this.pendingCommands.delete(commandId);
      }
    }
    for (const [key, record] of this.dispatchRates.entries()) {
      if (now - record.windowStartedAt >= DISPATCH_RATE_WINDOW_MS) {
        this.dispatchRates.delete(key);
      }
    }
  }

  private verifyDeviceToken(input: LocalBrowserBridgeWebSocketConnectRequest): DeviceTokenClaims {
    const rawToken = this.requiredString(input.deviceToken, "deviceToken");
    const parts = rawToken.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid device token format.");
    }
    const version = parts[0];
    const encodedPayload = parts[1];
    const signature = parts[2];
    if (version === undefined || encodedPayload === undefined || signature === undefined) {
      throw new Error("Invalid device token format.");
    }
    if (version !== DEVICE_TOKEN_VERSION) {
      throw new Error("Unsupported device token version.");
    }
    const expectedSignature = createHmac("sha256", this.resolveTokenSecret())
      .update(encodedPayload)
      .digest("base64url");
    if (expectedSignature !== signature) {
      throw new Error("Invalid device token signature.");
    }
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as unknown;
    if (!isObjectRecord(payload)) {
      throw new Error("Invalid device token payload.");
    }
    const claims: DeviceTokenClaims = {
      version: DEVICE_TOKEN_VERSION,
      assistantId: this.requiredString(payload.assistantId, "assistantId"),
      workspaceId: this.requiredString(payload.workspaceId, "workspaceId"),
      bridgeDeviceId: this.requiredString(payload.bridgeDeviceId, "bridgeDeviceId"),
      deviceKind: this.requiredDeviceKind(payload.deviceKind),
      issuedAt: this.requiredNumber(payload.issuedAt, "issuedAt"),
      expiresAt: this.requiredNumber(payload.expiresAt, "expiresAt")
    };
    if (claims.expiresAt <= Date.now()) {
      throw new Error("Device token has expired.");
    }
    if (
      claims.assistantId !== input.assistantId ||
      claims.workspaceId !== input.workspaceId ||
      claims.bridgeDeviceId !== input.bridgeDeviceId ||
      claims.deviceKind !== input.deviceKind
    ) {
      throw new Error("Device token scope does not match connection request.");
    }
    return claims;
  }

  private signDeviceToken(claims: DeviceTokenClaims): string {
    const encodedPayload = base64UrlEncode(JSON.stringify(claims));
    const signature = createHmac("sha256", this.resolveTokenSecret())
      .update(encodedPayload)
      .digest("base64url");
    return `${DEVICE_TOKEN_VERSION}.${encodedPayload}.${signature}`;
  }

  private resolveTokenSecret(): string {
    const secret =
      process.env.ADMIN_STEP_UP_HMAC_SECRET?.trim() ||
      process.env.CLERK_SECRET_KEY?.trim() ||
      process.env.PERSAI_INTERNAL_API_TOKEN?.trim() ||
      "";
    if (secret.length < 16) {
      throw new Error("Browser bridge token secret is not configured.");
    }
    return secret;
  }

  private normalizeTimeoutMs(timeoutMs: number | null): number {
    if (timeoutMs === null || !Number.isFinite(timeoutMs)) {
      return DEFAULT_RUNTIME_BROWSER_TIMEOUT_MS;
    }
    const rounded = Math.trunc(timeoutMs);
    if (rounded <= 0) {
      return DEFAULT_RUNTIME_BROWSER_TIMEOUT_MS;
    }
    return Math.min(MAX_RUNTIME_BROWSER_TIMEOUT_MS, rounded);
  }

  private buildAssistantScopeKey(workspaceId: string, assistantId: string): string {
    return `${workspaceId}::${assistantId}`;
  }

  private buildConnectionKey(
    workspaceId: string,
    assistantId: string,
    bridgeDeviceId: string
  ): string {
    return `${workspaceId}::${assistantId}::${bridgeDeviceId}`;
  }

  private buildErrorResult(commandId: string, errorReason: string): LocalBrowserResult {
    return {
      commandId,
      ok: false,
      errorReason
    };
  }

  private listActiveDeviceIds(workspaceId: string, assistantId: string): string[] {
    const scopeKey = this.buildAssistantScopeKey(workspaceId, assistantId);
    return [...(this.scopeToConnectionKeys.get(scopeKey) ?? [])]
      .map((connectionKey) => this.connectionsByKey.get(connectionKey)?.bridgeDeviceId)
      .filter((value): value is string => typeof value === "string");
  }

  private requiredString(value: unknown, label: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${label} must be a non-empty string.`);
    }
    return trimmed;
  }

  private requiredNumber(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }
    return value;
  }

  private requiredDeviceKind(value: unknown): LocalBrowserBridgeDeviceKind {
    if (!isLocalBrowserBridgeDeviceKind(value)) {
      throw new Error("deviceKind must be a supported browser bridge device kind.");
    }
    return value;
  }
}
