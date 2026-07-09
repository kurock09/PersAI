import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type {
  LocalBrowserBridgeDeviceKind,
  LocalBrowserBridgeDeviceRegisterRequest,
  LocalBrowserBridgeDeviceRegisterResult
} from "@persai/runtime-contract";
import { LOCAL_BROWSER_BRIDGE_DEVICE_KINDS } from "@persai/runtime-contract";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ResolveActiveAssistantService } from "../../../workspace-management/application/resolve-active-assistant.service";
import { BrowserBridgeRelayService } from "../../application/browser-bridge-relay.service";

function isDeviceKind(value: unknown): value is LocalBrowserBridgeDeviceKind {
  return (
    typeof value === "string" &&
    (LOCAL_BROWSER_BRIDGE_DEVICE_KINDS as readonly string[]).includes(value)
  );
}

@Controller("api/v1/assistant/browser-bridge")
export class AssistantBrowserBridgeDevicesController {
  constructor(
    private readonly browserBridgeRelayService: BrowserBridgeRelayService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  @Post("devices")
  async registerDevice(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<LocalBrowserBridgeDeviceRegisterResult> {
    const userId = this.resolveRequestUserId(req);
    const input = this.parseBody(body);
    const context = await this.resolveActiveAssistantService.execute({
      userId,
      assistantId: input.assistantId
    });
    if (context.workspaceId !== input.workspaceId) {
      throw new BadRequestException("workspaceId does not match the assistant workspace.");
    }
    return this.browserBridgeRelayService.registerDevice(input, this.resolveWebSocketUrl(req));
  }

  private parseBody(body: unknown): LocalBrowserBridgeDeviceRegisterRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const deviceKind = row.deviceKind;
    if (!isDeviceKind(deviceKind)) {
      throw new BadRequestException("deviceKind must be one of: extension, capacitor.");
    }
    const request: LocalBrowserBridgeDeviceRegisterRequest = {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      deviceKind
    };
    const deviceLabel = this.optionalString(row.deviceLabel, "deviceLabel");
    if (deviceLabel !== undefined) {
      request.deviceLabel = deviceLabel;
    }
    const clientVersion = this.optionalString(row.clientVersion, "clientVersion");
    if (clientVersion !== undefined) {
      request.clientVersion = clientVersion;
    }
    return request;
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private resolveWebSocketUrl(req: RequestWithPlatformContext): string {
    const explicitPublicApiBase = this.resolveExplicitPublicApiBaseUrl();
    if (explicitPublicApiBase !== null) {
      return this.buildWebSocketUrlFromHttpBase(explicitPublicApiBase);
    }

    const forwardedProto = this.firstHeader(req.headers["x-forwarded-proto"]);
    const forwardedHost = this.firstHeader(req.headers["x-forwarded-host"]);
    const requestHost = forwardedHost ?? this.firstHeader(req.headers.host) ?? "localhost";
    const host = this.resolveBridgeHostFromWebOrigin(requestHost);
    const proto =
      forwardedProto === "https" || forwardedProto === "wss"
        ? "wss"
        : forwardedProto === "http" || forwardedProto === "ws"
          ? "ws"
          : "ws";
    return `${proto}://${host}/api/v1/assistant/browser-bridge/ws`;
  }

  private resolveExplicitPublicApiBaseUrl(): string | null {
    const raw =
      process.env.PERSAI_PUBLIC_API_BASE_URL?.trim() ||
      process.env.PERSAI_API_PUBLIC_BASE_URL?.trim() ||
      null;
    if (!raw) {
      return null;
    }
    try {
      return new URL(raw).toString();
    } catch {
      return null;
    }
  }

  private buildWebSocketUrlFromHttpBase(httpBaseUrl: string): string {
    const parsed = new URL(httpBaseUrl);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    parsed.pathname = "/api/v1/assistant/browser-bridge/ws";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }

  private resolveBridgeHostFromWebOrigin(requestHost: string): string {
    const webBaseUrl = process.env.PERSAI_WEB_BASE_URL?.trim() ?? "";
    if (!webBaseUrl) {
      return requestHost;
    }
    try {
      const webUrl = new URL(webBaseUrl);
      if (requestHost !== webUrl.host || webUrl.hostname.startsWith("api.")) {
        return requestHost;
      }
      const derivedApiHost = `api.${webUrl.hostname}`;
      return webUrl.port ? `${derivedApiHost}:${webUrl.port}` : derivedApiHost;
    } catch {
      return requestHost;
    }
  }

  private firstHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
      return value[0]?.trim() || null;
    }
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

  private optionalString(value: unknown, label: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} must be a string, null, or undefined.`);
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
