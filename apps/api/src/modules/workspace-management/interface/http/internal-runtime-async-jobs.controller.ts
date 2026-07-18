import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ResolveAssistantAsyncJobService } from "../../application/resolve-assistant-async-job.service";
import { AssistantAsyncJobHandleStateService } from "../../application/assistant-async-job-handle-state.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

export function parseInternalAsyncJobChannel(value: unknown): "web" | "telegram" | "max_ru" {
  if (value !== "web" && value !== "telegram" && value !== "max_ru") {
    throw new BadRequestException("channel must be one of: web, telegram, max_ru.");
  }
  return value;
}

@Controller("api/v1/internal/runtime/async-jobs")
export class InternalRuntimeAsyncJobsController {
  constructor(
    private readonly resolver: ResolveAssistantAsyncJobService,
    private readonly handleState: AssistantAsyncJobHandleStateService
  ) {}

  @HttpCode(200)
  @Post("status")
  async status(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Body() body: Record<string, unknown>
  ) {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async job status.",
      "Internal async job status authorization failed."
    );
    return this.resolver.execute({
      jobRef: this.text(body.jobRef),
      assistantId: this.text(body.assistantId),
      workspaceId: this.text(body.workspaceId),
      chatId: this.text(body.chatId),
      channel: parseInternalAsyncJobChannel(body.channel),
      threadKey: this.text(body.threadKey)
    });
  }

  @HttpCode(200)
  @Post("subscribe")
  async subscribe(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Body() body: Record<string, unknown>
  ) {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async job subscription.",
      "Internal async job subscription authorization failed."
    );
    const channel = parseInternalAsyncJobChannel(body.channel);
    if (channel === "max_ru") {
      return { outcome: "not_found" as const };
    }
    return this.handleState.subscribePending({
      jobRef: this.text(body.jobRef),
      assistantId: this.text(body.assistantId),
      workspaceId: this.text(body.workspaceId),
      chatId: this.text(body.chatId),
      channel,
      threadKey: this.text(body.threadKey)
    });
  }

  private text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
