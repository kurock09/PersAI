import type { IncomingMessage, Server } from "node:http";
import { Injectable, Logger } from "@nestjs/common";
import {
  LOCAL_BROWSER_BRIDGE_DEVICE_KINDS,
  LOCAL_BROWSER_COMMAND_ACTIONS,
  PERSAI_RUNTIME_BROWSER_SNAPSHOT_FORMATS,
  type LocalBrowserBridgeDeviceKind,
  type LocalBrowserBridgeWebSocketConnectRequest,
  type LocalBrowserCommand,
  type LocalBrowserCommandAction,
  type LocalBrowserResult
} from "@persai/runtime-contract";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { BrowserBridgeRelayService } from "./browser-bridge-relay.service";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const SOCKET_KEEPALIVE_INTERVAL_MS = 20_000;
const INVALID_MESSAGE_CLOSE_CODE = 4400;
const INVALID_AUTH_CLOSE_CODE = 4401;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return trimmed;
}

function optionalString(value: unknown, label: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string, null, or undefined.`);
  }
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean, null, or undefined.`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, null, or undefined.`);
  }
  return value;
}

@Injectable()
export class BrowserBridgeWebSocketServer {
  private readonly logger = new Logger(BrowserBridgeWebSocketServer.name);
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private attached = false;

  constructor(private readonly relayService: BrowserBridgeRelayService) {}

  attachPublicServer(server: Server): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    server.on("upgrade", (request, socket, head) => {
      const pathname = this.extractPathname(request);
      if (pathname !== "/api/v1/assistant/browser-bridge/ws") {
        return;
      }
      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.handleSocket(webSocket, request);
      });
    });
  }

  private handleSocket(webSocket: WebSocket, request: IncomingMessage): void {
    let connectionKey: string | null = null;
    const handshakeTimer = setTimeout(() => {
      this.logger.warn("[browser-bridge] websocket handshake timed out.");
      webSocket.close(INVALID_AUTH_CLOSE_CODE, "handshake_timeout");
    }, HANDSHAKE_TIMEOUT_MS);
    handshakeTimer.unref();
    // Network/LB idle timeouts were dropping otherwise healthy bridge sockets
    // after several minutes. Protocol-level ping frames keep the route active;
    // browser WebSocket implementations answer pong automatically.
    const keepaliveTimer = setInterval(() => {
      if (webSocket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        webSocket.ping();
      } catch {
        // The regular close/error handlers own cleanup and relay state.
      }
    }, SOCKET_KEEPALIVE_INTERVAL_MS);
    keepaliveTimer.unref();

    webSocket.on("message", (raw) => {
      try {
        const payload = this.parseJson(raw);
        if (connectionKey === null) {
          const connectRequest = this.parseConnectRequest(payload);
          connectionKey = this.relayService.attachConnection(connectRequest, webSocket);
          clearTimeout(handshakeTimer);
          return;
        }
        const result = this.parseResult(payload);
        const accepted = this.relayService.acceptDeviceResult(connectionKey, result);
        if (!accepted) {
          this.logger.warn(
            `[browser-bridge] dropped late or unknown result command=${result.commandId} remote=${request.socket.remoteAddress ?? "unknown"}`
          );
        }
      } catch (error) {
        const message = String(error);
        this.logger.warn(
          `[browser-bridge] websocket message rejected remote=${request.socket.remoteAddress ?? "unknown"} error=${message}`
        );
        webSocket.close(
          connectionKey === null ? INVALID_AUTH_CLOSE_CODE : INVALID_MESSAGE_CLOSE_CODE,
          "invalid_message"
        );
      }
    });

    webSocket.on("close", () => {
      clearTimeout(handshakeTimer);
      clearInterval(keepaliveTimer);
      if (connectionKey !== null) {
        this.relayService.disconnectConnection(connectionKey, "bridge_connection_closed");
      }
    });

    webSocket.on("error", (error) => {
      this.logger.warn(
        `[browser-bridge] websocket error remote=${request.socket.remoteAddress ?? "unknown"} error=${String(error)}`
      );
    });
  }

  private extractPathname(request: IncomingMessage): string {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      return url.pathname;
    } catch {
      return "";
    }
  }

  private parseJson(raw: RawData): unknown {
    const text =
      typeof raw === "string"
        ? raw
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw).toString("utf8")
          : Array.isArray(raw)
            ? Buffer.concat(raw.map((chunk) => Buffer.from(chunk))).toString("utf8")
            : Buffer.from(raw).toString("utf8");
    return JSON.parse(text);
  }

  private parseConnectRequest(payload: unknown): LocalBrowserBridgeWebSocketConnectRequest {
    if (!isObjectRecord(payload)) {
      throw new Error("WebSocket connect payload must be an object.");
    }
    const deviceKind = requiredString(payload.deviceKind, "deviceKind");
    if (!(LOCAL_BROWSER_BRIDGE_DEVICE_KINDS as readonly string[]).includes(deviceKind)) {
      throw new Error("deviceKind is not supported.");
    }
    return {
      assistantId: requiredString(payload.assistantId, "assistantId"),
      workspaceId: requiredString(payload.workspaceId, "workspaceId"),
      bridgeDeviceId: requiredString(payload.bridgeDeviceId, "bridgeDeviceId"),
      deviceKind: deviceKind as LocalBrowserBridgeDeviceKind,
      deviceToken: requiredString(payload.deviceToken, "deviceToken")
    };
  }

  private parseResult(payload: unknown): LocalBrowserResult {
    if (!isObjectRecord(payload)) {
      throw new Error("Browser bridge result payload must be an object.");
    }
    const result: LocalBrowserResult = {
      commandId: requiredString(payload.commandId, "commandId"),
      ok: this.requiredBoolean(payload.ok, "ok")
    };
    const finalUrl = optionalString(payload.finalUrl, "finalUrl");
    if (finalUrl !== undefined) {
      result.finalUrl = finalUrl;
    }
    const title = optionalString(payload.title, "title");
    if (title !== undefined) {
      result.title = title;
    }
    const content = optionalString(payload.content, "content");
    if (content !== undefined) {
      result.content = content;
    }
    const truncated = optionalBoolean(payload.truncated, "truncated");
    if (truncated !== undefined) {
      result.truncated = truncated;
    }
    if (Array.isArray(payload.elements)) {
      result.elements = payload.elements as NonNullable<LocalBrowserResult["elements"]>;
    }
    if (Array.isArray(payload.extracted)) {
      result.extracted = payload.extracted as NonNullable<LocalBrowserResult["extracted"]>;
    }
    const warning = optionalString(payload.warning, "warning");
    if (warning !== undefined) {
      result.warning = warning;
    }
    const artifact = this.parseArtifact(payload.artifact);
    if (artifact !== undefined) {
      result.artifact = artifact;
    }
    const errorReason = optionalString(payload.errorReason, "errorReason");
    if (errorReason !== undefined) {
      result.errorReason = errorReason;
    }
    return result;
  }

  parseCommand(payload: unknown): LocalBrowserCommand {
    if (!isObjectRecord(payload)) {
      throw new Error("Browser bridge command payload must be an object.");
    }
    const action = requiredString(payload.action, "command.action");
    if (!(LOCAL_BROWSER_COMMAND_ACTIONS as readonly string[]).includes(action)) {
      throw new Error("command.action is not supported.");
    }
    const format = optionalString(payload.format, "command.format");
    if (
      format !== undefined &&
      format !== null &&
      !(PERSAI_RUNTIME_BROWSER_SNAPSHOT_FORMATS as readonly string[]).includes(format)
    ) {
      throw new Error("command.format is not supported.");
    }
    const command: LocalBrowserCommand = {
      commandId: requiredString(payload.commandId, "command.commandId"),
      profileKey: requiredString(payload.profileKey, "command.profileKey"),
      action: action as LocalBrowserCommandAction
    };
    const url = optionalString(payload.url, "command.url");
    if (url !== undefined) {
      command.url = url;
    }
    const stayOnPage = optionalBoolean(payload.stayOnPage, "command.stayOnPage");
    if (stayOnPage !== undefined) {
      command.stayOnPage = stayOnPage;
    }
    if (Array.isArray(payload.operations)) {
      command.operations = payload.operations as NonNullable<LocalBrowserCommand["operations"]>;
    }
    if (format !== undefined) {
      command.format = format as NonNullable<LocalBrowserCommand["format"]>;
    }
    const optimizeForSpeed = optionalBoolean(payload.optimizeForSpeed, "command.optimizeForSpeed");
    if (optimizeForSpeed !== undefined) {
      command.optimizeForSpeed = optimizeForSpeed;
    }
    const timeoutMs = optionalNumber(payload.timeoutMs, "command.timeoutMs");
    if (timeoutMs !== undefined) {
      command.timeoutMs = timeoutMs;
    }
    const showWindow = optionalBoolean(payload.showWindow, "command.showWindow");
    if (showWindow !== undefined) {
      command.showWindow = showWindow;
    }
    return command;
  }

  private parseArtifact(value: unknown): LocalBrowserResult["artifact"] {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (!isObjectRecord(value)) {
      throw new Error("artifact must be an object, null, or undefined.");
    }
    return {
      mimeType: requiredString(value.mimeType, "artifact.mimeType"),
      base64: requiredString(value.base64, "artifact.base64")
    };
  }

  private requiredBoolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") {
      throw new Error(`${label} must be a boolean.`);
    }
    return value;
  }
}
