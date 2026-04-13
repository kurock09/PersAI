import { Module } from "@nestjs/common";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { PlatformCoreModule } from "../platform-core/platform-core.module";
import { PrismaService } from "../identity-access/infrastructure/persistence/prisma.service";
import { AssistantController } from "./interface/http/assistant.controller";
import { AdminPlansController } from "./interface/http/admin-plans.controller";
import { AdminSecurityController } from "./interface/http/admin-security.controller";
import { AdminAbuseControlsController } from "./interface/http/admin-abuse-controls.controller";
import { AdminAssistantOwnershipController } from "./interface/http/admin-assistant-ownership.controller";
import { AdminOpsController } from "./interface/http/admin-ops.controller";
import { AdminBusinessController } from "./interface/http/admin-business.controller";
import { AdminOverviewDashboardController } from "./interface/http/admin-overview-dashboard.controller";
import { AdminNotificationsController } from "./interface/http/admin-notifications.controller";
import { AdminPlatformRolloutsController } from "./interface/http/admin-platform-rollouts.controller";
import { AdminRuntimeProviderSettingsController } from "./interface/http/admin-runtime-provider-settings.controller";
import { AdminToolCredentialsController } from "./interface/http/admin-tool-credentials.controller";
import { AdminBootstrapPresetsController } from "./interface/http/admin-bootstrap-presets.controller";
import { InternalCronFireController } from "./interface/http/internal-cron-fire.controller";
import { InternalRuntimeProviderSecretsController } from "./interface/http/internal-runtime-provider-secrets.controller";
import { InternalRuntimeConfigGenerationController } from "./interface/http/internal-runtime-config-generation.controller";
import { InternalRuntimeTaskRegistryController } from "./interface/http/internal-runtime-task-registry.controller";
import { InternalRuntimeToolQuotaController } from "./interface/http/internal-runtime-tool-quota.controller";
import { ResolveEffectiveSubscriptionStateService } from "./application/resolve-effective-subscription-state.service";
import { ResolveEffectiveCapabilityStateService } from "./application/resolve-effective-capability-state.service";
import { ResolveEffectiveToolAvailabilityService } from "./application/resolve-effective-tool-availability.service";
import { ResolveOpenClawChannelSurfaceBindingsService } from "./application/resolve-openclaw-channel-surface-bindings.service";
import { ResolveOpenClawCapabilityEnvelopeService } from "./application/resolve-openclaw-capability-envelope.service";
import { ResolveRuntimeProviderRoutingService } from "./application/resolve-runtime-provider-routing.service";
import { ResolveTelegramIntegrationStateService } from "./application/resolve-telegram-integration-state.service";
import { ResolveAssistantNotificationPreferenceService } from "./application/resolve-assistant-notification-preference.service";
import { ConnectTelegramIntegrationService } from "./application/connect-telegram-integration.service";
import { UpdateTelegramIntegrationConfigService } from "./application/update-telegram-integration-config.service";
import { UpdateAssistantNotificationPreferenceService } from "./application/update-assistant-notification-preference.service";
import { RevokeTelegramIntegrationSecretService } from "./application/revoke-telegram-integration-secret.service";
import { ResendTelegramOwnerMessageService } from "./application/resend-telegram-owner-message.service";
import { ResolvePlanVisibilityService } from "./application/resolve-plan-visibility.service";
import { AppendAssistantAuditEventService } from "./application/append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./application/admin-authorization.service";
import { ResolveAdminOpsCockpitService } from "./application/resolve-admin-ops-cockpit.service";
import { AdminOpsUserDirectoryService } from "./application/admin-ops-user-directory.service";
import { AdminDeleteUserService } from "./application/admin-delete-user.service";
import { ResolveAdminBusinessCockpitService } from "./application/resolve-admin-business-cockpit.service";
import { ResolveAdminBusinessPlatformService } from "./application/resolve-admin-business-platform.service";
import { ResolveAdminOverviewDashboardService } from "./application/resolve-admin-overview-dashboard.service";
import { OverviewLatencyTraceService } from "./application/overview-latency-trace.service";
import { ManageAdminOverviewLatencyTraceService } from "./application/manage-admin-overview-latency-trace.service";
import { ManageAdminNotificationChannelsService } from "./application/manage-admin-notification-channels.service";
import { DeliverAdminSystemNotificationService } from "./application/deliver-admin-system-notification.service";
import { ManagePlatformRolloutsService } from "./application/manage-platform-rollouts.service";
import { ManageAdminRuntimeProviderSettingsService } from "./application/manage-admin-runtime-provider-settings.service";
import { ManageAdminToolCredentialsService } from "./application/manage-admin-tool-credentials.service";
import { PlatformRuntimeProviderSecretStoreService } from "./application/platform-runtime-provider-secret-store.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./application/resolve-platform-runtime-provider-settings.service";
import { EnforceAbuseRateLimitService } from "./application/enforce-abuse-rate-limit.service";
import { ManageAdminAbuseControlsService } from "./application/manage-admin-abuse-controls.service";
import { ManageAdminAssistantOwnershipService } from "./application/manage-admin-assistant-ownership.service";
import { ManageAdminAssistantPlanOverrideService } from "./application/manage-admin-assistant-plan-override.service";
import { ManageAdminWorkspaceSubscriptionService } from "./application/manage-admin-workspace-subscription.service";
import { ApplyAssistantPublishedVersionService } from "./application/apply-assistant-published-version.service";
import { AssistantRuntimePreflightService } from "./application/assistant-runtime-preflight.service";
import { CreateAssistantService } from "./application/create-assistant.service";
import { DoNotRememberAssistantMemoryService } from "./application/do-not-remember-assistant-memory.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./application/enforce-assistant-capability-and-quota.service";
import { ForgetAssistantMemoryItemService } from "./application/forget-assistant-memory-item.service";
import { ListAssistantMemoryItemsService } from "./application/list-assistant-memory-items.service";
import { ListAssistantTaskItemsService } from "./application/list-assistant-task-items.service";
import { ListInternalAssistantTaskItemsService } from "./application/list-internal-assistant-task-items.service";
import { ControlInternalScheduledActionService } from "./application/control-internal-scheduled-action.service";
import { DisableAssistantTaskRegistryItemService } from "./application/disable-assistant-task-registry-item.service";
import { EnableAssistantTaskRegistryItemService } from "./application/enable-assistant-task-registry-item.service";
import { CancelAssistantTaskRegistryItemService } from "./application/cancel-assistant-task-registry-item.service";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { MaterializeAssistantPublishedVersionService } from "./application/materialize-assistant-published-version.service";
import { ManageAdminPlansService } from "./application/manage-admin-plans.service";
import { ManageWebChatListService } from "./application/manage-web-chat-list.service";
import { CompactNativeWebChatSessionService } from "./application/compact-native-web-chat-session.service";
import { ResolveNativeWebChatSessionStateService } from "./application/resolve-native-web-chat-session-state.service";
import { PublishAssistantDraftService } from "./application/publish-assistant-draft.service";
import { RecordWebChatMemoryTurnService } from "./application/record-web-chat-memory-turn.service";
import { ReapplyAssistantService } from "./application/reapply-assistant.service";
import { ResetAssistantService } from "./application/reset-assistant.service";
import { RollbackAssistantService } from "./application/rollback-assistant.service";
import { PreviewAssistantSetupService } from "./application/preview-assistant-setup.service";
import { SendNativeTelegramTurnService } from "./application/send-native-telegram-turn.service";
import { SendNativeWebChatTurnService } from "./application/send-native-web-chat-turn.service";
import { RunScheduledAssistantActionService } from "./application/run-scheduled-assistant-action.service";
import { SendWebChatTurnService } from "./application/send-web-chat-turn.service";
import { StreamNativeWebChatTurnService } from "./application/stream-native-web-chat-turn.service";
import { StreamWebChatTurnService } from "./application/stream-web-chat-turn.service";
import { WebRuntimeShadowComparisonService } from "./application/web-runtime-shadow-comparison.service";
import { PrepareAssistantInboundTurnService } from "./application/prepare-assistant-inbound-turn.service";
import { MergeStagedWebChatAttachmentsService } from "./application/merge-staged-web-chat-attachments.service";
import { HandleInternalCronFireService } from "./application/handle-internal-cron-fire.service";
import { DeliverReminderNotificationService } from "./application/deliver-reminder-notification.service";
import { BuildReminderContextSnapshotService } from "./application/build-reminder-context-snapshot.service";
import { PersaiScheduledActionSchedulerService } from "./application/persai-scheduled-action-scheduler.service";
import { HandleInternalTelegramTurnService } from "./application/handle-internal-telegram-turn.service";
import { CheckInternalRuntimeToolDailyLimitService } from "./application/check-internal-runtime-tool-daily-limit.service";
import { ConsumeInternalRuntimeToolDailyLimitService } from "./application/consume-internal-runtime-tool-daily-limit.service";
import { ResolveAssistantInboundRuntimeContextService } from "./application/resolve-assistant-inbound-runtime-context.service";
import { ResolveAssistantRuntimeTierService } from "./application/resolve-assistant-runtime-tier.service";
import { RenderAssistantInboundSurfaceMessageService } from "./application/render-assistant-inbound-surface-message.service";
import { SyncAssistantTaskRegistryService } from "./application/sync-assistant-task-registry.service";
import { SyncTelegramChatTargetService } from "./application/sync-telegram-chat-target.service";
import { SyncTelegramGroupMembershipService } from "./application/sync-telegram-group-membership.service";
import { TrackWorkspaceQuotaUsageService } from "./application/track-workspace-quota-usage.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./application/resolve-internal-runtime-tool-daily-policy.service";
import { SyncWorkspaceSubscriptionService } from "./application/sync-workspace-subscription.service";
import { UpdateAssistantDraftService } from "./application/update-assistant-draft.service";
import { ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY } from "./domain/assistant-chat-message-attachment.repository";
import { ASSISTANT_CHAT_REPOSITORY } from "./domain/assistant-chat.repository";
import { ASSISTANT_ABUSE_GUARD_REPOSITORY } from "./domain/assistant-abuse-guard.repository";
import { ASSISTANT_PLAN_CATALOG_REPOSITORY } from "./domain/assistant-plan-catalog.repository";
import { TOOL_CATALOG_REPOSITORY } from "./domain/tool-catalog.repository";
import { WORKSPACE_SUBSCRIPTION_REPOSITORY } from "./domain/workspace-subscription.repository";
import { WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY } from "./domain/workspace-quota-accounting.repository";
import { WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY } from "./domain/workspace-tool-daily-usage.repository";
import { PrismaWorkspaceToolDailyUsageRepository } from "./infrastructure/persistence/prisma-workspace-tool-daily-usage.repository";
import { ASSISTANT_MEMORY_REGISTRY_REPOSITORY } from "./domain/assistant-memory-registry.repository";
import { ASSISTANT_TASK_REGISTRY_REPOSITORY } from "./domain/assistant-task-registry.repository";
import { ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY } from "./domain/assistant-channel-surface-binding.repository";
import { ASSISTANT_GOVERNANCE_REPOSITORY } from "./domain/assistant-governance.repository";
import { ASSISTANT_MATERIALIZED_SPEC_REPOSITORY } from "./domain/assistant-materialized-spec.repository";
import { ASSISTANT_PUBLISHED_VERSION_REPOSITORY } from "./domain/assistant-published-version.repository";
import { OPENCLAW_RUNTIME_BRIDGE } from "./application/assistant-runtime-adapter.types";
import { ASSISTANT_RUNTIME_FACADE } from "./application/assistant-runtime.facade";
import { OpenClawAssistantRuntimeFacade } from "./application/openclaw-assistant-runtime.facade";
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { OpenClawRuntimeAdapter } from "./infrastructure/openclaw/openclaw-runtime.adapter";
import { NullBillingProviderAdapter } from "./infrastructure/billing/null-billing-provider.adapter";
import { PrismaAssistantGovernanceRepository } from "./infrastructure/persistence/prisma-assistant-governance.repository";
import { PrismaAssistantPlanCatalogRepository } from "./infrastructure/persistence/prisma-assistant-plan-catalog.repository";
import { PrismaToolCatalogRepository } from "./infrastructure/persistence/prisma-tool-catalog.repository";
import { PrismaWorkspaceSubscriptionRepository } from "./infrastructure/persistence/prisma-workspace-subscription.repository";
import { PrismaWorkspaceQuotaAccountingRepository } from "./infrastructure/persistence/prisma-workspace-quota-accounting.repository";
import { BILLING_PROVIDER_PORT } from "./application/billing-provider.port";
import { PrismaAssistantChatMessageAttachmentRepository } from "./infrastructure/persistence/prisma-assistant-chat-message-attachment.repository";
import { PrismaAssistantChatRepository } from "./infrastructure/persistence/prisma-assistant-chat.repository";
import { PrismaAssistantAbuseGuardRepository } from "./infrastructure/persistence/prisma-assistant-abuse-guard.repository";
import { PrismaAssistantMemoryRegistryRepository } from "./infrastructure/persistence/prisma-assistant-memory-registry.repository";
import { PrismaAssistantTaskRegistryRepository } from "./infrastructure/persistence/prisma-assistant-task-registry.repository";
import { BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY } from "./domain/bootstrap-document-preset.repository";
import { PrismaBootstrapDocumentPresetRepository } from "./infrastructure/persistence/prisma-bootstrap-document-preset.repository";
import { ManageBootstrapPresetsService } from "./application/manage-bootstrap-presets.service";
import { SeedToolCatalogService } from "./application/seed-tool-catalog.service";
import { BumpConfigGenerationService } from "./application/bump-config-generation.service";
import { ForceReapplyAllService } from "./application/force-reapply-all.service";
import { SyncNativeRuntimeBundleService } from "./application/sync-native-runtime-bundle.service";
import { SyncProviderGatewayWarmupService } from "./application/sync-provider-gateway-warmup.service";
import { AdminForceReapplyController } from "./interface/http/admin-force-reapply.controller";
import { MediaAttachmentController } from "./interface/http/media-attachment.controller";
import { TelegramWebhookController } from "./interface/http/telegram-webhook-proxy.controller";
import { ManageChatMediaService } from "./application/manage-chat-media.service";
import { MediaPreprocessorService } from "./application/media/media-preprocessor.service";
import { NativeMediaTranscriptionService } from "./application/media/native-media-transcription.service";
import { InboundMediaService } from "./application/media/inbound-media.service";
import { MediaDeliveryService } from "./application/media/media-delivery.service";
import { PersaiMediaObjectStorageService } from "./application/media/persai-media-object-storage.service";
import { CHANNEL_MEDIA_ADAPTERS } from "./application/media/channel-adapters/channel-media-adapter.interface";
import { WebMediaAdapter } from "./application/media/channel-adapters/web-media.adapter";
import { TelegramMediaAdapter } from "./application/media/channel-adapters/telegram-media.adapter";
import { PrismaAssistantChannelSurfaceBindingRepository } from "./infrastructure/persistence/prisma-assistant-channel-surface-binding.repository";
import { PrismaAssistantMaterializedSpecRepository } from "./infrastructure/persistence/prisma-assistant-materialized-spec.repository";
import { PrismaAssistantPublishedVersionRepository } from "./infrastructure/persistence/prisma-assistant-published-version.repository";
import { PrismaAssistantRepository } from "./infrastructure/persistence/prisma-assistant.repository";
import { WorkspaceManagementPrismaService } from "./infrastructure/persistence/workspace-management-prisma.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./application/resolve-telegram-channel-runtime-config.service";
import { TelegramBotClientService } from "./application/telegram-bot.client.service";
import { TelegramChannelAdapterService } from "./application/telegram-channel-adapter.service";

@Module({
  imports: [IdentityAccessModule, PlatformCoreModule],
  controllers: [
    AssistantController,
    AdminPlansController,
    AdminSecurityController,
    AdminAbuseControlsController,
    AdminAssistantOwnershipController,
    AdminOpsController,
    AdminBusinessController,
    AdminOverviewDashboardController,
    AdminNotificationsController,
    AdminPlatformRolloutsController,
    AdminRuntimeProviderSettingsController,
    AdminToolCredentialsController,
    AdminBootstrapPresetsController,
    InternalCronFireController,
    InternalRuntimeProviderSecretsController,
    InternalRuntimeConfigGenerationController,
    InternalRuntimeTaskRegistryController,
    InternalRuntimeToolQuotaController,
    AdminForceReapplyController,
    MediaAttachmentController,
    TelegramWebhookController
  ],
  providers: [
    {
      provide: WorkspaceManagementPrismaService,
      useExisting: PrismaService
    },
    AppendAssistantAuditEventService,
    AdminAuthorizationService,
    ResolveAdminOpsCockpitService,
    AdminOpsUserDirectoryService,
    AdminDeleteUserService,
    ResolveAdminBusinessCockpitService,
    ResolveAdminBusinessPlatformService,
    ResolveAdminOverviewDashboardService,
    OverviewLatencyTraceService,
    ManageAdminOverviewLatencyTraceService,
    ManageAdminNotificationChannelsService,
    DeliverAdminSystemNotificationService,
    ManagePlatformRolloutsService,
    ManageAdminRuntimeProviderSettingsService,
    ManageAdminToolCredentialsService,
    PlatformRuntimeProviderSecretStoreService,
    ResolvePlatformRuntimeProviderSettingsService,
    EnforceAbuseRateLimitService,
    ManageAdminAbuseControlsService,
    ManageAdminAssistantOwnershipService,
    ManageAdminAssistantPlanOverrideService,
    ManageAdminWorkspaceSubscriptionService,
    HandleInternalCronFireService,
    DeliverReminderNotificationService,
    BuildReminderContextSnapshotService,
    PersaiScheduledActionSchedulerService,
    RunScheduledAssistantActionService,
    HandleInternalTelegramTurnService,
    ResolveInternalRuntimeToolDailyPolicyService,
    ConsumeInternalRuntimeToolDailyLimitService,
    CheckInternalRuntimeToolDailyLimitService,
    ResolveAssistantInboundRuntimeContextService,
    ResolveAssistantRuntimeTierService,
    RenderAssistantInboundSurfaceMessageService,
    GetAssistantByUserIdService,
    ApplyAssistantPublishedVersionService,
    AssistantRuntimePreflightService,
    MaterializeAssistantPublishedVersionService,
    ManageAdminPlansService,
    ResolveEffectiveSubscriptionStateService,
    ResolveEffectiveCapabilityStateService,
    ResolveEffectiveToolAvailabilityService,
    ResolveOpenClawChannelSurfaceBindingsService,
    ResolveRuntimeProviderRoutingService,
    ResolveOpenClawCapabilityEnvelopeService,
    ResolveTelegramIntegrationStateService,
    ResolveAssistantNotificationPreferenceService,
    ConnectTelegramIntegrationService,
    UpdateTelegramIntegrationConfigService,
    UpdateAssistantNotificationPreferenceService,
    RevokeTelegramIntegrationSecretService,
    ResendTelegramOwnerMessageService,
    ResolvePlanVisibilityService,
    EnforceAssistantCapabilityAndQuotaService,
    TrackWorkspaceQuotaUsageService,
    SyncWorkspaceSubscriptionService,
    CompactNativeWebChatSessionService,
    ResolveNativeWebChatSessionStateService,
    ManageWebChatListService,
    CreateAssistantService,
    PublishAssistantDraftService,
    ReapplyAssistantService,
    RollbackAssistantService,
    ResetAssistantService,
    PreviewAssistantSetupService,
    RecordWebChatMemoryTurnService,
    SendNativeTelegramTurnService,
    SendNativeWebChatTurnService,
    StreamNativeWebChatTurnService,
    WebRuntimeShadowComparisonService,
    ListAssistantMemoryItemsService,
    ForgetAssistantMemoryItemService,
    DoNotRememberAssistantMemoryService,
    ListAssistantTaskItemsService,
    ListInternalAssistantTaskItemsService,
    ControlInternalScheduledActionService,
    DisableAssistantTaskRegistryItemService,
    EnableAssistantTaskRegistryItemService,
    CancelAssistantTaskRegistryItemService,
    SyncAssistantTaskRegistryService,
    SyncTelegramChatTargetService,
    SyncTelegramGroupMembershipService,
    MergeStagedWebChatAttachmentsService,
    PrepareAssistantInboundTurnService,
    SendWebChatTurnService,
    StreamWebChatTurnService,
    UpdateAssistantDraftService,
    ResolveTelegramChannelRuntimeConfigService,
    TelegramBotClientService,
    TelegramChannelAdapterService,
    {
      provide: ASSISTANT_REPOSITORY,
      useClass: PrismaAssistantRepository
    },
    {
      provide: ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
      useClass: PrismaAssistantPublishedVersionRepository
    },
    {
      provide: ASSISTANT_PLAN_CATALOG_REPOSITORY,
      useClass: PrismaAssistantPlanCatalogRepository
    },
    {
      provide: TOOL_CATALOG_REPOSITORY,
      useClass: PrismaToolCatalogRepository
    },
    {
      provide: WORKSPACE_SUBSCRIPTION_REPOSITORY,
      useClass: PrismaWorkspaceSubscriptionRepository
    },
    {
      provide: WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY,
      useClass: PrismaWorkspaceQuotaAccountingRepository
    },
    {
      provide: WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY,
      useClass: PrismaWorkspaceToolDailyUsageRepository
    },
    {
      provide: BILLING_PROVIDER_PORT,
      useClass: NullBillingProviderAdapter
    },
    {
      provide: ASSISTANT_GOVERNANCE_REPOSITORY,
      useClass: PrismaAssistantGovernanceRepository
    },
    {
      provide: ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
      useClass: PrismaAssistantChatMessageAttachmentRepository
    },
    {
      provide: ASSISTANT_CHAT_REPOSITORY,
      useClass: PrismaAssistantChatRepository
    },
    {
      provide: ASSISTANT_ABUSE_GUARD_REPOSITORY,
      useClass: PrismaAssistantAbuseGuardRepository
    },
    {
      provide: ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
      useClass: PrismaAssistantMemoryRegistryRepository
    },
    {
      provide: ASSISTANT_TASK_REGISTRY_REPOSITORY,
      useClass: PrismaAssistantTaskRegistryRepository
    },
    {
      provide: ASSISTANT_CHANNEL_SURFACE_BINDING_REPOSITORY,
      useClass: PrismaAssistantChannelSurfaceBindingRepository
    },
    OpenClawRuntimeAdapter,
    {
      provide: OPENCLAW_RUNTIME_BRIDGE,
      useExisting: OpenClawRuntimeAdapter
    },
    OpenClawAssistantRuntimeFacade,
    {
      provide: ASSISTANT_RUNTIME_FACADE,
      useExisting: OpenClawAssistantRuntimeFacade
    },
    {
      provide: ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
      useClass: PrismaAssistantMaterializedSpecRepository
    },
    {
      provide: BOOTSTRAP_DOCUMENT_PRESET_REPOSITORY,
      useClass: PrismaBootstrapDocumentPresetRepository
    },
    ManageChatMediaService,
    MediaPreprocessorService,
    NativeMediaTranscriptionService,
    PersaiMediaObjectStorageService,
    InboundMediaService,
    MediaDeliveryService,
    WebMediaAdapter,
    TelegramMediaAdapter,
    {
      provide: CHANNEL_MEDIA_ADAPTERS,
      useFactory: (web: WebMediaAdapter, telegram: TelegramMediaAdapter) => [web, telegram],
      inject: [WebMediaAdapter, TelegramMediaAdapter]
    },
    ManageBootstrapPresetsService,
    SeedToolCatalogService,
    BumpConfigGenerationService,
    ForceReapplyAllService,
    SyncNativeRuntimeBundleService,
    SyncProviderGatewayWarmupService
  ],
  exports: [
    GetAssistantByUserIdService,
    ApplyAssistantPublishedVersionService,
    AssistantRuntimePreflightService,
    CreateAssistantService,
    PublishAssistantDraftService,
    ReapplyAssistantService,
    RollbackAssistantService,
    ResetAssistantService,
    PreviewAssistantSetupService,
    SendWebChatTurnService,
    StreamWebChatTurnService,
    UpdateAssistantDraftService,
    ASSISTANT_REPOSITORY,
    ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
    ASSISTANT_GOVERNANCE_REPOSITORY,
    ASSISTANT_CHAT_REPOSITORY,
    ASSISTANT_MATERIALIZED_SPEC_REPOSITORY
  ]
})
export class WorkspaceManagementModule {}
