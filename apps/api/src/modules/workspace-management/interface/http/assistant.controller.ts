import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { PublishAssistantDraftService } from "../../application/publish-assistant-draft.service";
import { ReapplyAssistantService } from "../../application/reapply-assistant.service";
import { ResetAssistantService } from "../../application/reset-assistant.service";
import { RollbackAssistantService } from "../../application/rollback-assistant.service";
import { AssistantRuntimePreflightService } from "../../application/assistant-runtime-preflight.service";
import { SendWebChatTurnService } from "../../application/send-web-chat-turn.service";
import { ManageWebChatListService } from "../../application/manage-web-chat-list.service";
import { StreamWebChatTurnService } from "../../application/stream-web-chat-turn.service";
import { WebChatTurnHardStopRegistry } from "../../application/web-chat-turn-hard-stop-registry.service";
import { WebChatTurnStreamRegistry } from "../../application/web-chat-turn-stream-registry.service";
import {
  WebChatTurnAttemptService,
  type WebChatTurnStatusState
} from "../../application/web-chat-turn-attempt.service";
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
import { RefreshTelegramGroupsService } from "../../application/refresh-telegram-groups.service";
import { DoNotRememberAssistantMemoryService } from "../../application/do-not-remember-assistant-memory.service";
import { ForgetAssistantMemoryItemService } from "../../application/forget-assistant-memory-item.service";
import { CloseAssistantMemoryByRefService } from "../../application/close-assistant-memory-by-ref.service";
import { ListAssistantMemoryItemsService } from "../../application/list-assistant-memory-items.service";
import type { AssistantMemoryRegistryItemState } from "../../application/assistant-memory.types";
import { ListAssistantTaskItemsService } from "../../application/list-assistant-task-items.service";
import { ListAssistantBackgroundTaskItemsService } from "../../application/list-assistant-background-task-items.service";
import { ControlAssistantBackgroundTaskService } from "../../application/control-assistant-background-task.service";
import type { InternalBackgroundTaskItemState } from "../../application/list-internal-background-task-items.service";
import { DisableAssistantTaskRegistryItemService } from "../../application/disable-assistant-task-registry-item.service";
import { EnableAssistantTaskRegistryItemService } from "../../application/enable-assistant-task-registry-item.service";
import { CancelAssistantTaskRegistryItemService } from "../../application/cancel-assistant-task-registry-item.service";
import type {
  AssistantWebChatActiveTurnState,
  AssistantWebChatCompactionResult,
  AssistantWebChatCompactionState,
  AssistantWebChatEngagementSummary,
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
import { ManagePersonaArchetypesService } from "../../application/manage-persona-archetypes.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";
import { ResolveAssistantLifecycleViewService } from "../../application/resolve-assistant-lifecycle-view.service";
import { SwitchActiveAssistantService } from "../../application/switch-active-assistant.service";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { createStreamWriterInstrumentation } from "./stream-writer-instrumentation";

const WEB_CHAT_STREAM_HEARTBEAT_INTERVAL_MS = 10_000;
type AssistantLifecycleView = Awaited<ReturnType<ResolveAssistantLifecycleViewService["execute"]>>;
type AssistantContractResponse = {
  requestId: string | null;
  assistant: AssistantLifecycleState;
  assistants: AssistantLifecycleView["assistants"];
  activeAssistantId: string | null;
  assistantLimit: AssistantLifecycleView["assistantLimit"];
};
type AssistantListResponse = {
  requestId: string | null;
  assistants: AssistantLifecycleView["assistants"];
  activeAssistantId: string | null;
  assistantLimit: AssistantLifecycleView["assistantLimit"];
};

@Controller("api/v1")
export class AssistantController {
  constructor(
    private readonly createAssistantService: CreateAssistantService,
    private readonly publishAssistantDraftService: PublishAssistantDraftService,
    private readonly reapplyAssistantService: ReapplyAssistantService,
    private readonly rollbackAssistantService: RollbackAssistantService,
    private readonly resetAssistantService: ResetAssistantService,
    private readonly assistantRuntimePreflightService: AssistantRuntimePreflightService,
    private readonly sendWebChatTurnService: SendWebChatTurnService,
    private readonly manageWebChatListService: ManageWebChatListService,
    private readonly streamWebChatTurnService: StreamWebChatTurnService,
    private readonly webChatTurnHardStopRegistry: WebChatTurnHardStopRegistry,
    private readonly webChatTurnStreamRegistry: WebChatTurnStreamRegistry,
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
    private readonly refreshTelegramGroupsService: RefreshTelegramGroupsService,
    private readonly listAssistantMemoryItemsService: ListAssistantMemoryItemsService,
    private readonly forgetAssistantMemoryItemService: ForgetAssistantMemoryItemService,
    private readonly closeAssistantMemoryByRefService: CloseAssistantMemoryByRefService,
    private readonly doNotRememberAssistantMemoryService: DoNotRememberAssistantMemoryService,
    private readonly listAssistantTaskItemsService: ListAssistantTaskItemsService,
    private readonly listAssistantBackgroundTaskItemsService: ListAssistantBackgroundTaskItemsService,
    private readonly controlAssistantBackgroundTaskService: ControlAssistantBackgroundTaskService,
    private readonly disableAssistantTaskRegistryItemService: DisableAssistantTaskRegistryItemService,
    private readonly enableAssistantTaskRegistryItemService: EnableAssistantTaskRegistryItemService,
    private readonly cancelAssistantTaskRegistryItemService: CancelAssistantTaskRegistryItemService,
    private readonly manageAssistantAvatarService: ManageAssistantAvatarService,
    private readonly manageAssistantWorkspaceMemoryService: ManageAssistantWorkspaceMemoryService,
    private readonly managePersonaArchetypesService: ManagePersonaArchetypesService,
    private readonly webChatTurnAttemptService: WebChatTurnAttemptService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    private readonly resolveAssistantLifecycleViewService: ResolveAssistantLifecycleViewService,
    private readonly switchActiveAssistantService: SwitchActiveAssistantService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  @Post("assistant")
  async createAssistant(
    @Req() req: RequestWithPlatformContext
  ): Promise<AssistantContractResponse> {
    const userId = this.resolveRequestUserId(req);
    await this.createAssistantService.execute(userId);
    return this.buildAssistantResponse(
      userId,
      req.requestId ?? null,
      "Assistant not found after creation."
    );
  }

  @Get("assistant")
  async getAssistant(@Req() req: RequestWithPlatformContext): Promise<AssistantContractResponse> {
    return this.buildAssistantResponse(
      this.resolveRequestUserId(req),
      req.requestId ?? null,
      "Assistant does not exist for this workspace."
    );
  }

  @Get("assistant/list")
  async listAssistants(@Req() req: RequestWithPlatformContext): Promise<AssistantListResponse> {
    const state = await this.resolveAssistantLifecycleViewService.execute(
      this.resolveRequestUserId(req)
    );
    return {
      requestId: req.requestId ?? null,
      assistants: state.assistants,
      activeAssistantId: state.activeAssistantId,
      assistantLimit: state.assistantLimit
    };
  }

  @Post("assistant/switch")
  @HttpCode(200)
  async switchAssistant(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<AssistantContractResponse> {
    const userId = this.resolveRequestUserId(req);
    const input = this.parseSwitchAssistantInput(body);
    await this.switchActiveAssistantService.execute({
      userId,
      assistantId: input.assistantId
    });
    return this.buildAssistantResponse(
      userId,
      req.requestId ?? null,
      "Assistant not found after switch."
    );
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

  @Patch("assistant/voice/elevenlabs/curation")
  async patchElevenLabsVoiceCuration(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    settings: AssistantVoiceSettingsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const settings = await this.resolveAssistantVoiceSettingsService.updateElevenLabsCuration({
      userId,
      patches: this.parseElevenLabsVoiceCurationInput(body)
    });
    return {
      requestId: req.requestId ?? null,
      settings
    };
  }

  @Post("assistant/voice/elevenlabs/refresh")
  async refreshElevenLabsVoiceCatalog(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    settings: AssistantVoiceSettingsState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const settings =
      await this.resolveAssistantVoiceSettingsService.refreshElevenLabsCatalog(userId);
    return {
      requestId: req.requestId ?? null,
      settings
    };
  }

  @Get("assistant/persona-archetypes")
  async listPersonaArchetypes(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    archetypes: Array<{
      key: string;
      displayOrder: number;
      label: { ru: string; en: string };
      description: { ru: string; en: string };
      voice: {
        sentenceLength: "short" | "medium" | "long";
        pace: "slow" | "normal" | "quick";
        irony: number;
      };
      defaultTraits: Record<string, number>;
    }>;
  }> {
    this.resolveRequestUserId(req);
    const archetypes = await this.managePersonaArchetypesService.listForRuntime();
    return {
      requestId: req.requestId ?? null,
      archetypes: archetypes.map((archetype) => ({
        key: archetype.key,
        displayOrder: archetype.displayOrder,
        label: archetype.label,
        description: archetype.description,
        voice: archetype.voice,
        defaultTraits: archetype.defaultTraits
      }))
    };
  }

  @Patch("assistant/draft")
  async updateDraft(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<AssistantContractResponse> {
    const userId = this.resolveRequestUserId(req);
    const input = this.updateAssistantDraftService.parseInput(body);
    await this.updateAssistantDraftService.execute(userId, input);
    return this.buildAssistantResponse(
      userId,
      req.requestId ?? null,
      "Assistant does not exist for this workspace."
    );
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
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 12 * 1024 * 1024 } }))
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
      originalFilename: file.originalname
    });

    return { requestId: req.requestId ?? null, avatarUrl: result.avatarUrl };
  }

  /**
   * ADR-076 Slice 4 — content-addressed avatar bytes.
   *
   * The browser never calls this directly; the `apps/web` BFF
   * (`/api/avatar/[hash]`) authenticates the Clerk cookie session, then
   * issues a server-side bearer fetch here. The hash in the path must match
   * the assistant's current `draft.avatarUrl` hash; mismatches return 404
   * so stale CDN/proxy entries cannot leak superseded bytes.
   */
  @Get("assistant/avatar/:hash")
  async getAvatarByHash(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("hash") hash: string
  ): Promise<void> {
    const result = await this.manageAssistantAvatarService.downloadByHash(
      this.resolveRequestUserId(req),
      hash
    );
    if (!result) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "No avatar found for this hash." }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("ETag", `"${hash}"`);
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
    const assistant = await this.resolveActiveAssistantService.executeOptional({ userId });
    if (!assistant) {
      return { requestId: req.requestId ?? null, groups: [] };
    }
    const allGroups = await this.prisma.assistantTelegramGroup.findMany({
      where: { assistantId: assistant.assistantId },
      orderBy: { updatedAt: "desc" }
    });
    const seen = new Map<string, (typeof allGroups)[number]>();
    for (const g of allGroups) {
      const key = g.title.toLowerCase();
      const existing = seen.get(key);
      if (existing === undefined || (existing.status !== "active" && g.status === "active")) {
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

  @Post("assistant/integrations/telegram/groups/refresh")
  @HttpCode(200)
  async refreshTelegramGroups(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    refreshed: true;
  }> {
    const userId = this.resolveRequestUserId(req);
    await this.refreshTelegramGroupsService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      refreshed: true
    };
  }

  @Post("assistant/publish")
  @HttpCode(200)
  async publishAssistant(
    @Req() req: RequestWithPlatformContext
  ): Promise<AssistantContractResponse> {
    const userId = this.resolveRequestUserId(req);
    await this.publishAssistantDraftService.execute(userId);
    return this.buildAssistantResponse(
      userId,
      req.requestId ?? null,
      "Assistant does not exist for this workspace."
    );
  }

  @Post("assistant/rollback")
  async rollbackAssistant(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<AssistantContractResponse> {
    const userId = this.resolveRequestUserId(req);
    const input = this.rollbackAssistantService.parseInput(body);
    await this.rollbackAssistantService.execute(userId, input);
    return this.buildAssistantResponse(
      userId,
      req.requestId ?? null,
      "Assistant does not exist for this workspace."
    );
  }

  @Post("assistant/reset")
  async resetAssistant(@Req() req: RequestWithPlatformContext): Promise<AssistantContractResponse> {
    const userId = this.resolveRequestUserId(req);
    await this.resetAssistantService.execute(userId);
    return this.buildAssistantResponse(
      userId,
      req.requestId ?? null,
      "Assistant not found after reset."
    );
  }

  @Post("assistant/reapply")
  @HttpCode(200)
  async reapplyAssistant(
    @Req() req: RequestWithPlatformContext
  ): Promise<AssistantContractResponse> {
    const userId = this.resolveRequestUserId(req);
    await this.reapplyAssistantService.execute(userId);
    return this.buildAssistantResponse(
      userId,
      req.requestId ?? null,
      "Assistant does not exist for this workspace."
    );
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
    items: AssistantMemoryRegistryItemState[];
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

  @Post("assistant/memory/items/:itemId/close-open-loop")
  @HttpCode(200)
  async closeOpenLoopMemoryItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{
    requestId: string | null;
    closed: boolean;
    closedItemId: string | null;
    reason: "closed" | "already_closed";
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.closeAssistantMemoryByRefService.executeForUser(
      userId,
      itemId,
      req.requestId ?? null
    );
    return {
      requestId: req.requestId ?? null,
      closed: result.closed,
      closedItemId: result.closedItemId,
      reason: result.reason === "closed" ? "closed" : "already_closed"
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

  @Get("assistant/background-tasks/items")
  async listBackgroundTaskItems(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    items: InternalBackgroundTaskItemState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const items = await this.listAssistantBackgroundTaskItemsService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      items
    };
  }

  @Post("assistant/background-tasks/items/:itemId/disable")
  async disableBackgroundTaskItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{ requestId: string | null; disabled: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.controlAssistantBackgroundTaskService.execute(userId, itemId, "pause");
    return { requestId: req.requestId ?? null, disabled: true };
  }

  @Post("assistant/background-tasks/items/:itemId/enable")
  async enableBackgroundTaskItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{ requestId: string | null; enabled: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.controlAssistantBackgroundTaskService.execute(userId, itemId, "resume");
    return { requestId: req.requestId ?? null, enabled: true };
  }

  @Post("assistant/background-tasks/items/:itemId/cancel")
  async cancelBackgroundTaskItem(
    @Req() req: RequestWithPlatformContext,
    @Param("itemId") itemId: string
  ): Promise<{ requestId: string | null; cancelled: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.controlAssistantBackgroundTaskService.execute(userId, itemId, "cancel");
    return { requestId: req.requestId ?? null, cancelled: true };
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
    activeTurn: AssistantWebChatActiveTurnState | null;
    activeMediaJobs: AssistantWebChatListItemState["activeMediaJobs"];
    activeDocumentJobs: AssistantWebChatListItemState["activeDocumentJobs"];
    currentEngagement: AssistantWebChatEngagementSummary | null;
    pendingBrowserLogin: AssistantWebChatListItemState["pendingBrowserLogin"];
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
      nextCursor: result.nextCursor,
      activeTurn: result.activeTurn,
      activeMediaJobs: result.activeMediaJobs,
      activeDocumentJobs: result.activeDocumentJobs,
      currentEngagement: result.currentEngagement,
      pendingBrowserLogin: result.pendingBrowserLogin
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

  @Get("assistant/chat/web/turns/:clientTurnId")
  async getWebChatTurnStatus(
    @Req() req: RequestWithPlatformContext,
    @Param("clientTurnId") clientTurnId: string
  ): Promise<{ requestId: string | null; turn: WebChatTurnStatusState }> {
    const userId = this.resolveRequestUserId(req);
    const normalizedClientTurnId = clientTurnId.trim();
    if (normalizedClientTurnId.length === 0) {
      throw new BadRequestException("clientTurnId must be a non-empty string.");
    }
    return {
      requestId: req.requestId ?? null,
      turn: await this.webChatTurnAttemptService.getStatusForUser(userId, normalizedClientTurnId)
    };
  }

  @Get("assistant/chat/web/turns/:clientTurnId/stream")
  async reattachWebChatTurnStream(
    @Req() req: RequestWithPlatformContext,
    @Res() res: ResponseWithPlatformContext,
    @Param("clientTurnId") clientTurnId: string
  ): Promise<void> {
    const userId = this.resolveRequestUserId(req);
    const normalizedClientTurnId = clientTurnId.trim();
    if (normalizedClientTurnId.length === 0) {
      throw new BadRequestException("clientTurnId must be a non-empty string.");
    }
    const resolvedAssistant = await this.resolveActiveAssistantService.execute({ userId });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let clientClosed = false;
    const sendSse = (event: string, payload: unknown): void => {
      if (clientClosed) {
        return;
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      const flushable = res as unknown as { flush?: () => void };
      if (typeof flushable.flush === "function") {
        flushable.flush();
      }
    };
    const close = (): void => {
      if (!clientClosed) {
        clientClosed = true;
        res.end();
      }
    };
    const sendTerminalStatus = (status: WebChatTurnStatusState): void => {
      if (status.status === "failed") {
        sendSse("failed", {
          code: status.error?.code ?? "turn_failed",
          message: status.error?.message ?? "Web chat turn failed.",
          transport: null
        });
        return;
      }
      if (status.status === "interrupted") {
        sendSse("interrupted", { transport: null });
        return;
      }
      sendSse("completed", { transport: null });
    };

    const initialStatus = await this.webChatTurnAttemptService.getStatusForUser(
      userId,
      normalizedClientTurnId,
      resolvedAssistant.assistantId
    );
    sendSse("turn_status", { turn: initialStatus });
    if (initialStatus.status !== "accepted" && initialStatus.status !== "running") {
      sendTerminalStatus(initialStatus);
      close();
      return;
    }

    const detach = this.webChatTurnStreamRegistry.attach({
      assistantId: resolvedAssistant.assistantId,
      clientTurnId: normalizedClientTurnId,
      userId,
      onEvent: sendSse
    });
    sendSse("reattached", { turn: initialStatus, live: detach !== null });

    let lastStatusPayload = JSON.stringify(initialStatus);
    const statusPoll = setInterval(async () => {
      try {
        const status = await this.webChatTurnAttemptService.getStatusForUser(
          userId,
          normalizedClientTurnId,
          resolvedAssistant.assistantId
        );
        const nextPayload = JSON.stringify(status);
        if (nextPayload !== lastStatusPayload) {
          lastStatusPayload = nextPayload;
          sendSse("turn_status", { turn: status });
        }
        if (status.status !== "accepted" && status.status !== "running") {
          sendTerminalStatus(status);
          close();
        }
      } catch {
        sendSse("failed", {
          code: "turn_status_unavailable",
          message: "Could not refresh web chat turn status.",
          transport: null
        });
        close();
      }
    }, 1_000);
    const heartbeat = setInterval(() => {
      if (!clientClosed) {
        res.write(": keepalive\n\n");
      }
    }, WEB_CHAT_STREAM_HEARTBEAT_INTERVAL_MS);
    const cleanup = (): void => {
      clientClosed = true;
      clearInterval(statusPoll);
      clearInterval(heartbeat);
      detach?.();
    };
    req.on("aborted", cleanup);
    res.on("close", cleanup);
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
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Pre-prod polish 2026 / FIX 1, Slice 1.2 — server-side soft-detach.
    //
    // Two distinct conditions used to be conflated under a single
    // "client gone" flag:
    //   1) SSE socket is dead — we can no longer write deltas to it.
    //   2) The user explicitly asked the runtime to stop generating.
    //
    // The previous handler aborted the runtime on (1), which corrupted
    // long-running turns whenever the user just backgrounded their tab,
    // locked their phone screen, or briefly lost connectivity. Slice 1.2
    // splits the two: `clientClosed` tracks (1) and only suppresses SSE
    // writes; `clientAbortController` is now triggered exclusively by
    // (2), which arrives via the new `POST assistant/chat/web/stop`
    // endpoint after the user presses the Stop button. On a passive
    // disconnect the runtime keeps generating, the existing persistence
    // path stores the full assistant message, and the client picks it
    // up via history fetch on reconnect. The hard-stop path still walks
    // through `client-aborted` → `persistInterruptedOutcome` exactly as
    // before, so the partial-message contract for explicit stops is
    // unchanged.
    let clientClosed = false;
    const clientAbortController = new AbortController();
    req.on("aborted", () => {
      clientClosed = true;
    });
    res.on("close", () => {
      if (!res.writableEnded) {
        clientClosed = true;
      }
    });

    let clientTurnIdForRegistry: string | undefined;
    let assistantIdForRegistry: string | undefined;
    let streamRegistryUserId: string | undefined;
    const sseWriterInstrumentation = createStreamWriterInstrumentation();
    const sendSse = (event: string, payload: unknown): void => {
      if (assistantIdForRegistry !== undefined && clientTurnIdForRegistry !== undefined) {
        this.webChatTurnStreamRegistry.publish({
          assistantId: assistantIdForRegistry,
          clientTurnId: clientTurnIdForRegistry,
          userId,
          event,
          payload
        });
      }
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
    sendHeartbeat();
    const heartbeat = setInterval(sendHeartbeat, WEB_CHAT_STREAM_HEARTBEAT_INTERVAL_MS);

    try {
      let preparation: Awaited<ReturnType<StreamWebChatTurnService["prepare"]>>;
      try {
        preparation = await this.streamWebChatTurnService.prepare(userId, input);
      } catch (error) {
        const normalized = toAssistantInboundHttpException(error);
        sendSse("failed", {
          code: normalized.errorObject.code,
          message: normalized.errorObject.message,
          transport: null
        });
        res.end();
        return;
      }

      clientTurnIdForRegistry =
        preparation.mode === "prepared" ? preparation.prepared.clientTurnId : undefined;
      if (clientTurnIdForRegistry !== undefined && preparation.mode === "prepared") {
        assistantIdForRegistry = preparation.prepared.assistantId;
        streamRegistryUserId = preparation.prepared.userId;
        this.webChatTurnHardStopRegistry.register({
          assistantId: preparation.prepared.assistantId,
          clientTurnId: clientTurnIdForRegistry,
          userId: preparation.prepared.userId,
          controller: clientAbortController
        });
        this.webChatTurnStreamRegistry.register({
          assistantId: preparation.prepared.assistantId,
          clientTurnId: clientTurnIdForRegistry,
          userId: preparation.prepared.userId
        });
      }

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
        // After Slice 1.2, "client aborted" means the user explicitly
        // asked the runtime to stop — only the hard-stop POST flips the
        // signal. A dead SSE socket alone never sets this, which is what
        // routes a soft-detached turn through the regular full-message
        // persistence path.
        isClientAborted: () => clientAbortController.signal.aborted,
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
        onActivity: ({ source, phase, resultCount, skillName, skillIconEmoji }) => {
          sendSse("activity", {
            source,
            phase,
            resultCount,
            ...(skillName === undefined ? {} : { skillName }),
            ...(skillIconEmoji === undefined ? {} : { skillIconEmoji })
          });
        },
        onProjectActivity: ({ stage, status, summary, detail, sourceClass, resultCount }) => {
          sendSse("project_activity", {
            stage,
            status,
            summary,
            ...(detail === undefined ? {} : { detail }),
            ...(sourceClass === undefined ? {} : { sourceClass }),
            ...(resultCount === undefined ? {} : { resultCount })
          });
        },
        onProjectReasoningSummary: ({ kind, summary, detail }) => {
          sendSse("project_reasoning_summary", {
            kind,
            summary,
            ...(detail === undefined ? {} : { detail })
          });
        },
        onDone: (respondedAt) => {
          sendSse("runtime_done", { respondedAt });
        },
        onStreamReset: ({ reason, attempt }) => {
          sendSse("stream_reset", { reason, attempt });
        },
        onPendingBrowserLogin: (pendingBrowserLogin) => {
          sendSse("pending_browser_login", { pendingBrowserLogin });
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
      if (assistantIdForRegistry !== undefined && clientTurnIdForRegistry !== undefined) {
        this.webChatTurnHardStopRegistry.release({
          assistantId: assistantIdForRegistry,
          clientTurnId: clientTurnIdForRegistry,
          controller: clientAbortController
        });
        if (streamRegistryUserId !== undefined) {
          this.webChatTurnStreamRegistry.release({
            assistantId: assistantIdForRegistry,
            clientTurnId: clientTurnIdForRegistry,
            userId: streamRegistryUserId
          });
        }
      }
    }
  }

  /**
   * Pre-prod polish 2026 / FIX 1, Slice 1.2 — explicit hard-stop endpoint.
   *
   * Web client calls this fire-and-forget right before locally aborting
   * its EventSource when the user clicks Stop. The body carries the same
   * `clientTurnId` already used by the streaming endpoint and persistence
   * layer to identify the turn end-to-end. We respond 204 unconditionally
   * (idempotent) — if no in-flight turn is registered (turn already
   * finished, request hit the wrong replica, or a stale Stop click), the
   * client falls back to its local socket abort, which preserves the
   * pre-Slice-1.2 behavior. Authorization is enforced both at the
   * controller boundary (via `resolveRequestUserId`) and inside the
   * registry (refusing cross-user dispatch); the 204 does not leak
   * existence.
   */
  @Post("assistant/chat/web/stop")
  @HttpCode(204)
  async stopWebChatTurn(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<void> {
    const userId = this.resolveRequestUserId(req);

    if (typeof body !== "object" || body === null) {
      throw new BadRequestException("Stop request body must be a JSON object.");
    }
    const { clientTurnId } = body as { clientTurnId?: unknown };
    if (typeof clientTurnId !== "string" || clientTurnId.trim().length === 0) {
      throw new BadRequestException("clientTurnId must be a non-empty string.");
    }
    const resolvedAssistant = await this.resolveActiveAssistantService
      .executeOptional({ userId })
      .catch(() => null);
    if (resolvedAssistant === null) {
      return;
    }

    this.webChatTurnHardStopRegistry.signalHardStop({
      assistantId: resolvedAssistant.assistantId,
      clientTurnId: clientTurnId.trim(),
      userId
    });
  }

  private parseSwitchAssistantInput(payload: unknown): { assistantId: string } {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Switch payload must be an object.");
    }
    const assistantId =
      "assistantId" in payload && typeof payload.assistantId === "string"
        ? payload.assistantId.trim()
        : "";
    if (assistantId.length === 0) {
      throw new BadRequestException("assistantId must be a non-empty string.");
    }
    return { assistantId };
  }

  private parseElevenLabsVoiceCurationInput(payload: unknown): Array<{
    voiceId: string;
    approved?: boolean;
    hidden?: boolean;
    previewOk?: boolean | null;
  }> {
    if (typeof payload !== "object" || payload === null || !("patches" in payload)) {
      throw new BadRequestException("patches must be provided.");
    }
    const patches = (payload as { patches?: unknown }).patches;
    if (!Array.isArray(patches)) {
      throw new BadRequestException("patches must be an array.");
    }
    return patches.map((patch) => {
      if (typeof patch !== "object" || patch === null) {
        throw new BadRequestException("Each curation patch must be an object.");
      }
      const row = patch as Record<string, unknown>;
      const voiceId = typeof row.voiceId === "string" ? row.voiceId.trim() : "";
      if (voiceId.length === 0) {
        throw new BadRequestException("voiceId must be a non-empty string.");
      }
      return {
        voiceId,
        ...(typeof row.approved === "boolean" ? { approved: row.approved } : {}),
        ...(typeof row.hidden === "boolean" ? { hidden: row.hidden } : {}),
        ...(typeof row.previewOk === "boolean" || row.previewOk === null
          ? { previewOk: row.previewOk }
          : {})
      };
    });
  }

  private async buildAssistantResponse(
    userId: string,
    requestId: string | null,
    notFoundMessage: string
  ): Promise<AssistantContractResponse> {
    const state = await this.resolveAssistantLifecycleViewService.execute(userId);
    return {
      requestId,
      assistant: this.resolveAssistantLifecycleViewService.assertActiveAssistant(
        state,
        notFoundMessage
      ),
      assistants: state.assistants,
      activeAssistantId: state.activeAssistantId,
      assistantLimit: state.assistantLimit
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    return req.resolvedAppUser.id;
  }
}
