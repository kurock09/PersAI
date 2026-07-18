import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ResolveAssistantAsyncJobService } from "../../application/resolve-assistant-async-job.service";
import {
  assertChatBackgroundJobCap,
  AssistantAsyncJobHandleStateService
} from "../../application/assistant-async-job-handle-state.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
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
    private readonly handleState: AssistantAsyncJobHandleStateService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  /**
   * Admit a new chat-scoped background/foreground job before sandbox submit
   * so shell/exec Process-timeout waits count against the unified 8-cap.
   */
  @HttpCode(200)
  @Post(["assert-cap", "v1/assert-cap"])
  async assertCap(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Body() body: Record<string, unknown>
  ) {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for background job admission.",
      "Internal background job admission authorization failed."
    );
    const chatId = this.text(body.chatId);
    if (chatId.length === 0) {
      throw new BadRequestException("chatId is required.");
    }
    const excludeSandboxJobId = this.text(body.excludeSandboxJobId);
    await assertChatBackgroundJobCap(this.prisma, chatId, {
      ...(excludeSandboxJobId.length > 0 ? { excludeSandboxJobId } : {})
    });
    return { ok: true as const };
  }

  @HttpCode(200)
  @Post(["sandbox/register", "v1/sandbox/register"])
  async registerSandbox(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Body() body: Record<string, unknown>
  ) {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for sandbox job registration.",
      "Internal sandbox job registration authorization failed."
    );
    const channel = parseInternalAsyncJobChannel(body.channel);
    const toolCode = this.text(body.toolCode);
    if (channel === "max_ru" || (toolCode !== "shell" && toolCode !== "exec")) {
      return { registered: false as const };
    }
    return this.handleState.registerSandboxJob({
      canonicalJobId: this.text(body.canonicalJobId),
      assistantId: this.text(body.assistantId),
      workspaceId: this.text(body.workspaceId),
      chatId: this.text(body.chatId),
      channel,
      threadKey: this.text(body.threadKey),
      sourceClientTurnId: this.text(body.sourceClientTurnId),
      sourceUserMessageId: this.text(body.sourceUserMessageId),
      runtimeRequestId: this.text(body.runtimeRequestId),
      runtimeSessionId: this.text(body.runtimeSessionId),
      toolCode
    });
  }

  @HttpCode(200)
  @Post(["snapshot", "v1/snapshot"])
  async snapshot(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Body() body: Record<string, unknown>
  ) {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async job snapshots.",
      "Internal async job snapshot authorization failed."
    );
    return this.resolver.executeSnapshot({
      sourceClientTurnId: this.text(body.sourceClientTurnId),
      assistantId: this.text(body.assistantId),
      workspaceId: this.text(body.workspaceId),
      chatId: this.text(body.chatId),
      channel: parseInternalAsyncJobChannel(body.channel),
      threadKey: this.text(body.threadKey)
    });
  }

  @HttpCode(200)
  @Post(["status", "v1/status"])
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

  /** ADR-157 — image perception refs for the next chat-model call (not model-visible). */
  @HttpCode(200)
  @Post(["perception-artifacts", "v1/perception-artifacts"])
  async perceptionArtifacts(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Body() body: Record<string, unknown>
  ) {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async job perception.",
      "Internal async job perception authorization failed."
    );
    return this.resolver.executePerceptionArtifacts({
      jobRef: this.text(body.jobRef),
      assistantId: this.text(body.assistantId),
      workspaceId: this.text(body.workspaceId),
      chatId: this.text(body.chatId),
      channel: parseInternalAsyncJobChannel(body.channel),
      threadKey: this.text(body.threadKey)
    });
  }

  @HttpCode(200)
  @Post(["subscribe", "v1/subscribe"])
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
