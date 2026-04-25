import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import { ControlInternalBackgroundTaskService } from "../../application/control-internal-background-task.service";
import { ListInternalBackgroundTaskItemsService } from "../../application/list-internal-background-task-items.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/background-tasks")
export class InternalRuntimeBackgroundTasksController {
  constructor(
    private readonly listInternalBackgroundTaskItemsService: ListInternalBackgroundTaskItemsService,
    private readonly controlInternalBackgroundTaskService: ControlInternalBackgroundTaskService
  ) {}

  @Get("items")
  async listBackgroundTaskItems(
    @Req() req: InternalRequestLike,
    @Query("assistantId") assistantId: string | undefined
  ): Promise<{
    ok: true;
    items: Awaited<ReturnType<ListInternalBackgroundTaskItemsService["execute"]>>;
  }> {
    this.assertAuthorized(req);
    const items = await this.listInternalBackgroundTaskItemsService.execute(
      assistantId?.trim() ?? ""
    );
    return { ok: true, items };
  }

  @HttpCode(200)
  @Post("control")
  async controlBackgroundTask(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<unknown> {
    this.assertAuthorized(req);
    const input = this.controlInternalBackgroundTaskService.parseInput(body);
    return this.controlInternalBackgroundTaskService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime background tasks.",
      "Internal runtime background-task authorization failed."
    );
  }
}
