import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageNotificationPlatformService } from "../../application/notifications/manage-notification-platform.service";
import type {
  NotificationChannelView,
  NotificationTemplateCatalogView,
  NotificationPolicyView,
  QuietHoursView,
  DeliveryIntentView,
  DeadLetterView,
  PreviewResult,
  TestSendResult,
  TestSendInput,
  TestSendForSourceInput,
  TestSendForSourceResult,
  ListDeliveriesQuery,
  ListDeadLettersQuery
} from "../../application/notifications/manage-notification-platform.service";

@Controller("api/v1/admin/notifications")
export class AdminNotificationsController {
  constructor(
    private readonly manageNotificationPlatformService: ManageNotificationPlatformService
  ) {}

  // ── ADR-088 unified channel registry ─────────────────────────────────────

  @Get("channels")
  async listUnifiedChannels(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    channels: NotificationChannelView[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const channels = await this.manageNotificationPlatformService.listChannels(userId);
    return { requestId: req.requestId ?? null, channels };
  }

  @Patch("channels/:channelType")
  async patchChannel(
    @Req() req: RequestWithPlatformContext,
    @Param("channelType") channelType: string,
    @Body() body: unknown
  ): Promise<NotificationChannelView> {
    const userId = this.resolveRequestUserId(req);
    const input = parsePatchChannelInput(body);
    return this.manageNotificationPlatformService.patchChannel(userId, channelType, input);
  }

  @Get("templates")
  async listTemplates(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null } & NotificationTemplateCatalogView> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.manageNotificationPlatformService.listTemplates(userId);
    return { requestId: req.requestId ?? null, ...result };
  }

  @Post("channels/:channelType/test-send")
  @HttpCode(HttpStatus.OK)
  async testSendChannel(
    @Req() req: RequestWithPlatformContext,
    @Param("channelType") channelType: string,
    @Body() body: unknown
  ): Promise<TestSendResult> {
    const userId = this.resolveRequestUserId(req);
    const input = parseTestSendInput(body);
    return this.manageNotificationPlatformService.testSendChannel(userId, channelType, input);
  }

  @Post("policies/:source/test")
  @HttpCode(HttpStatus.OK)
  async testSendForSource(
    @Req() req: RequestWithPlatformContext,
    @Param("source") source: string,
    @Body() body: unknown
  ): Promise<TestSendForSourceResult> {
    const userId = this.resolveRequestUserId(req);
    const input = parseTestSendForSourceInput(body);
    return this.manageNotificationPlatformService.testSendForSource(userId, source, input);
  }

  // ── ADR-088 unified policies ──────────────────────────────────────────────

  @Get("policies")
  async listPolicies(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    policies: NotificationPolicyView[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const policies = await this.manageNotificationPlatformService.listPolicies(userId);
    return { requestId: req.requestId ?? null, policies };
  }

  @Patch("policies/:source")
  async patchPolicy(
    @Req() req: RequestWithPlatformContext,
    @Param("source") source: string,
    @Body() body: unknown
  ): Promise<NotificationPolicyView> {
    const userId = this.resolveRequestUserId(req);
    const input = parsePatchPolicyInput(body);
    return this.manageNotificationPlatformService.patchPolicy(userId, source, input);
  }

  // ── ADR-088 quiet hours ───────────────────────────────────────────────────

  @Get("quiet-hours")
  async getQuietHours(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    quietHours: QuietHoursView | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const quietHours = await this.manageNotificationPlatformService.getQuietHours(userId);
    return { requestId: req.requestId ?? null, quietHours };
  }

  @Patch("quiet-hours")
  async patchQuietHours(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<QuietHoursView> {
    const userId = this.resolveRequestUserId(req);
    const input = parsePatchQuietHoursInput(body);
    return this.manageNotificationPlatformService.patchQuietHours(userId, input);
  }

  // ── ADR-088 delivery history ──────────────────────────────────────────────

  @Get("deliveries")
  async listDeliveries(
    @Req() req: RequestWithPlatformContext,
    @Query() query: Record<string, string>
  ): Promise<{
    requestId: string | null;
    items: DeliveryIntentView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const deliveryQuery: ListDeliveriesQuery = {};
    if (query["source"] !== undefined) deliveryQuery.source = query["source"];
    if (query["class"] !== undefined) deliveryQuery.class = query["class"];
    if (query["channel"] !== undefined) deliveryQuery.channel = query["channel"];
    if (query["status"] !== undefined) deliveryQuery.status = query["status"];
    if (query["dateFrom"] !== undefined) deliveryQuery.dateFrom = query["dateFrom"];
    if (query["dateTo"] !== undefined) deliveryQuery.dateTo = query["dateTo"];
    if (query["page"] !== undefined) deliveryQuery.page = Number(query["page"]);
    if (query["pageSize"] !== undefined) deliveryQuery.pageSize = Number(query["pageSize"]);
    const result = await this.manageNotificationPlatformService.listDeliveries(
      userId,
      deliveryQuery
    );
    return { requestId: req.requestId ?? null, ...result };
  }

  @Get("deliveries/:intentId")
  async getDelivery(
    @Req() req: RequestWithPlatformContext,
    @Param("intentId") intentId: string
  ): Promise<DeliveryIntentView> {
    const userId = this.resolveRequestUserId(req);
    return this.manageNotificationPlatformService.getDelivery(userId, intentId);
  }

  // ── ADR-088 dead letters ──────────────────────────────────────────────────

  @Get("dead-letters")
  async listDeadLetters(
    @Req() req: RequestWithPlatformContext,
    @Query() query: Record<string, string>
  ): Promise<{
    requestId: string | null;
    deadLetters: DeadLetterView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const dlQuery: ListDeadLettersQuery = {};
    if (query["source"] !== undefined) dlQuery.source = query["source"];
    if (query["status"] !== undefined) dlQuery.status = query["status"];
    if (query["dateFrom"] !== undefined) dlQuery.dateFrom = query["dateFrom"];
    if (query["dateTo"] !== undefined) dlQuery.dateTo = query["dateTo"];
    if (query["page"] !== undefined) dlQuery.page = Number(query["page"]);
    if (query["pageSize"] !== undefined) dlQuery.pageSize = Number(query["pageSize"]);
    const result = await this.manageNotificationPlatformService.listDeadLetters(userId, dlQuery);
    return { requestId: req.requestId ?? null, ...result };
  }

  @Post("dead-letters/:id/replay")
  async replayDeadLetter(
    @Req() req: RequestWithPlatformContext,
    @Param("id") id: string
  ): Promise<{
    requestId: string | null;
    intentId: string;
  }> {
    const userId = this.resolveRequestUserId(req);
    const { intentId } = await this.manageNotificationPlatformService.replayDeadLetter(userId, id);
    return { requestId: req.requestId ?? null, intentId };
  }

  @Post("dead-letters/:id/discard")
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardDeadLetter(
    @Req() req: RequestWithPlatformContext,
    @Param("id") id: string
  ): Promise<void> {
    const userId = this.resolveRequestUserId(req);
    await this.manageNotificationPlatformService.discardDeadLetter(userId, id);
  }

  // ── ADR-088 preview ───────────────────────────────────────────────────────

  @Post("preview")
  @HttpCode(HttpStatus.OK)
  async preview(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<PreviewResult> {
    const userId = this.resolveRequestUserId(req);
    const input = parsePreviewInput(body);
    return this.manageNotificationPlatformService.preview(userId, input);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}

// ── Input parsers ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePatchChannelInput(body: unknown) {
  if (!isRecord(body)) {
    return {};
  }
  return {
    ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {}),
    ...(isRecord(body["config"]) ? { config: body["config"] } : {}),
    ...(typeof body["healthStatus"] === "string" ? { healthStatus: body["healthStatus"] } : {})
  };
}

function parsePatchPolicyInput(body: unknown) {
  if (!isRecord(body)) {
    return {};
  }
  return {
    ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {}),
    ...(Array.isArray(body["channels"]) ? { channels: body["channels"] as string[] } : {}),
    ...(typeof body["cooldownMinutes"] === "number" || body["cooldownMinutes"] === null
      ? { cooldownMinutes: body["cooldownMinutes"] as number | null }
      : {}),
    ...(typeof body["maxPerDay"] === "number" || body["maxPerDay"] === null
      ? { maxPerDay: body["maxPerDay"] as number | null }
      : {}),
    ...(typeof body["escalationAfterMinutes"] === "number" ||
    body["escalationAfterMinutes"] === null
      ? { escalationAfterMinutes: body["escalationAfterMinutes"] as number | null }
      : {}),
    ...(typeof body["escalationChannel"] === "string" || body["escalationChannel"] === null
      ? { escalationChannel: body["escalationChannel"] as string | null }
      : {}),
    ...(typeof body["respectQuietHours"] === "boolean"
      ? { respectQuietHours: body["respectQuietHours"] }
      : {}),
    ...(typeof body["renderStrategy"] === "string"
      ? { renderStrategy: body["renderStrategy"] }
      : {}),
    ...(typeof body["renderInstructionRef"] === "string" || body["renderInstructionRef"] === null
      ? { renderInstructionRef: body["renderInstructionRef"] as string | null }
      : {}),
    ...(typeof body["templateId"] === "string" || body["templateId"] === null
      ? { templateId: body["templateId"] as string | null }
      : {}),
    ...(isRecord(body["config"]) ? { config: body["config"] } : {})
  };
}

function parsePatchQuietHoursInput(body: unknown) {
  if (!isRecord(body)) {
    return {};
  }
  return {
    ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {}),
    ...(typeof body["startLocal"] === "string" ? { startLocal: body["startLocal"] } : {}),
    ...(typeof body["endLocal"] === "string" ? { endLocal: body["endLocal"] } : {}),
    ...(typeof body["timezoneMode"] === "string" ? { timezoneMode: body["timezoneMode"] } : {}),
    ...(typeof body["defaultTimezone"] === "string" || body["defaultTimezone"] === null
      ? { defaultTimezone: body["defaultTimezone"] as string | null }
      : {}),
    ...(Array.isArray(body["appliesToSources"])
      ? { appliesToSources: body["appliesToSources"] as string[] }
      : {})
  };
}

function parsePreviewInput(body: unknown) {
  if (!isRecord(body)) {
    return {
      renderStrategy: "static_fallback" as const,
      factPayload: {}
    };
  }
  const renderStrategy =
    typeof body["renderStrategy"] === "string"
      ? (body["renderStrategy"] as "grounded_llm" | "template" | "static_fallback")
      : ("static_fallback" as const);

  return {
    renderStrategy,
    templateId: typeof body["templateId"] === "string" ? body["templateId"] : null,
    renderInstructionRef:
      typeof body["renderInstructionRef"] === "string" ? body["renderInstructionRef"] : null,
    factPayload: isRecord(body["factPayload"]) ? body["factPayload"] : {}
  };
}

function parseTestSendInput(body: unknown): TestSendInput | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  return {
    ...(typeof body["renderStrategy"] === "string"
      ? {
          renderStrategy: body["renderStrategy"] as "grounded_llm" | "template" | "static_fallback"
        }
      : {}),
    ...(typeof body["templateId"] === "string" || body["templateId"] === null
      ? { templateId: body["templateId"] as string | null }
      : {}),
    ...(typeof body["renderInstructionRef"] === "string" || body["renderInstructionRef"] === null
      ? { renderInstructionRef: body["renderInstructionRef"] as string | null }
      : {}),
    ...(isRecord(body["factPayload"]) ? { factPayload: body["factPayload"] } : {})
  };
}

function parseTestSendForSourceInput(body: unknown): TestSendForSourceInput {
  if (!isRecord(body)) {
    return {};
  }
  return {
    ...(typeof body["eventCode"] === "string" || body["eventCode"] === null
      ? { eventCode: body["eventCode"] as string | null }
      : {}),
    ...(typeof body["channelOverride"] === "string" || body["channelOverride"] === null
      ? { channelOverride: body["channelOverride"] as string | null }
      : {})
  };
}
