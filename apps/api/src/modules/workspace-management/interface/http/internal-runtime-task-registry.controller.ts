import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { ControlInternalAssistantReminderTaskService } from "../../application/control-internal-assistant-reminder-task.service";
import { loadApiConfig } from "@persai/config";
import { ListInternalAssistantTaskItemsService } from "../../application/list-internal-assistant-task-items.service";
import { SyncAssistantTaskRegistryService } from "../../application/sync-assistant-task-registry.service";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

function readFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function resolveRequestBaseUrl(req: InternalRequestLike): string {
  const proto = readFirstHeaderValue(req.headers["x-forwarded-proto"])?.trim() || "http";
  const host =
    readFirstHeaderValue(req.headers["x-forwarded-host"])?.trim() ||
    readFirstHeaderValue(req.headers.host)?.trim() ||
    "";
  if (!host) {
    throw new UnauthorizedException(
      "Internal runtime task control requires a resolvable request host."
    );
  }
  return `${proto}://${host}`;
}

@Controller("api/v1/internal/runtime/tasks")
export class InternalRuntimeTaskRegistryController {
  constructor(
    private readonly syncAssistantTaskRegistryService: SyncAssistantTaskRegistryService,
    private readonly listInternalAssistantTaskItemsService: ListInternalAssistantTaskItemsService,
    private readonly controlInternalAssistantReminderTaskService: ControlInternalAssistantReminderTaskService
  ) {}

  @Get("items")
  async listTaskItems(
    @Req() req: InternalRequestLike,
    @Query("assistantId") assistantId: string | undefined
  ): Promise<{
    ok: true;
    items: Array<{
      id: string;
      title: string;
      controlStatus: "active" | "disabled";
      nextRunAt: string | null;
      externalRef: string | null;
    }>;
  }> {
    this.assertAuthorized(req);
    const trimmedAssistantId = assistantId?.trim() ?? "";
    const items = await this.listInternalAssistantTaskItemsService.execute(trimmedAssistantId);
    return { ok: true, items };
  }

  @HttpCode(200)
  @Post("sync")
  async syncTaskRegistry(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    this.assertAuthorized(req);
    const input = this.syncAssistantTaskRegistryService.parseInput(body);
    return this.syncAssistantTaskRegistryService.execute(input);
  }

  @HttpCode(200)
  @Post("control")
  async controlReminderTask(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<unknown> {
    this.assertAuthorized(req);
    const rawBody =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const input = this.controlInternalAssistantReminderTaskService.parseInput({
      ...rawBody,
      callbackBaseUrl: resolveRequestBaseUrl(req)
    });
    return this.controlInternalAssistantReminderTaskService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    const rawAuthHeader = req.headers.authorization;
    const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
    const token =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : "";
    const configured = loadApiConfig(process.env).OPENCLAW_GATEWAY_TOKEN?.trim() ?? "";
    if (configured.length === 0) {
      throw new UnauthorizedException(
        "OPENCLAW_GATEWAY_TOKEN must be configured for internal runtime task sync."
      );
    }
    if (token.length === 0 || token !== configured) {
      throw new UnauthorizedException("Internal runtime task sync authorization failed.");
    }
  }
}
