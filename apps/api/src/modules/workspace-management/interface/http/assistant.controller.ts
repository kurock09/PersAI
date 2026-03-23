import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import type { AssistantLifecycleState } from "../../application/assistant-lifecycle.types";
import { CreateAssistantService } from "../../application/create-assistant.service";
import { GetAssistantByUserIdService } from "../../application/get-assistant-by-user-id.service";
import { PublishAssistantDraftService } from "../../application/publish-assistant-draft.service";
import { ReapplyAssistantService } from "../../application/reapply-assistant.service";
import { ResetAssistantService } from "../../application/reset-assistant.service";
import { RollbackAssistantService } from "../../application/rollback-assistant.service";
import { AssistantRuntimePreflightService } from "../../application/assistant-runtime-preflight.service";
import { SendWebChatTurnService } from "../../application/send-web-chat-turn.service";
import { ManageWebChatListService } from "../../application/manage-web-chat-list.service";
import { StreamWebChatTurnService } from "../../application/stream-web-chat-turn.service";
import { UpdateAssistantDraftService } from "../../application/update-assistant-draft.service";
import { DoNotRememberAssistantMemoryService } from "../../application/do-not-remember-assistant-memory.service";
import { ForgetAssistantMemoryItemService } from "../../application/forget-assistant-memory-item.service";
import { ListAssistantMemoryItemsService } from "../../application/list-assistant-memory-items.service";
import type {
  AssistantWebChatListItemState,
  AssistantWebChatTurnState
} from "../../application/web-chat.types";

@Controller("api/v1")
export class AssistantController {
  constructor(
    private readonly createAssistantService: CreateAssistantService,
    private readonly getAssistantByUserIdService: GetAssistantByUserIdService,
    private readonly publishAssistantDraftService: PublishAssistantDraftService,
    private readonly reapplyAssistantService: ReapplyAssistantService,
    private readonly rollbackAssistantService: RollbackAssistantService,
    private readonly resetAssistantService: ResetAssistantService,
    private readonly assistantRuntimePreflightService: AssistantRuntimePreflightService,
    private readonly sendWebChatTurnService: SendWebChatTurnService,
    private readonly manageWebChatListService: ManageWebChatListService,
    private readonly streamWebChatTurnService: StreamWebChatTurnService,
    private readonly updateAssistantDraftService: UpdateAssistantDraftService,
    private readonly listAssistantMemoryItemsService: ListAssistantMemoryItemsService,
    private readonly forgetAssistantMemoryItemService: ForgetAssistantMemoryItemService,
    private readonly doNotRememberAssistantMemoryService: DoNotRememberAssistantMemoryService
  ) {}

  @Post("assistant")
  async createAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.createAssistantService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Get("assistant")
  async getAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.getAssistantByUserIdService.execute(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Patch("assistant/draft")
  async updateDraft(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.updateAssistantDraftService.parseInput(body);
    const assistant = await this.updateAssistantDraftService.execute(userId, input);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/publish")
  async publishAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.publishAssistantDraftService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/rollback")
  async rollbackAssistant(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.rollbackAssistantService.parseInput(body);
    const assistant = await this.rollbackAssistantService.execute(userId, input);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/reset")
  async resetAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.resetAssistantService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/reapply")
  async reapplyAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.reapplyAssistantService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Get("assistant/runtime/preflight")
  async runtimePreflight(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    preflight: {
      live: boolean;
      ready: boolean;
      checkedAt: string;
    };
  }> {
    this.resolveRequestUserId(req);
    const preflight = await this.assistantRuntimePreflightService.execute();

    return {
      requestId: req.requestId ?? null,
      preflight
    };
  }

  @Post("assistant/chat/web")
  async sendWebChatTurn(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    transport: AssistantWebChatTurnState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.sendWebChatTurnService.parseInput(body);
    const transport = await this.sendWebChatTurnService.execute(userId, input);

    return {
      requestId: req.requestId ?? null,
      transport
    };
  }

  @Get("assistant/memory/items")
  async listMemoryItems(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    items: Array<{
      id: string;
      summary: string;
      sourceType: "web_chat";
      sourceLabel: string | null;
      createdAt: string;
      chatId: string | null;
    }>;
  }> {
    const userId = this.resolveRequestUserId(req);
    const items = await this.listAssistantMemoryItemsService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      items
    };
  }

  @Post("assistant/memory/items/:itemId/forget")
  async forgetMemoryItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{
    requestId: string | null;
    forgotten: true;
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.forgetAssistantMemoryItemService.execute(userId, itemId);

    return {
      requestId: req.requestId ?? null,
      forgotten: result.forgotten
    };
  }

  @Post("assistant/memory/do-not-remember")
  async doNotRememberMemory(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    forgottenRegistryItems: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.doNotRememberAssistantMemoryService.parseInput(body);
    const result = await this.doNotRememberAssistantMemoryService.execute(userId, input);

    return {
      requestId: req.requestId ?? null,
      forgottenRegistryItems: result.forgottenRegistryItems
    };
  }

  @Get("assistant/chats/web")
  async listWebChats(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    chats: AssistantWebChatListItemState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const chats = await this.manageWebChatListService.listChats(userId);

    return {
      requestId: req.requestId ?? null,
      chats
    };
  }

  @Patch("assistant/chats/web/:chatId")
  async renameWebChat(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    chat: AssistantWebChatListItemState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageWebChatListService.parseRenameInput(body);
    const chat = await this.manageWebChatListService.renameChat(userId, chatId, input);

    return {
      requestId: req.requestId ?? null,
      chat
    };
  }

  @Post("assistant/chats/web/:chatId/archive")
  async archiveWebChat(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string
  ): Promise<{
    requestId: string | null;
    chat: AssistantWebChatListItemState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const chat = await this.manageWebChatListService.archiveChat(userId, chatId);

    return {
      requestId: req.requestId ?? null,
      chat
    };
  }

  @Delete("assistant/chats/web/:chatId")
  async hardDeleteWebChat(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    deleted: true;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageWebChatListService.parseDeleteInput(body);
    await this.manageWebChatListService.hardDeleteChat(userId, chatId, input);

    return {
      requestId: req.requestId ?? null,
      deleted: true
    };
  }

  @Post("assistant/chat/web/stream")
  async streamWebChatTurn(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Body() body: unknown
  ): Promise<void> {
    const userId = this.resolveRequestUserId(req);
    const input = this.sendWebChatTurnService.parseInput(body);
    const prepared = await this.streamWebChatTurnService.prepare(userId, input);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
    });

    const sendSse = (event: string, payload: unknown): void => {
      if (clientClosed) {
        return;
      }

      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendSse("started", {
      requestId: req.requestId ?? null,
      chat: prepared.chat,
      userMessage: prepared.userMessage
    });

    const outcome = await this.streamWebChatTurnService.streamToCompletion(prepared, {
      isClientAborted: () => clientClosed,
      onDelta: (delta, accumulated) => {
        sendSse("delta", { delta, accumulated });
      },
      onDone: (respondedAt) => {
        sendSse("runtime_done", { respondedAt });
      }
    });

    if (outcome.status === "completed") {
      sendSse("completed", { transport: outcome.transport });
      res.end();
      return;
    }

    if (outcome.status === "interrupted") {
      sendSse("interrupted", { transport: outcome.transport });
      res.end();
      return;
    }

    sendSse("failed", { message: outcome.message, transport: outcome.transport });
    res.end();
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    return req.resolvedAppUser.id;
  }
}
