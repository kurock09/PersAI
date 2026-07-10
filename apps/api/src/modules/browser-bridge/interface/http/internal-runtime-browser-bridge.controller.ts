import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req
} from "@nestjs/common";
import type {
  LocalBrowserBridgeDispatchCommandRequest,
  LocalBrowserBridgeGetCommandResultResult
} from "@persai/runtime-contract";
import { assertPersaiInternalApiAuthorized } from "../../../workspace-management/interface/http/assert-persai-internal-api-auth";
import {
  BrowserBridgeRelayService,
  type BrowserBridgeDispatchOutcome
} from "../../application/browser-bridge-relay.service";
import { BrowserBridgeWebSocketServer } from "../../application/browser-bridge-websocket.server";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/browser-bridge")
export class InternalRuntimeBrowserBridgeController {
  constructor(
    private readonly browserBridgeRelayService: BrowserBridgeRelayService,
    private readonly browserBridgeWebSocketServer: BrowserBridgeWebSocketServer
  ) {}

  @HttpCode(200)
  @Post("dispatch")
  async dispatch(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<BrowserBridgeDispatchOutcome> {
    this.assertAuthorized(req);
    return this.browserBridgeRelayService.dispatchCommand(this.parseDispatchBody(body));
  }

  @HttpCode(200)
  @Get("result/:commandId")
  async getResult(
    @Req() req: InternalRequestLike,
    @Param("commandId") commandId: string
  ): Promise<LocalBrowserBridgeGetCommandResultResult> {
    this.assertAuthorized(req);
    const trimmedCommandId = commandId.trim();
    if (trimmedCommandId.length === 0) {
      throw new BadRequestException("commandId must be a non-empty string.");
    }
    return this.browserBridgeRelayService.getCommandResult(trimmedCommandId);
  }

  private parseDispatchBody(body: unknown): LocalBrowserBridgeDispatchCommandRequest {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const request: LocalBrowserBridgeDispatchCommandRequest = {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      command: this.browserBridgeWebSocketServer.parseCommand(row.command)
    };
    const bridgeDeviceId = this.optionalString(row.bridgeDeviceId, "bridgeDeviceId");
    if (bridgeDeviceId !== undefined) {
      request.bridgeDeviceId = bridgeDeviceId;
    }
    if (row.requireBridgeDeviceId !== undefined) {
      if (typeof row.requireBridgeDeviceId !== "boolean") {
        throw new BadRequestException("requireBridgeDeviceId must be boolean or undefined.");
      }
      request.requireBridgeDeviceId = row.requireBridgeDeviceId;
    }
    return request;
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

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for browser bridge internal APIs.",
      "Internal browser bridge authorization failed."
    );
  }
}
