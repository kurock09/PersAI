import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import { ControlInternalScheduledActionService } from "../../application/control-internal-scheduled-action.service";
import { ListInternalAssistantTaskItemsService } from "../../application/list-internal-assistant-task-items.service";
import { SyncAssistantTaskRegistryService } from "../../application/sync-assistant-task-registry.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/tasks")
export class InternalRuntimeTaskRegistryController {
  constructor(
    private readonly syncAssistantTaskRegistryService: SyncAssistantTaskRegistryService,
    private readonly listInternalAssistantTaskItemsService: ListInternalAssistantTaskItemsService,
    private readonly controlInternalScheduledActionService: ControlInternalScheduledActionService
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
      audience: "user" | "assistant";
      actionType: string | null;
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
  async controlScheduledAction(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<unknown> {
    this.assertAuthorized(req);
    const rawBody =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const input = this.controlInternalScheduledActionService.parseInput(rawBody);
    return this.controlInternalScheduledActionService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime task sync.",
      "Internal runtime task sync authorization failed."
    );
  }
}
