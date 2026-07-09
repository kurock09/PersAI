import { randomUUID, createHmac } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
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
import {
  BrowserBridgeCoordinatorService,
  type BridgeConnectionDescriptor,
  type ForwardedCommandEnvelope
} from "./browser-bridge-coordinator.service";

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
const CONNECTION_HEARTBEAT_INTERVAL_MS = 20_000;

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

type ConnectionSelection =
  | { connectionKey: string; bridgeDeviceId: string; podId: string | null }
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
export class BrowserBridgeRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserBridgeRelayService.name);
  private readonly connectionsByKey = new Map<string, ActiveConnectionRecord>();
  private readonly scopeToConnectionKeys = new Map<string, Set<string>>();
  private readonly pendingCommands = new Map<string, PendingCommandRecord>();
  private readonly dispatchRates = new Map<string, DispatchRateRecord>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly coordinator?: BrowserBridgeCoordinatorService) {}

  onModuleInit(): void {
    if (this.coordinator?.isEnabled()) {
      this.coordinator.setCommandHandler((envelope) => {
        this.handleForwardedCommand(envelope);
      });
      // Warm the connection so the pod is subscribed to its command channel before any device
      // connects. Failures degrade to local-only behavior and are logged by the coordinator.
      void this.coordinator.ensureConnected();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.coordinator?.isEnabled()) {
      await this.coordinator.shutdown();
    }
  }

  registerDevice(
    input: LocalBrowserBridgeDeviceRegisterRequest,
    websocketUrl: string
  ): LocalBrowserBridgeDeviceRegisterResult {
    this.pruneState();
    // Re-registration renews credentials for the same physical browser/app
    // installation. Minting a new id on every renewal breaks profile affinity:
    // the profile keeps the old bridgeSessionRef while the live socket moves to
    // a new id, and two Chrome installations make fallback ambiguous.
    const bridgeDeviceId = input.bridgeDeviceId ?? randomUUID();
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

    if (this.coordinator?.isEnabled()) {
      void this.coordinator.registerConnection(this.toDescriptor(record));
      this.ensureHeartbeat();
    }
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
    if (this.coordinator?.isEnabled()) {
      void this.coordinator.removeConnection(connectionKey, record.workspaceId, record.assistantId);
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

  async dispatchCommand(
    input: LocalBrowserBridgeDispatchCommandRequest
  ): Promise<BrowserBridgeDispatchOutcome> {
    this.pruneState();
    this.enforceDispatchRateLimit(input.workspaceId, input.assistantId);
    const commandId = this.requiredString(input.command.commandId, "command.commandId");
    if (this.pendingCommands.has(commandId)) {
      throw new BadRequestException(`Command "${commandId}" is already pending.`);
    }

    const timeoutMs = this.normalizeTimeoutMs(input.command.timeoutMs ?? null);
    const command: LocalBrowserCommand = {
      ...input.command,
      commandId,
      timeoutMs
    };

    const selection = await this.selectConnection(
      input.workspaceId,
      input.assistantId,
      input.bridgeDeviceId ?? null,
      commandId
    );
    if (!("connectionKey" in selection)) {
      return selection;
    }

    const ownedLocally = selection.podId === null || selection.podId === this.coordinator?.podId;

    // Publish command state so any pod polling `getCommandResult` observes the in-flight command,
    // even though only the owning pod holds the socket and the local timeout.
    if (this.coordinator?.isEnabled()) {
      await this.coordinator.putCommandState(
        commandId,
        {
          status: "pending",
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          connectionKey: selection.connectionKey,
          bridgeDeviceId: selection.bridgeDeviceId,
          timeoutAt: Date.now() + timeoutMs
        },
        this.commandStateTtlSeconds(timeoutMs)
      );
    }

    if (ownedLocally) {
      const delivered = this.deliverLocally(command, selection.connectionKey);
      if (!delivered) {
        if (this.coordinator?.isEnabled()) {
          await this.coordinator.completeCommandState(
            commandId,
            this.buildErrorResult(commandId, CONNECTION_CLOSED_ERROR),
            this.commandStateTtlSeconds(timeoutMs)
          );
        }
        return {
          accepted: false,
          commandId,
          code: "bridge_device_not_connected",
          message: "The requested browser bridge device is no longer connected.",
          activeBridgeDeviceIds: this.listActiveDeviceIds(input.workspaceId, input.assistantId),
          requestedBridgeDeviceId: selection.bridgeDeviceId
        };
      }
      return { accepted: true, commandId, bridgeDeviceId: selection.bridgeDeviceId };
    }

    const envelope: ForwardedCommandEnvelope = {
      connectionKey: selection.connectionKey,
      command
    };
    const published = await this.coordinator!.publishCommand(selection.podId!, envelope);
    if (!published) {
      await this.coordinator!.completeCommandState(
        commandId,
        this.buildErrorResult(commandId, CONNECTION_CLOSED_ERROR),
        this.commandStateTtlSeconds(timeoutMs)
      );
      await this.coordinator!.removeConnection(
        selection.connectionKey,
        input.workspaceId,
        input.assistantId
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
    return { accepted: true, commandId, bridgeDeviceId: selection.bridgeDeviceId };
  }

  async getCommandResult(commandId: string): Promise<LocalBrowserBridgeGetCommandResultResult> {
    this.pruneState();
    const pending = this.pendingCommands.get(commandId);
    if (pending !== undefined) {
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

    if (this.coordinator?.isEnabled()) {
      const state = await this.coordinator.getCommandState(commandId);
      if (state === null) {
        return {
          status: "completed",
          result: this.buildErrorResult(commandId, COMMAND_UNKNOWN_ERROR)
        };
      }
      if (state.status === "completed" && state.result !== undefined) {
        return { status: "completed", result: state.result };
      }
      if (state.timeoutAt <= Date.now()) {
        const timeoutResult = this.buildErrorResult(commandId, COMMAND_TIMEOUT_ERROR);
        await this.coordinator.completeCommandState(
          commandId,
          timeoutResult,
          COMMAND_RESULT_RETENTION_MS / 1000
        );
        return { status: "completed", result: timeoutResult };
      }
      return { status: "pending" };
    }

    return {
      status: "completed",
      result: this.buildErrorResult(commandId, COMMAND_UNKNOWN_ERROR)
    };
  }

  /**
   * Invoked on the pod that owns the device socket when a dispatch handled by another pod is
   * forwarded via the coordinator. Delivers over the local socket and installs a local timeout so
   * the command still completes if the device never answers.
   */
  private handleForwardedCommand(envelope: ForwardedCommandEnvelope): void {
    const delivered = this.deliverLocally(envelope.command, envelope.connectionKey);
    if (!delivered && this.coordinator?.isEnabled()) {
      void this.coordinator.completeCommandState(
        envelope.command.commandId,
        this.buildErrorResult(envelope.command.commandId, CONNECTION_CLOSED_ERROR),
        this.commandStateTtlSeconds(
          envelope.command.timeoutMs ?? DEFAULT_RUNTIME_BROWSER_TIMEOUT_MS
        )
      );
    }
  }

  private deliverLocally(command: LocalBrowserCommand, connectionKey: string): boolean {
    const record = this.connectionsByKey.get(connectionKey);
    if (record === undefined) {
      return false;
    }
    if (this.pendingCommands.has(command.commandId)) {
      // Already tracked locally (defensive against duplicate delivery).
      return true;
    }
    const timeoutMs = this.normalizeTimeoutMs(command.timeoutMs ?? null);
    const timeoutAt = Date.now() + timeoutMs;
    const timeoutHandle = setSafeTimeout(() => {
      this.completeCommand(
        command.commandId,
        this.buildErrorResult(command.commandId, COMMAND_TIMEOUT_ERROR),
        Date.now()
      );
    }, timeoutMs);
    const pending: PendingCommandRecord = {
      commandId: command.commandId,
      assistantId: record.assistantId,
      workspaceId: record.workspaceId,
      bridgeDeviceId: record.bridgeDeviceId,
      connectionKey,
      timeoutAt,
      timeoutHandle
    };
    this.pendingCommands.set(command.commandId, pending);
    try {
      record.socket.send(JSON.stringify(command));
    } catch (error) {
      clearTimeout(timeoutHandle);
      this.pendingCommands.delete(command.commandId);
      this.disconnectConnection(connectionKey, CONNECTION_CLOSED_ERROR);
      this.logger.warn(
        `[browser-bridge] failed to send command=${command.commandId} device=${record.bridgeDeviceId}: ${String(error)}`
      );
      return false;
    }
    return true;
  }

  private async selectConnection(
    workspaceId: string,
    assistantId: string,
    requestedBridgeDeviceId: string | null,
    commandId: string
  ): Promise<ConnectionSelection> {
    if (this.coordinator?.isEnabled()) {
      const descriptors = await this.coordinator.listScopeConnections(workspaceId, assistantId);
      if (descriptors.length > 0) {
        return this.chooseFromDescriptors(descriptors, requestedBridgeDeviceId, commandId);
      }
      // Registry may lag behind a freshly attached local socket; fall back to the local view.
      const local = this.selectLocalConnection(
        workspaceId,
        assistantId,
        requestedBridgeDeviceId,
        commandId
      );
      if ("connectionKey" in local) {
        const record = this.connectionsByKey.get(local.connectionKey);
        if (record !== undefined) {
          void this.coordinator.registerConnection(this.toDescriptor(record));
        }
      }
      return local;
    }
    return this.selectLocalConnection(workspaceId, assistantId, requestedBridgeDeviceId, commandId);
  }

  private chooseFromDescriptors(
    descriptors: BridgeConnectionDescriptor[],
    requestedBridgeDeviceId: string | null,
    commandId: string
  ): ConnectionSelection {
    const activeDeviceIds = descriptors.map((descriptor) => descriptor.bridgeDeviceId);
    if (requestedBridgeDeviceId !== null) {
      const match = descriptors.find(
        (descriptor) => descriptor.bridgeDeviceId === requestedBridgeDeviceId
      );
      if (match !== undefined) {
        return {
          connectionKey: match.connectionKey,
          bridgeDeviceId: match.bridgeDeviceId,
          podId: match.podId
        };
      }
      // The caller's remembered device id (e.g. a DB-stored bridgeSessionRef)
      // is a PREFERENCE, not a hard requirement: reconnect churn (token
      // refresh, extension restart) routinely mints a new device id, and
      // failing outright here even though exactly one live connection exists
      // for this scope is strictly worse than treating the id as absent —
      // fall through to auto-selection instead of a hard 409.
    }
    if (descriptors.length > 1) {
      return {
        accepted: false,
        commandId,
        code: "bridge_device_ambiguous",
        message: "Multiple browser bridge devices are connected; specify bridgeDeviceId.",
        activeBridgeDeviceIds: activeDeviceIds
      };
    }
    if (descriptors.length === 0) {
      return {
        accepted: false,
        commandId,
        code: "bridge_device_not_connected",
        message: "The requested browser bridge device is not connected.",
        activeBridgeDeviceIds: activeDeviceIds,
        requestedBridgeDeviceId
      };
    }
    const only = descriptors[0]!;
    return {
      connectionKey: only.connectionKey,
      bridgeDeviceId: only.bridgeDeviceId,
      podId: only.podId
    };
  }

  private selectLocalConnection(
    workspaceId: string,
    assistantId: string,
    requestedBridgeDeviceId: string | null,
    commandId: string
  ): ConnectionSelection {
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
      if (record !== undefined) {
        return {
          connectionKey: record.connectionKey,
          bridgeDeviceId: record.bridgeDeviceId,
          podId: null
        };
      }
      // See chooseFromDescriptors: a stale remembered device id must not hard-fail
      // when exactly one live connection exists for this scope — fall through to
      // auto-selection instead of a hard 409.
    }

    if (connectionKeys.length === 0) {
      return {
        accepted: false,
        commandId,
        code:
          requestedBridgeDeviceId !== null ? "bridge_device_not_connected" : "bridge_unavailable",
        message:
          requestedBridgeDeviceId !== null
            ? "The requested browser bridge device is not connected."
            : "No active browser bridge device is connected for this assistant.",
        activeBridgeDeviceIds: [],
        ...(requestedBridgeDeviceId !== null ? { requestedBridgeDeviceId } : {})
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
      podId: null
    };
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null || !this.coordinator?.isEnabled()) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.connectionsByKey.size === 0) {
        if (this.heartbeatTimer !== null) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        return;
      }
      for (const record of this.connectionsByKey.values()) {
        void this.coordinator?.refreshConnection(this.toDescriptor(record));
      }
    }, CONNECTION_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  private toDescriptor(record: ActiveConnectionRecord): BridgeConnectionDescriptor {
    return {
      podId: this.coordinator?.podId ?? "",
      connectionKey: record.connectionKey,
      assistantId: record.assistantId,
      workspaceId: record.workspaceId,
      bridgeDeviceId: record.bridgeDeviceId,
      deviceKind: record.deviceKind
    };
  }

  private commandStateTtlSeconds(timeoutMs: number): number {
    return Math.ceil(timeoutMs / 1000) + COMMAND_RESULT_RETENTION_MS / 1000;
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
    if (this.coordinator?.isEnabled()) {
      void this.coordinator.completeCommandState(
        commandId,
        result,
        COMMAND_RESULT_RETENTION_MS / 1000
      );
    }
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
