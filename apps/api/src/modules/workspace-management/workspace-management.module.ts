import { Module } from "@nestjs/common";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { PlatformCoreModule } from "../platform-core/platform-core.module";
import { PrismaService } from "../identity-access/infrastructure/persistence/prisma.service";
import { AppBootstrapController } from "./interface/http/app-bootstrap.controller";
import { AssistantController } from "./interface/http/assistant.controller";
import { AdminPlansController } from "./interface/http/admin-plans.controller";
import { PublicPricingPlansController } from "./interface/http/public-pricing-plans.controller";
import { AdminBillingLifecycleSettingsController } from "./interface/http/admin-billing-lifecycle-settings.controller";
import { AdminSecurityController } from "./interface/http/admin-security.controller";
import { AdminAbuseControlsController } from "./interface/http/admin-abuse-controls.controller";
import { AdminAssistantOwnershipController } from "./interface/http/admin-assistant-ownership.controller";
import { AdminOpsController } from "./interface/http/admin-ops.controller";
import { AdminBusinessController } from "./interface/http/admin-business.controller";
import { AdminOverviewDashboardController } from "./interface/http/admin-overview-dashboard.controller";
import { AdminNotificationsController } from "./interface/http/admin-notifications.controller";
import { AdminPlatformRolloutsController } from "./interface/http/admin-platform-rollouts.controller";
import { AdminRuntimeProviderSettingsController } from "./interface/http/admin-runtime-provider-settings.controller";
import { AdminDocumentProcessingSettingsController } from "./interface/http/admin-document-processing-settings.controller";
import { AdminBillingProviderCredentialsController } from "./interface/http/admin-billing-provider-credentials.controller";
import { AdminToolCredentialsController } from "./interface/http/admin-tool-credentials.controller";
import { AdminPromptTemplatesController } from "./interface/http/admin-bootstrap-presets.controller";
import { AdminPersonaArchetypesController } from "./interface/http/admin-persona-archetypes.controller";
import { AdminToolMetadataController } from "./interface/http/admin-tool-metadata.controller";
import { AdminKnowledgeSourcesController } from "./interface/http/admin-knowledge-sources.controller";
import { AdminSkillsController } from "./interface/http/admin-skills.controller";
import { AssistantKnowledgeSourcesController } from "./interface/http/assistant-knowledge-sources.controller";
import { AssistantBillingController } from "./interface/http/assistant-billing.controller";
import { AssistantSkillsController } from "./interface/http/assistant-skills.controller";
import { CloudpaymentsWebhookController } from "./interface/http/cloudpayments-webhook.controller";
import { KnowledgeIndexingJobsController } from "./interface/http/knowledge-indexing-jobs.controller";
import { InternalCronFireController } from "./interface/http/internal-cron-fire.controller";
import { InternalRuntimeProviderSecretsController } from "./interface/http/internal-runtime-provider-secrets.controller";
import { InternalRuntimeConfigGenerationController } from "./interface/http/internal-runtime-config-generation.controller";
import { InternalRuntimeKnowledgeController } from "./interface/http/internal-runtime-knowledge.controller";
import { InternalRuntimeOrchestratedRetrievalController } from "./interface/http/internal-runtime-orchestrated-retrieval.controller";
import { InternalRuntimeMemoryController } from "./interface/http/internal-runtime-memory.controller";
import { InternalRuntimeCompactionEnqueueController } from "./interface/http/internal-runtime-compaction-enqueue.controller";
import { InternalRuntimeMediaJobsEnqueueController } from "./interface/http/internal-runtime-media-jobs-enqueue.controller";
import { InternalRuntimeMemoryHydrationController } from "./interface/http/internal-runtime-memory-hydration.controller";
import { InternalRuntimeMemoryCloseMostSimilarController } from "./interface/http/internal-runtime-memory-close-most-similar.controller";
import { InternalRuntimeMemoryCloseByRefController } from "./interface/http/internal-runtime-memory-close-by-ref.controller";
import { InternalRuntimeCrossSessionCarryOverController } from "./interface/http/internal-runtime-cross-session-carry-over.controller";
import { InternalRuntimeCrossSessionMarkFiredController } from "./interface/http/internal-runtime-cross-session-mark-fired.controller";
import { InternalRuntimeTaskRegistryController } from "./interface/http/internal-runtime-task-registry.controller";
import { InternalRuntimeBackgroundTasksController } from "./interface/http/internal-runtime-background-tasks.controller";
import { InternalRuntimeToolQuotaController } from "./interface/http/internal-runtime-tool-quota.controller";
import { InternalSmokeReceiptsController } from "./interface/http/internal-smoke-receipts.controller";
import { ResolveEffectiveSubscriptionStateService } from "./application/resolve-effective-subscription-state.service";
import { ResolveEffectiveCapabilityStateService } from "./application/resolve-effective-capability-state.service";
import { ResolveEffectiveToolAvailabilityService } from "./application/resolve-effective-tool-availability.service";
import { ResolveAssistantChannelSurfaceBindingsService } from "./application/resolve-assistant-channel-surface-bindings.service";
import { ResolveAssistantCapabilityEnvelopeService } from "./application/resolve-assistant-capability-envelope.service";
import { ResolveRuntimeProviderRoutingService } from "./application/resolve-runtime-provider-routing.service";
import { ResolveTelegramIntegrationStateService } from "./application/resolve-telegram-integration-state.service";
import { ResolveAssistantNotificationPreferenceService } from "./application/resolve-assistant-notification-preference.service";
import { ResolveAssistantVoiceSettingsService } from "./application/resolve-assistant-voice-settings.service";
import { ConnectTelegramIntegrationService } from "./application/connect-telegram-integration.service";
import { UpdateTelegramIntegrationConfigService } from "./application/update-telegram-integration-config.service";
import { UpdateAssistantNotificationPreferenceService } from "./application/update-assistant-notification-preference.service";
import { AutoSelectNotificationChannelOnBindService } from "./application/auto-select-notification-channel-on-bind.service";
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
import { ReadSmokeTurnReceiptsService } from "./application/read-smoke-turn-receipts.service";
import { ResolveAdminOverviewDashboardService } from "./application/resolve-admin-overview-dashboard.service";
import { ResolveExecutionWorkloadOverviewService } from "./application/resolve-execution-workload-overview.service";
import { ResolveAdminKnowledgeObservabilityService } from "./application/resolve-admin-knowledge-observability.service";
import { ResolveAdminKnowledgeConnectorsService } from "./application/resolve-admin-knowledge-connectors.service";
import { OverviewLatencyTraceService } from "./application/overview-latency-trace.service";
import { ManageAdminOverviewLatencyTraceService } from "./application/manage-admin-overview-latency-trace.service";
import { ManageAdminNotificationChannelsService } from "./application/manage-admin-notification-channels.service";
import { DeliverAdminSystemNotificationService } from "./application/deliver-admin-system-notification.service";
import { ManagePlatformRolloutsService } from "./application/manage-platform-rollouts.service";
import { ManageAdminRuntimeProviderSettingsService } from "./application/manage-admin-runtime-provider-settings.service";
import { ManageAdminDocumentProcessingSettingsService } from "./application/manage-admin-document-processing-settings.service";
import { ManageAdminBillingProviderCredentialsService } from "./application/manage-admin-billing-provider-credentials.service";
import { ManageAdminToolCredentialsService } from "./application/manage-admin-tool-credentials.service";
import { ManageAdminToolPromptMetadataService } from "./application/manage-admin-tool-prompt-metadata.service";
import { ManageAdminKnowledgeSourcesService } from "./application/manage-admin-knowledge-sources.service";
import { ManageAdminSkillsService } from "./application/manage-admin-skills.service";
import { GenerateSkillAuthoringDraftService } from "./application/generate-skill-authoring-draft.service";
import { ManageAdminKnowledgeRetrievalPolicyService } from "./application/manage-admin-knowledge-retrieval-policy.service";
import { ListKnowledgeIndexingJobsService } from "./application/list-knowledge-indexing-jobs.service";
import { KnowledgeDocumentProcessorService } from "./application/knowledge-document-processor.service";
import { KnowledgeEmbeddingService } from "./application/knowledge-embedding.service";
import { KnowledgeIndexingService } from "./application/knowledge-indexing.service";
import { KnowledgeIndexingJobWorkerService } from "./application/knowledge-indexing-job-worker.service";
import { KnowledgeModelPolicyService } from "./application/knowledge-model-policy.service";
import { KnowledgeRetrievalObservabilityService } from "./application/knowledge-retrieval-observability.service";
import { KnowledgeRetrievalHelperService } from "./application/knowledge-retrieval-helper.service";
import {
  KNOWLEDGE_VECTOR_INDEX,
  PostgresPgvectorKnowledgeIndex
} from "./application/knowledge-vector-index";
import { PlatformRuntimeProviderSecretStoreService } from "./application/platform-runtime-provider-secret-store.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./application/resolve-platform-runtime-provider-settings.service";
import { EnforceAbuseRateLimitService } from "./application/enforce-abuse-rate-limit.service";
import { ManageAdminAbuseControlsService } from "./application/manage-admin-abuse-controls.service";
import { ManageAdminAssistantOwnershipService } from "./application/manage-admin-assistant-ownership.service";
import { ManageAdminAssistantPlanOverrideService } from "./application/manage-admin-assistant-plan-override.service";
import { ManageAdminWorkspaceSubscriptionService } from "./application/manage-admin-workspace-subscription.service";
import { ManageAdminOpsBillingSupportService } from "./application/manage-admin-ops-billing-support.service";
import { ManageAdminBillingLifecycleSettingsService } from "./application/manage-admin-billing-lifecycle-settings.service";
import { ManageAssistantBillingSubscriptionService } from "./application/manage-assistant-billing-subscription.service";
import { ManageAssistantPaymentIntentsService } from "./application/manage-assistant-payment-intents.service";
import { HandleCloudpaymentsWebhookService } from "./application/handle-cloudpayments-webhook.service";
import { ManageWorkspaceSubscriptionLifecycleService } from "./application/manage-workspace-subscription-lifecycle.service";
import { MaterializeWorkspacePaidActivationService } from "./application/materialize-workspace-paid-activation.service";
import { ApplyWorkspaceSubscriptionBillingEventService } from "./application/apply-workspace-subscription-billing-event.service";
import { ScheduleBillingLifecycleNotificationsService } from "./application/schedule-billing-lifecycle-notifications.service";
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
import { ListInternalBackgroundTaskItemsService } from "./application/list-internal-background-task-items.service";
import { ControlInternalBackgroundTaskService } from "./application/control-internal-background-task.service";
import { ListAssistantBackgroundTaskItemsService } from "./application/list-assistant-background-task-items.service";
import { ControlAssistantBackgroundTaskService } from "./application/control-assistant-background-task.service";
import { DisableAssistantTaskRegistryItemService } from "./application/disable-assistant-task-registry-item.service";
import { EnableAssistantTaskRegistryItemService } from "./application/enable-assistant-task-registry-item.service";
import { CancelAssistantTaskRegistryItemService } from "./application/cancel-assistant-task-registry-item.service";
import { GetAssistantAppBootstrapService } from "./application/get-assistant-app-bootstrap.service";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { ManageAssistantKnowledgeSourcesService } from "./application/manage-assistant-knowledge-sources.service";
import { ManageAssistantSkillsService } from "./application/manage-assistant-skills.service";
import { ManageAssistantAvatarService } from "./application/manage-assistant-avatar.service";
import { ManageAssistantWorkspaceMemoryService } from "./application/manage-assistant-workspace-memory.service";
import { ReadAssistantKnowledgeService } from "./application/read-assistant-knowledge.service";
import { OrchestrateRuntimeRetrievalService } from "./application/orchestrate-runtime-retrieval.service";
import { SkillRetrievalPolicyService } from "./application/skill-retrieval-policy.service";
import { SkillRetrievalStateService } from "./application/skill-retrieval-state.service";
import { AutoSkillRoutingStateService } from "./application/auto-skill-routing-state.service";
import { WriteAssistantMemoryService } from "./application/write-assistant-memory.service";
import { HydrateMemoryForTurnService } from "./application/hydrate-memory-for-turn.service";
import { CloseMostSimilarOpenLoopService } from "./application/close-most-similar-open-loop.service";
import { CloseAssistantMemoryByRefService } from "./application/close-assistant-memory-by-ref.service";
import { FindCrossSessionCarryOverService } from "./application/find-cross-session-carry-over.service";
import { MarkCrossSessionCarryOverFiredService } from "./application/mark-cross-session-carry-over-fired.service";
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
import { SendWebChatTurnService } from "./application/send-web-chat-turn.service";
import { StreamNativeWebChatTurnService } from "./application/stream-native-web-chat-turn.service";
import { StreamWebChatTurnService } from "./application/stream-web-chat-turn.service";
import { AssistantMediaJobCompletionTurnService } from "./application/assistant-media-job-completion-turn.service";
import { AssistantMediaJobCompletionDeliveryService } from "./application/assistant-media-job-completion-delivery.service";
import { AssistantMediaJobSchedulerService } from "./application/assistant-media-job-scheduler.service";
import { AssistantMediaJobService } from "./application/assistant-media-job.service";
import { EnqueueRuntimeDeferredMediaJobService } from "./application/enqueue-runtime-deferred-media-job.service";
import { InternalRuntimeMediaJobClientService } from "./application/internal-runtime-media-job.client.service";
import { WebChatTurnAttemptService } from "./application/web-chat-turn-attempt.service";
import { WebChatTurnHardStopRegistry } from "./application/web-chat-turn-hard-stop-registry.service";
import { WebChatTurnStreamRegistry } from "./application/web-chat-turn-stream-registry.service";
import { WebRuntimeShadowComparisonService } from "./application/web-runtime-shadow-comparison.service";
import { PrepareAssistantInboundTurnService } from "./application/prepare-assistant-inbound-turn.service";
import { MergeStagedWebChatAttachmentsService } from "./application/merge-staged-web-chat-attachments.service";
import { HandleInternalCronFireService } from "./application/handle-internal-cron-fire.service";
import { AssistantNotificationDeliveryService } from "./application/assistant-notification-delivery.service";
import { AssistantNotificationOutboxSchedulerService } from "./application/assistant-notification-outbox-scheduler.service";
import { AssistantNotificationOutboxService } from "./application/assistant-notification-outbox.service";
import { BuildReminderContextSnapshotService } from "./application/build-reminder-context-snapshot.service";
import { PersaiScheduledActionSchedulerService } from "./application/persai-scheduled-action-scheduler.service";
import { PersaiBackgroundCompactionSchedulerService } from "./application/persai-background-compaction-scheduler.service";
import { ProactivePushPolicyService } from "./application/proactive-push-policy.service";
import { EnqueueBackgroundCompactionJobService } from "./application/enqueue-background-compaction-job.service";
import { InternalRuntimeCompactionClientService } from "./application/internal-runtime-compaction.client.service";
import { InternalRuntimeBackgroundTaskClientService } from "./application/internal-runtime-background-task.client.service";
import { PersaiBackgroundTaskSchedulerService } from "./application/persai-background-task-scheduler.service";
import { PersaiIdleReengagementSchedulerService } from "./application/persai-idle-reengagement-scheduler.service";
import { HandleInternalTelegramTurnService } from "./application/handle-internal-telegram-turn.service";
import { ConsumeInternalRuntimeToolDailyLimitService } from "./application/consume-internal-runtime-tool-daily-limit.service";
import { MutateInternalRuntimeMonthlyMediaQuotaService } from "./application/mutate-internal-runtime-monthly-media-quota.service";
import { ReserveInternalRuntimeMonthlyMediaQuotaService } from "./application/reserve-internal-runtime-monthly-media-quota.service";
import { ReadInternalRuntimeQuotaStatusService } from "./application/read-internal-runtime-quota-status.service";
import { CreateInternalRuntimeQuotaCheckoutService } from "./application/create-internal-runtime-quota-checkout.service";
import { ResolveAssistantInboundRuntimeContextService } from "./application/resolve-assistant-inbound-runtime-context.service";
import { ResolveAssistantRuntimeTierService } from "./application/resolve-assistant-runtime-tier.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./application/ensure-assistant-materialized-spec-current.service";
import { RenderAssistantInboundSurfaceMessageService } from "./application/render-assistant-inbound-surface-message.service";
import { SyncAssistantTaskRegistryService } from "./application/sync-assistant-task-registry.service";
import { SyncTelegramChatTargetService } from "./application/sync-telegram-chat-target.service";
import { SyncTelegramGroupMembershipService } from "./application/sync-telegram-group-membership.service";
import { TrackWorkspaceQuotaUsageService } from "./application/track-workspace-quota-usage.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./application/resolve-internal-runtime-tool-daily-policy.service";
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
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { CloudpaymentsConstructorBillingProviderAdapter } from "./infrastructure/billing/cloudpayments-constructor-billing-provider.adapter";
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
import { PROMPT_TEMPLATE_REPOSITORY } from "./domain/bootstrap-document-preset.repository";
import { PrismaPromptTemplateRepository } from "./infrastructure/persistence/prisma-bootstrap-document-preset.repository";
import { ManagePromptTemplatesService } from "./application/manage-bootstrap-presets.service";
import { PERSONA_ARCHETYPE_REPOSITORY } from "./domain/persona-archetype.repository";
import { PrismaPersonaArchetypeRepository } from "./infrastructure/persistence/prisma-persona-archetype.repository";
import { ManagePersonaArchetypesService } from "./application/manage-persona-archetypes.service";
import { SeedToolCatalogService } from "./application/seed-tool-catalog.service";
import { BumpConfigGenerationService } from "./application/bump-config-generation.service";
import { ForceReapplyAllService } from "./application/force-reapply-all.service";
import { SyncNativeRuntimeBundleService } from "./application/sync-native-runtime-bundle.service";
import { SyncProviderGatewayWarmupService } from "./application/sync-provider-gateway-warmup.service";
import { CompilePromptConstructorService } from "./application/compile-prompt-constructor.service";
import { AdminForceReapplyController } from "./interface/http/admin-force-reapply.controller";
import { MediaAttachmentController } from "./interface/http/media-attachment.controller";
import { TelegramWebhookController } from "./interface/http/telegram-webhook-proxy.controller";
import { ManageChatMediaService } from "./application/manage-chat-media.service";
import { AssistantFileRegistryService } from "./application/assistant-file-registry.service";
import { MediaPreprocessorService } from "./application/media/media-preprocessor.service";
import { NativeMediaTranscriptionService } from "./application/media/native-media-transcription.service";
import { ProviderGatewayPdfTextExtractionService } from "./application/media/provider-gateway-pdf-text-extraction.service";
import { InboundMediaService } from "./application/media/inbound-media.service";
import { MediaDeliveryService } from "./application/media/media-delivery.service";
import { AttachmentObjectAvailabilityService } from "./application/media/attachment-object-availability.service";
import { PersaiMediaObjectStorageService } from "./application/media/persai-media-object-storage.service";
import { PersaiKnowledgeObjectStorageService } from "./application/persai-knowledge-object-storage.service";
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
    AppBootstrapController,
    AssistantController,
    AssistantBillingController,
    AssistantKnowledgeSourcesController,
    AdminPlansController,
    PublicPricingPlansController,
    AdminBillingLifecycleSettingsController,
    AdminSecurityController,
    AdminAbuseControlsController,
    AdminAssistantOwnershipController,
    AdminOpsController,
    AdminBusinessController,
    AdminOverviewDashboardController,
    AdminNotificationsController,
    AdminPlatformRolloutsController,
    AdminRuntimeProviderSettingsController,
    AdminDocumentProcessingSettingsController,
    AdminBillingProviderCredentialsController,
    AdminToolCredentialsController,
    AdminToolMetadataController,
    AdminPromptTemplatesController,
    AdminPersonaArchetypesController,
    AdminKnowledgeSourcesController,
    AdminSkillsController,
    KnowledgeIndexingJobsController,
    AssistantSkillsController,
    CloudpaymentsWebhookController,
    InternalCronFireController,
    InternalRuntimeProviderSecretsController,
    InternalRuntimeConfigGenerationController,
    InternalRuntimeKnowledgeController,
    InternalRuntimeOrchestratedRetrievalController,
    InternalRuntimeMemoryController,
    InternalRuntimeMemoryHydrationController,
    InternalRuntimeMemoryCloseMostSimilarController,
    InternalRuntimeMemoryCloseByRefController,
    InternalRuntimeCrossSessionCarryOverController,
    InternalRuntimeCrossSessionMarkFiredController,
    InternalRuntimeCompactionEnqueueController,
    InternalRuntimeMediaJobsEnqueueController,
    InternalRuntimeTaskRegistryController,
    InternalRuntimeBackgroundTasksController,
    InternalRuntimeToolQuotaController,
    InternalSmokeReceiptsController,
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
    ReadSmokeTurnReceiptsService,
    ResolveAdminOverviewDashboardService,
    ResolveExecutionWorkloadOverviewService,
    ResolveAdminKnowledgeObservabilityService,
    ResolveAdminKnowledgeConnectorsService,
    OverviewLatencyTraceService,
    ManageAdminOverviewLatencyTraceService,
    ManageAdminNotificationChannelsService,
    DeliverAdminSystemNotificationService,
    ManagePlatformRolloutsService,
    ManageAdminRuntimeProviderSettingsService,
    ManageAdminDocumentProcessingSettingsService,
    ManageAdminBillingProviderCredentialsService,
    ManageAdminToolCredentialsService,
    ManageAdminToolPromptMetadataService,
    ManageAdminKnowledgeSourcesService,
    ManageAdminSkillsService,
    GenerateSkillAuthoringDraftService,
    ManageAdminKnowledgeRetrievalPolicyService,
    ListKnowledgeIndexingJobsService,
    KnowledgeDocumentProcessorService,
    KnowledgeEmbeddingService,
    KnowledgeIndexingService,
    KnowledgeIndexingJobWorkerService,
    KnowledgeModelPolicyService,
    KnowledgeRetrievalObservabilityService,
    KnowledgeRetrievalHelperService,
    PlatformRuntimeProviderSecretStoreService,
    ResolvePlatformRuntimeProviderSettingsService,
    EnforceAbuseRateLimitService,
    ManageAdminAbuseControlsService,
    ManageAdminAssistantOwnershipService,
    ManageAdminAssistantPlanOverrideService,
    ManageAdminWorkspaceSubscriptionService,
    ManageAdminOpsBillingSupportService,
    ManageAdminBillingLifecycleSettingsService,
    ManageAssistantPaymentIntentsService,
    HandleCloudpaymentsWebhookService,
    ManageWorkspaceSubscriptionLifecycleService,
    MaterializeWorkspacePaidActivationService,
    ApplyWorkspaceSubscriptionBillingEventService,
    ScheduleBillingLifecycleNotificationsService,
    HandleInternalCronFireService,
    AssistantNotificationDeliveryService,
    AssistantNotificationOutboxService,
    AssistantNotificationOutboxSchedulerService,
    BuildReminderContextSnapshotService,
    PersaiScheduledActionSchedulerService,
    PersaiBackgroundCompactionSchedulerService,
    PersaiBackgroundTaskSchedulerService,
    ProactivePushPolicyService,
    EnqueueBackgroundCompactionJobService,
    EnqueueRuntimeDeferredMediaJobService,
    InternalRuntimeCompactionClientService,
    InternalRuntimeBackgroundTaskClientService,
    PersaiIdleReengagementSchedulerService,
    HandleInternalTelegramTurnService,
    ResolveInternalRuntimeToolDailyPolicyService,
    ConsumeInternalRuntimeToolDailyLimitService,
    MutateInternalRuntimeMonthlyMediaQuotaService,
    ReserveInternalRuntimeMonthlyMediaQuotaService,
    ReadInternalRuntimeQuotaStatusService,
    CreateInternalRuntimeQuotaCheckoutService,
    ResolveAssistantInboundRuntimeContextService,
    ResolveAssistantRuntimeTierService,
    EnsureAssistantMaterializedSpecCurrentService,
    RenderAssistantInboundSurfaceMessageService,
    GetAssistantAppBootstrapService,
    GetAssistantByUserIdService,
    ManageAssistantAvatarService,
    ManageAssistantKnowledgeSourcesService,
    ManageAssistantSkillsService,
    ManageAssistantWorkspaceMemoryService,
    ReadAssistantKnowledgeService,
    OrchestrateRuntimeRetrievalService,
    SkillRetrievalPolicyService,
    SkillRetrievalStateService,
    AutoSkillRoutingStateService,
    WriteAssistantMemoryService,
    HydrateMemoryForTurnService,
    CloseMostSimilarOpenLoopService,
    CloseAssistantMemoryByRefService,
    FindCrossSessionCarryOverService,
    MarkCrossSessionCarryOverFiredService,
    ApplyAssistantPublishedVersionService,
    AssistantRuntimePreflightService,
    MaterializeAssistantPublishedVersionService,
    ManageAdminPlansService,
    ResolveEffectiveSubscriptionStateService,
    ResolveEffectiveCapabilityStateService,
    ResolveEffectiveToolAvailabilityService,
    ResolveAssistantChannelSurfaceBindingsService,
    ResolveRuntimeProviderRoutingService,
    ResolveAssistantCapabilityEnvelopeService,
    ResolveTelegramIntegrationStateService,
    ResolveAssistantNotificationPreferenceService,
    ResolveAssistantVoiceSettingsService,
    ConnectTelegramIntegrationService,
    UpdateTelegramIntegrationConfigService,
    UpdateAssistantNotificationPreferenceService,
    AutoSelectNotificationChannelOnBindService,
    RevokeTelegramIntegrationSecretService,
    ResendTelegramOwnerMessageService,
    ResolvePlanVisibilityService,
    EnforceAssistantCapabilityAndQuotaService,
    TrackWorkspaceQuotaUsageService,
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
    ListInternalBackgroundTaskItemsService,
    ControlInternalBackgroundTaskService,
    ListAssistantBackgroundTaskItemsService,
    ControlAssistantBackgroundTaskService,
    DisableAssistantTaskRegistryItemService,
    EnableAssistantTaskRegistryItemService,
    CancelAssistantTaskRegistryItemService,
    ManageAssistantBillingSubscriptionService,
    SyncAssistantTaskRegistryService,
    SyncTelegramChatTargetService,
    SyncTelegramGroupMembershipService,
    MergeStagedWebChatAttachmentsService,
    PrepareAssistantInboundTurnService,
    SendWebChatTurnService,
    StreamWebChatTurnService,
    AssistantMediaJobCompletionTurnService,
    AssistantMediaJobCompletionDeliveryService,
    AssistantMediaJobSchedulerService,
    AssistantMediaJobService,
    InternalRuntimeMediaJobClientService,
    WebChatTurnAttemptService,
    WebChatTurnHardStopRegistry,
    WebChatTurnStreamRegistry,
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
      useClass: CloudpaymentsConstructorBillingProviderAdapter
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
    {
      provide: ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
      useClass: PrismaAssistantMaterializedSpecRepository
    },
    {
      provide: PROMPT_TEMPLATE_REPOSITORY,
      useClass: PrismaPromptTemplateRepository
    },
    {
      provide: PERSONA_ARCHETYPE_REPOSITORY,
      useClass: PrismaPersonaArchetypeRepository
    },
    ManageChatMediaService,
    AssistantFileRegistryService,
    MediaPreprocessorService,
    NativeMediaTranscriptionService,
    ProviderGatewayPdfTextExtractionService,
    PersaiMediaObjectStorageService,
    PersaiKnowledgeObjectStorageService,
    InboundMediaService,
    MediaDeliveryService,
    AttachmentObjectAvailabilityService,
    WebMediaAdapter,
    TelegramMediaAdapter,
    {
      provide: CHANNEL_MEDIA_ADAPTERS,
      useFactory: (web: WebMediaAdapter, telegram: TelegramMediaAdapter) => [web, telegram],
      inject: [WebMediaAdapter, TelegramMediaAdapter]
    },
    ManagePromptTemplatesService,
    ManagePersonaArchetypesService,
    SeedToolCatalogService,
    BumpConfigGenerationService,
    ForceReapplyAllService,
    SyncNativeRuntimeBundleService,
    SyncProviderGatewayWarmupService,
    CompilePromptConstructorService,
    PostgresPgvectorKnowledgeIndex,
    {
      provide: KNOWLEDGE_VECTOR_INDEX,
      useExisting: PostgresPgvectorKnowledgeIndex
    }
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
