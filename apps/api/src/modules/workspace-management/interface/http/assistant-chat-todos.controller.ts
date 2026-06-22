import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RuntimeTodoItem } from "@persai/runtime-contract";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../../domain/assistant-chat.repository";
import { Inject } from "@nestjs/common";
import { AssistantChatTodosService } from "../../application/assistant-chat-todos.service";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";

interface WebChatPlanResponse {
  requestId: string | null;
  chatId: string;
  todos: RuntimeTodoItem[];
  windowed: boolean;
  totalCount: number;
}

@Controller("api/v1")
export class AssistantChatTodosController {
  constructor(
    private readonly assistantChatTodosService: AssistantChatTodosService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  @Get("assistant/chats/web/:chatId/plan")
  async getWebChatPlan(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string
  ): Promise<WebChatPlanResponse> {
    const userId = this.resolveRequestUserId(req);
    await this.assertChatBelongsToActiveAssistant(userId, chatId);
    // ADR-125 follow-up — `readWindow` collapses the response to the model
    // prompt window (in_progress + 6 recent pending + 2 recent completed),
    // which is wrong for the user-facing card: when all 5 scenario steps
    // are completed the card was rendering "Plan 2/5 +3 more hidden" with
    // only the two most-recently-completed rows visible. Use the full-plan
    // reader instead so the user always sees the real state.
    const fullPlan = await this.assistantChatTodosService.readFullPlanForWeb({ chatId });
    return {
      requestId: req.requestId ?? null,
      chatId,
      todos: fullPlan.todos,
      windowed: fullPlan.windowed,
      totalCount: fullPlan.totalCount
    };
  }

  @Delete("assistant/chats/web/:chatId/plan")
  @HttpCode(200)
  async clearWebChatPlan(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string
  ): Promise<WebChatPlanResponse> {
    const userId = this.resolveRequestUserId(req);
    const chat = await this.assertChatBelongsToActiveAssistant(userId, chatId);
    const result = await this.assistantChatTodosService.applyActionForChat({
      chatId,
      assistantId: chat.assistantId,
      action: { kind: "clear" }
    });
    return {
      requestId: req.requestId ?? null,
      chatId,
      todos: result.todos,
      windowed: result.windowed,
      totalCount: result.totalCount
    };
  }

  private async assertChatBelongsToActiveAssistant(userId: string, chatId: string) {
    const { assistant } = await this.resolveActiveAssistantService.execute({ userId });
    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }
    return chat;
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
