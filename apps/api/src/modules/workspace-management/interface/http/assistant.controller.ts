import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import type { AssistantLifecycleState } from "../../application/assistant-lifecycle.types";
import type { UserPlanVisibilityState } from "../../application/plan-visibility.types";
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
import { PreviewAssistantSetupService } from "../../application/preview-assistant-setup.service";
import { ResolvePlanVisibilityService } from "../../application/resolve-plan-visibility.service";
import { ResolveTelegramIntegrationStateService } from "../../application/resolve-telegram-integration-state.service";
import type { AssistantNotificationPreferenceState } from "../../application/assistant-notification-preference.types";
import { ResolveAssistantNotificationPreferenceService } from "../../application/resolve-assistant-notification-preference.service";
import type { AssistantVoiceSettingsState } from "../../application/resolve-assistant-voice-settings.service";
import { ResolveAssistantVoiceSettingsService } from "../../application/resolve-assistant-voice-settings.service";
import { ConnectTelegramIntegrationService } from "../../application/connect-telegram-integration.service";
import { UpdateTelegramIntegrationConfigService } from "../../application/update-telegram-integration-config.service";
import { UpdateAssistantNotificationPreferenceService } from "../../application/update-assistant-notification-preference.service";
import { RevokeTelegramIntegrationSecretService } from "../../application/revoke-telegram-integration-secret.service";
import { ResendTelegramOwnerMessageService } from "../../application/resend-telegram-owner-message.service";
import { DoNotRememberAssistantMemoryService } from "../../application/do-not-remember-assistant-memory.service";
import { ForgetAssistantMemoryItemService } from "../../application/forget-assistant-memory-item.service";
import { ListAssistantMemoryItemsService } from "../../application/list-assistant-memory-items.service";
import { ListAssistantTaskItemsService } from "../../application/list-assistant-task-items.service";
import { DisableAssistantTaskRegistryItemService } from "../../application/disable-assistant-task-registry-item.service";
import { EnableAssistantTaskRegistryItemService } from "../../application/enable-assistant-task-registry-item.service";
import { CancelAssistantTaskRegistryItemService } from "../../application/cancel-assistant-task-registry-item.service";
import type {
  AssistantWebChatCompactionResult,
  AssistantWebChatCompactionState,
  AssistantWebChatListItemState,
  AssistantWebChatMessageState,
  AssistantWebChatTurnState
} from "../../application/web-chat.types";
import type { TelegramIntegrationState } from "../../application/telegram-integration.types";
import { toAssistantInboundHttpException } from "../../application/assistant-inbound-error";
import { ManageAssistantAvatarService } from "../../application/manage-assistant-avatar.service";
import {
  ManageAssistantWorkspaceMemoryService,
  type WorkspaceMemoryItemState
} from "../../application/manage-assistant-workspace-memory.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { createStreamWriterInstrumentation } from "./stream-writer-instrumentation";

const WEB_CHAT_STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

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
    private readonly previewAssistantSetupService: PreviewAssistantSetupService,
    private readonly resolvePlanVisibilityService: ResolvePlanVisibilityService,
    private readonly resolveTelegramIntegrationStateService: ResolveTelegramIntegrationStateService,
    private readonly resolveAssistantNotificationPreferenceService: ResolveAssistantNotificationPreferenceService,
    private readonly resolveAssistantVoiceSettingsService: ResolveAssistantVoiceSettingsService,
    private readonly connectTelegramIntegrationService: ConnectTelegramIntegrationService,
    private readonly updateTelegramIntegrationConfigService: UpdateTelegramIntegrationConfigService,
    private readonly updateAssistantNotificationPreferenceService: UpdateAssistantNotificationPreferenceService,
    private readonly revokeTelegramIntegrationSecretService: RevokeTelegramIntegrationSecretService,
    private readonly resendTelegramOwnerMessageService: ResendTelegramOwnerMessageService,
    private readonly listAssistantMemoryItemsService: ListAssistantMemoryItemsService,
    private readonly forgetAssistantMemoryItemService: ForgetAssistantMemoryItemService,
    private readonly doNotRememberAssistantMemoryService: DoNotRememberAssistantMemoryService,
    private readonly listAssistantTaskItemsService: ListAssistantTaskItemsService,
    private readonly disableAssistantTaskRegistryItemService: DisableAssistantTaskRegistryItemService,
    private readonly enableAssistantTaskRegistryItemService: EnableAssistantTaskRegistryItemService,
    private readonly cancelAssistantTaskRegistryItemService: CancelAssistantTaskRegistryItemService,
    private readonly manageAssistantAvatarService: ManageAssistantAvatarService,
    private readonly manageAssistantWorkspaceMemoryService: ManageAssistantWorkspaceMemoryService,
    private readonly prisma: WorkspaceManagementPrismaService
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

  @Get("assistant/voice/settings")
  async getAssistantVoiceSettings(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    settings: AssistantVoiceSettingsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.resolveAssistantVoiceSettingsService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      settings
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

  @Post("assistant/setup/preview")
  @HttpCode(200)
  async previewSetup(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    preview: { message: string; respondedAt: string };
  }> {
    const userId = this.resolveRequestUserId(req);
    const preview = await this.previewAssistantSetupService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      preview
    };
  }

  @Post("assistant/avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(
    @Req() req: RequestWithPlatformContext,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<{ requestId: string | null; avatarUrl: string }> {
    if (!file || !file.mimetype.startsWith("image/")) {
      throw new BadRequestException("An image file is required.");
    }
    const result = await this.manageAssistantAvatarService.upload({
      userId: this.resolveRequestUserId(req),
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      avatarUrl: this.buildAbsoluteAssistantAvatarUrl(req)
    });

    return { requestId: req.requestId ?? null, avatarUrl: result.avatarUrl };
  }

  @Get("assistant/avatar")
  async getAvatar(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext
  ): Promise<void> {
    const result = await this.manageAssistantAvatarService.download(this.resolveRequestUserId(req));
    if (!result) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "No avatar found." }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.end(result.buffer);
  }

  @Get("assistant/plan-visibility")
  async getAssistantPlanVisibility(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    visibility: UserPlanVisibilityState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const visibility = await this.resolvePlanVisibilityService.getUserVisibility(userId);

    return {
      requestId: req.requestId ?? null,
      visibility
    };
  }

  @Get("assistant/integrations/telegram")
  async getTelegramIntegrationState(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    integration: TelegramIntegrationState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const integration = await this.resolveTelegramIntegrationStateService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      integration
    };
  }

  @Get("assistant/notification-preference")
  async getNotificationPreference(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    preference: AssistantNotificationPreferenceState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const preference = await this.resolveAssistantNotificationPreferenceService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      preference
    };
  }

  @Patch("assistant/notification-preference")
  async updateNotificationPreference(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    preference: AssistantNotificationPreferenceState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.updateAssistantNotificationPreferenceService.parseInput(body);
    const preference = await this.updateAssistantNotificationPreferenceService.execute(
      userId,
      input
    );
    return {
      requestId: req.requestId ?? null,
      preference
    };
  }

  @Post("assistant/integrations/telegram/connect")
  @HttpCode(200)
  async connectTelegramIntegration(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    integration: TelegramIntegrationState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.connectTelegramIntegrationService.parseInput(body);
    const integration = await this.connectTelegramIntegrationService.execute(userId, input);
    return {
      requestId: req.requestId ?? null,
      integration
    };
  }

  @Post("assistant/integrations/telegram/rotate")
  @HttpCode(200)
  async rotateTelegramIntegrationSecret(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    integration: TelegramIntegrationState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.connectTelegramIntegrationService.parseInput(body);
    const integration = await this.connectTelegramIntegrationService.execute(userId, input);
    return {
      requestId: req.requestId ?? null,
      integration
    };
  }

  @Post("assistant/integrations/telegram/revoke")
  @HttpCode(200)
  async revokeTelegramIntegrationSecret(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    integration: TelegramIntegrationState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.revokeTelegramIntegrationSecretService.parseInput(body);
    const integration = await this.revokeTelegramIntegrationSecretService.execute(
      userId,
      input,
      false
    );
    return {
      requestId: req.requestId ?? null,
      integration
    };
  }

  @Post("assistant/integrations/telegram/emergency-revoke")
  @HttpCode(200)
  async emergencyRevokeTelegramIntegrationSecret(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    integration: TelegramIntegrationState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.revokeTelegramIntegrationSecretService.parseInput(body);
    const integration = await this.revokeTelegramIntegrationSecretService.execute(
      userId,
      input,
      true
    );
    return {
      requestId: req.requestId ?? null,
      integration
    };
  }

  @Patch("assistant/integrations/telegram/config")
  async updateTelegramIntegrationConfig(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    integration: TelegramIntegrationState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.updateTelegramIntegrationConfigService.parseInput(body);
    const integration = await this.updateTelegramIntegrationConfigService.execute(userId, input);
    return {
      requestId: req.requestId ?? null,
      integration
    };
  }

  @Post("assistant/integrations/telegram/resend-owner-message")
  @HttpCode(200)
  async resendTelegramOwnerMessage(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    integration: TelegramIntegrationState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const integration = await this.resendTelegramOwnerMessageService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      integration
    };
  }

  @Get("assistant/integrations/telegram/groups")
  async getTelegramGroups(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    groups: Array<{
      id: string;
      telegramChatId: string;
      title: string;
      memberCount: number | null;
      status: string;
      joinedAt: string;
    }>;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true }
    });
    if (!assistant) {
      return { requestId: req.requestId ?? null, groups: [] };
    }
    const allGroups = await this.prisma.assistantTelegramGroup.findMany({
      where: { assistantId: assistant.id },
      orderBy: { updatedAt: "desc" }
    });
    const seen = new Map<string, (typeof allGroups)[number]>();
    for (const g of allGroups) {
      const key = g.title.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, g);
      }
    }
    const groups = Array.from(seen.values());
    return {
      requestId: req.requestId ?? null,
      groups: groups.map((g) => ({
        id: g.id,
        telegramChatId: g.telegramChatId,
        title: g.title,
        memberCount: g.memberCount,
        status: g.status,
        joinedAt: g.joinedAt.toISOString()
      }))
    };
  }

  @Post("assistant/publish")
  @HttpCode(200)
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
    await this.resetAssistantService.execute(userId);
    const assistant = await this.getAssistantByUserIdService.execute(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found after reset.");
    }

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/reapply")
  @HttpCode(200)
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
      sourceType: "web_chat" | "memory_write";
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

  @Get("assistant/tasks/items")
  async listTaskItems(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    items: Array<{
      id: string;
      title: string;
      sourceSurface: "web";
      sourceLabel: string | null;
      audience: "user" | "assistant";
      actionType: string | null;
      controlStatus: "active" | "disabled" | "cancelled";
      nextRunAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const userId = this.resolveRequestUserId(req);
    const items = await this.listAssistantTaskItemsService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      items
    };
  }

  @Post("assistant/tasks/items/:itemId/disable")
  async disableTaskItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{
    requestId: string | null;
    disabled: true;
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.disableAssistantTaskRegistryItemService.execute(userId, itemId);

    return {
      requestId: req.requestId ?? null,
      disabled: result.disabled
    };
  }

  @Post("assistant/tasks/items/:itemId/enable")
  async enableTaskItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{
    requestId: string | null;
    enabled: true;
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.enableAssistantTaskRegistryItemService.execute(userId, itemId);

    return {
      requestId: req.requestId ?? null,
      enabled: result.enabled
    };
  }

  @Post("assistant/tasks/items/:itemId/cancel")
  async cancelTaskItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{
    requestId: string | null;
    cancelled: true;
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.cancelAssistantTaskRegistryItemService.execute(userId, itemId);

    return {
      requestId: req.requestId ?? null,
      cancelled: result.cancelled
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

  @Get("assistant/memory/workspace/items")
  async listWorkspaceMemoryItems(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    items: WorkspaceMemoryItemState[];
  }> {
    return {
      requestId: req.requestId ?? null,
      items: await this.manageAssistantWorkspaceMemoryService.list(this.resolveRequestUserId(req))
    };
  }

  @Post("assistant/memory/workspace/add")
  async addWorkspaceMemoryItem(
    @Req() req: RequestWithPlatformContext,
    @Body() body: { content: string }
  ): Promise<{ requestId: string | null; item: WorkspaceMemoryItemState }> {
    return {
      requestId: req.requestId ?? null,
      item: await this.manageAssistantWorkspaceMemoryService.add(
        this.resolveRequestUserId(req),
        body.content
      )
    };
  }

  @Patch("assistant/memory/workspace/edit")
  async editWorkspaceMemoryItem(
    @Req() req: RequestWithPlatformContext,
    @Body() body: { itemId: string; content: string }
  ): Promise<{ requestId: string | null; updated: true }> {
    await this.manageAssistantWorkspaceMemoryService.edit(
      this.resolveRequestUserId(req),
      body.itemId,
      body.content
    );
    return { requestId: req.requestId ?? null, updated: true };
  }

  @Post("assistant/memory/workspace/forget")
  async forgetWorkspaceMemoryItem(
    @Req() req: RequestWithPlatformContext,
    @Body() body: { itemId: string }
  ): Promise<{ requestId: string | null; forgotten: true }> {
    await this.manageAssistantWorkspaceMemoryService.forget(
      this.resolveRequestUserId(req),
      body.itemId
    );
    return { requestId: req.requestId ?? null, forgotten: true };
  }

  @Get("assistant/memory/workspace/search")
  async searchWorkspaceMemory(
    @Req() req: RequestWithPlatformContext,
    @Query("q") query: string
  ): Promise<{ requestId: string | null; items: WorkspaceMemoryItemState[] }> {
    return {
      requestId: req.requestId ?? null,
      items: await this.manageAssistantWorkspaceMemoryService.search(
        this.resolveRequestUserId(req),
        query
      )
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

  @Get("assistant/chats/web/:chatId/messages")
  async listWebChatMessages(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitParam?: string
  ): Promise<{
    requestId: string | null;
    messages: AssistantWebChatMessageState[];
    nextCursor: string | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const limit = Math.min(Math.max(parseInt(limitParam ?? "50", 10) || 50, 1), 100);
    const result = await this.manageWebChatListService.listChatMessages(userId, chatId, {
      cursor: cursor ?? null,
      limit
    });

    return {
      requestId: req.requestId ?? null,
      messages: result.messages,
      nextCursor: result.nextCursor
    };
  }

  @Get("assistant/chats/web/:chatId/compaction")
  async getWebChatCompactionState(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string
  ): Promise<{
    requestId: string | null;
    state: AssistantWebChatCompactionState;
  }> {
    const userId = this.resolveRequestUserId(req);
    try {
      const state = await this.manageWebChatListService.getChatCompactionState(userId, chatId);
      return {
        requestId: req.requestId ?? null,
        state
      };
    } catch (error) {
      throw toAssistantInboundHttpException(error);
    }
  }

  @Post("assistant/chats/web/:chatId/compact")
  @HttpCode(200)
  async compactWebChat(
    @Req() req: RequestWithPlatformContext,
    @Param("chatId") chatId: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    state: AssistantWebChatCompactionState;
    result: AssistantWebChatCompactionResult;
  }> {
    const userId = this.resolveRequestUserId(req);
    const instructions =
      typeof body === "object" &&
      body !== null &&
      "instructions" in body &&
      typeof (body as { instructions?: unknown }).instructions === "string"
        ? (body as { instructions: string }).instructions.trim() || undefined
        : undefined;
    try {
      const response = await this.manageWebChatListService.compactChat(
        userId,
        chatId,
        instructions
      );
      return {
        requestId: req.requestId ?? null,
        state: response.state,
        result: response.result
      };
    } catch (error) {
      throw toAssistantInboundHttpException(error);
    }
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
    const input = this.manageWebChatListService.parseUpdateInput(body);
    const chat = await this.manageWebChatListService.updateChat(userId, chatId, input);

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
    const preparation = await this.streamWebChatTurnService.prepare(userId, input);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let clientClosed = false;
    const clientAbortController = new AbortController();
    req.on("aborted", () => {
      clientClosed = true;
      clientAbortController.abort();
    });
    res.on("close", () => {
      if (!res.writableEnded) {
        clientClosed = true;
        clientAbortController.abort();
      }
    });

    const sseWriterInstrumentation = createStreamWriterInstrumentation();
    const sendSse = (event: string, payload: unknown): void => {
      if (clientClosed) {
        return;
      }

      const writeReturnedTrue = res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      sseWriterInstrumentation.recordWrite(writeReturnedTrue, res);
      const flushable = res as unknown as { flush?: () => void };
      if (typeof flushable.flush === "function") {
        flushable.flush();
      }
    };
    const sendHeartbeat = (): void => {
      if (clientClosed) {
        return;
      }
      // SSE comments are ignored by the browser client but keep the stream warm through proxies.
      const writeReturnedTrue = res.write(": keepalive\n\n");
      sseWriterInstrumentation.recordWrite(writeReturnedTrue, res);
      const flushable = res as unknown as { flush?: () => void };
      if (typeof flushable.flush === "function") {
        flushable.flush();
      }
    };
    const heartbeat = setInterval(sendHeartbeat, WEB_CHAT_STREAM_HEARTBEAT_INTERVAL_MS);

    try {
      if (preparation.mode === "replayed") {
        sendSse("completed", { transport: preparation.transport });
        res.end();
        return;
      }

      const prepared = preparation.prepared;
      sendSse("started", {
        requestId: req.requestId ?? null,
        chat: prepared.chat,
        userMessage: prepared.userMessage
      });
      prepared.traceHandle?.stage("sse_started_sent");

      const outcome = await this.streamWebChatTurnService.streamToCompletion(prepared, {
        isClientAborted: () => clientClosed,
        clientAbortSignal: clientAbortController.signal,
        onDelta: (delta) => {
          sendSse("delta", { delta });
        },
        onThinking: (delta, accumulated) => {
          sendSse("thinking", { delta, accumulated });
        },
        onTool: ({ phase, toolName, toolCallId, isError }) => {
          sendSse("tool", { phase, toolName, toolCallId, isError });
        },
        onDone: (respondedAt) => {
          sendSse("runtime_done", { respondedAt });
        },
        onStreamReset: ({ reason, attempt }) => {
          sendSse("stream_reset", { reason, attempt });
        },
        getSseWriterStatsSummary: () =>
          prepared.traceHandle?.isEnabled() === true ? sseWriterInstrumentation.formatStats() : null
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

      sendSse("failed", {
        code: outcome.code,
        message: outcome.message,
        transport: outcome.transport
      });
      res.end();
    } finally {
      clearInterval(heartbeat);
    }
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    return req.resolvedAppUser.id;
  }

  private buildAbsoluteAssistantAvatarUrl(req: RequestWithPlatformContext): string {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocol =
      typeof forwardedProto === "string" && forwardedProto.trim().length > 0
        ? forwardedProto.split(",")[0]!.trim()
        : "https";
    const forwardedHost = req.headers["x-forwarded-host"];
    const host =
      typeof forwardedHost === "string" && forwardedHost.trim().length > 0
        ? forwardedHost.split(",")[0]!.trim()
        : req.headers.host;
    if (!host) {
      throw new BadRequestException("Unable to resolve assistant avatar host.");
    }
    return `${protocol}://${host}/api/v1/assistant/avatar`;
  }
}
