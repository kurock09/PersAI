import { Module, forwardRef } from "@nestjs/common";
import { BrowserBridgeModule } from "../browser-bridge/browser-bridge.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { PlatformCoreModule } from "../platform-core/platform-core.module";
import { PrismaService } from "../identity-access/infrastructure/persistence/prisma.service";
import { AppBootstrapController } from "./interface/http/app-bootstrap.controller";
import { AssistantController } from "./interface/http/assistant.controller";
import { AdminPlansController } from "./interface/http/admin-plans.controller";
import { AdminSitePagesController } from "./interface/http/admin-site-pages.controller";
import { PublicPricingPlansController } from "./interface/http/public-pricing-plans.controller";
import { PublicSitePagesController } from "./interface/http/public-site-pages.controller";
import { PublicGeoHintController } from "./interface/http/public-geo-hint.controller";
import { AdminBillingLifecycleSettingsController } from "./interface/http/admin-billing-lifecycle-settings.controller";
import { AdminSecurityController } from "./interface/http/admin-security.controller";
import { AdminAbuseControlsController } from "./interface/http/admin-abuse-controls.controller";
import { AdminSafetyControlsController } from "./interface/http/admin-safety-controls.controller";
import { AdminSafetyPolicyController } from "./interface/http/admin-safety-policy.controller";
import { AdminAssistantOwnershipController } from "./interface/http/admin-assistant-ownership.controller";
import { AdminOpsController } from "./interface/http/admin-ops.controller";
import { AdminBusinessController } from "./interface/http/admin-business.controller";
import { AdminOverviewDashboardController } from "./interface/http/admin-overview-dashboard.controller";
import { AdminNotificationsController } from "./interface/http/admin-notifications.controller";
import { AdminPlatformRolloutsController } from "./interface/http/admin-platform-rollouts.controller";
import { AdminRuntimeProviderSettingsController } from "./interface/http/admin-runtime-provider-settings.controller";
import { AdminDocumentProcessingSettingsController } from "./interface/http/admin-document-processing-settings.controller";
import { AdminToolPathPricingController } from "./interface/http/admin-tool-path-pricing.controller";
import { AdminBillingProviderCredentialsController } from "./interface/http/admin-billing-provider-credentials.controller";
import { AdminToolCredentialsController } from "./interface/http/admin-tool-credentials.controller";
import { AdminPromptTemplatesController } from "./interface/http/admin-bootstrap-presets.controller";
import { AdminPersonaArchetypesController } from "./interface/http/admin-persona-archetypes.controller";
import { AdminToolMetadataController } from "./interface/http/admin-tool-metadata.controller";
import { AdminKnowledgeSourcesController } from "./interface/http/admin-knowledge-sources.controller";
import { AdminMemoryMaintenanceController } from "./interface/http/admin-memory-maintenance.controller";
import { AdminSkillsController } from "./interface/http/admin-skills.controller";
import { AdminRolesController } from "./interface/http/admin-roles.controller";
import {
  AdminScriptsController,
  AdminSkillScriptsController
} from "./interface/http/admin-scripts.controller";
import { AssistantKnowledgeSourcesController } from "./interface/http/assistant-knowledge-sources.controller";
import { AssistantBillingController } from "./interface/http/assistant-billing.controller";
import { AssistantRolesController } from "./interface/http/assistant-roles.controller";
import { CloudpaymentsWebhookController } from "./interface/http/cloudpayments-webhook.controller";
import { KnowledgeIndexingJobsController } from "./interface/http/knowledge-indexing-jobs.controller";
import { InternalCronFireController } from "./interface/http/internal-cron-fire.controller";
import { InternalRuntimeProviderSecretsController } from "./interface/http/internal-runtime-provider-secrets.controller";
import { InternalRuntimeAuditEventsController } from "./interface/http/internal-runtime-audit-events.controller";
import { InternalRuntimeConfigGenerationController } from "./interface/http/internal-runtime-config-generation.controller";
import { InternalRuntimeKnowledgeController } from "./interface/http/internal-runtime-knowledge.controller";
import { InternalRuntimeMemoryController } from "./interface/http/internal-runtime-memory.controller";
import { InternalRuntimeCompactionEnqueueController } from "./interface/http/internal-runtime-compaction-enqueue.controller";
import { InternalRuntimeDocumentJobsEnqueueController } from "./interface/http/internal-runtime-document-jobs-enqueue.controller";
import { InternalRuntimeAsyncJobsController } from "./interface/http/internal-runtime-async-jobs.controller";
import { InternalRuntimeDocumentInspectController } from "./interface/http/internal-runtime-document-inspect.controller";
import { InternalRuntimeDocumentRegisterVersionController } from "./interface/http/internal-runtime-document-register-version.controller";
import { InternalRuntimeFilesController } from "./interface/http/internal-runtime-files-controller";
import { InternalRuntimeBrowserProfilesController } from "./interface/http/internal-runtime-browser-profiles.controller";
import { AssistantBrowserProfilesController } from "./interface/http/assistant-browser-profiles.controller";
import { AssistantSandboxEgressController } from "./interface/http/assistant-sandbox-egress.controller";
import { InternalWorkspaceFilesController } from "./interface/http/internal-workspace-files.controller";
import { InternalRuntimeMediaJobsEnqueueController } from "./interface/http/internal-runtime-media-jobs-enqueue.controller";
import { InternalRuntimeMediaJobsCheckpointController } from "./interface/http/internal-runtime-media-jobs-checkpoint.controller";
import { InternalRuntimeMemoryHydrationController } from "./interface/http/internal-runtime-memory-hydration.controller";
import { InternalRuntimeMemoryCloseMostSimilarController } from "./interface/http/internal-runtime-memory-close-most-similar.controller";
import { InternalRuntimeMemoryCloseByRefController } from "./interface/http/internal-runtime-memory-close-by-ref.controller";
import { InternalRuntimeMemoryOpenLoopRefsController } from "./interface/http/internal-runtime-memory-open-loop-refs.controller";
import { InternalRuntimeCrossSessionCarryOverController } from "./interface/http/internal-runtime-cross-session-carry-over.controller";
import { InternalRuntimeCrossSessionSnapshotController } from "./interface/http/internal-runtime-cross-session-snapshot.controller";
import { InternalRuntimeTaskRegistryController } from "./interface/http/internal-runtime-task-registry.controller";
import { InternalRuntimeBackgroundTasksController } from "./interface/http/internal-runtime-background-tasks.controller";
import { InternalRuntimeToolQuotaController } from "./interface/http/internal-runtime-tool-quota.controller";
import { InternalRuntimeSkillStateController } from "./interface/http/internal-runtime-skill-state.controller";
import { InternalRuntimeScriptArtifactController } from "./interface/http/internal-runtime-script-artifact.controller";
import { InternalRuntimeChatTodosController } from "./interface/http/internal-runtime-chat-todos.controller";
import { AssistantChatTodosController } from "./interface/http/assistant-chat-todos.controller";
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
import { ElevenLabsVoiceCatalogService } from "./application/elevenlabs/elevenlabs-voice-catalog.service";
import { ConnectTelegramIntegrationService } from "./application/connect-telegram-integration.service";
import { UpdateTelegramIntegrationConfigService } from "./application/update-telegram-integration-config.service";
import { UpdateAssistantNotificationPreferenceService } from "./application/update-assistant-notification-preference.service";
import { AutoSelectNotificationChannelOnBindService } from "./application/auto-select-notification-channel-on-bind.service";
import { RevokeTelegramIntegrationSecretService } from "./application/revoke-telegram-integration-secret.service";
import { ResendTelegramOwnerMessageService } from "./application/resend-telegram-owner-message.service";
import { ResolvePlanVisibilityService } from "./application/resolve-plan-visibility.service";
import { AppendAssistantAuditEventService } from "./application/append-assistant-audit-event.service";
import { ManageAssistantSandboxEgressService } from "./application/manage-assistant-sandbox-egress.service";
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
import { AdminSystemNotificationProducerService } from "./application/admin-system-notification-producer.service";
import { ManageSupportAttachmentsService } from "./application/support/manage-support-attachments.service";
import { ManageUserSupportService } from "./application/support/manage-user-support.service";
import { ManageAdminSupportService } from "./application/support/manage-admin-support.service";
import { UserSupportNotificationProducerService } from "./application/support/user-support-notification-producer.service";
import { UserSupportController } from "./interface/http/user-support.controller";
import { AdminSupportController } from "./interface/http/admin-support.controller";
import { AdminSystemDailyReportSchedulerService } from "./application/admin-system-daily-report-scheduler.service";
import { SystemEventNotificationProducerService } from "./application/system-event-notification-producer.service";
import { NotificationIntentService } from "./application/notifications/notification-intent.service";
import { NotificationRoutingService } from "./application/notifications/notification-routing.service";
import { NotificationDeliveryWorkerService } from "./application/notifications/notification-delivery-worker.service";
import { StaticFallbackRendererService } from "./application/notifications/render/static-fallback-renderer.service";
import { TemplateRendererService } from "./application/notifications/render/template-renderer.service";
import { GroundedLlmRendererService } from "./application/notifications/render/grounded-llm-renderer.service";
import { ManageNotificationPlatformService } from "./application/notifications/manage-notification-platform.service";
import { HandlePostmarkWebhookService } from "./application/notifications/handle-postmark-webhook.service";
import { ResolveWorkspaceNotificationChannelsService } from "./application/notifications/resolve-workspace-notification-channels.service";
import { TelegramThreadChannelAdapter } from "./infrastructure/notifications/channel-adapters/telegram-thread-channel.adapter";
import { WebThreadChannelAdapter } from "./infrastructure/notifications/channel-adapters/web-thread-channel.adapter";
import { WebNotificationCenterChannelAdapter } from "./infrastructure/notifications/channel-adapters/web-notification-center-channel.adapter";
import { EmailChannelAdapter } from "./infrastructure/notifications/channel-adapters/email-channel.adapter";
import { AdminWebhookChannelAdapter } from "./infrastructure/notifications/channel-adapters/admin-webhook-channel.adapter";
import { WebPushChannelAdapter } from "./infrastructure/notifications/channel-adapters/web-push-channel.adapter";
import { MobilePushChannelAdapter } from "./infrastructure/notifications/channel-adapters/mobile-push-channel.adapter";
import { NOTIFICATION_CHANNEL_ADAPTERS } from "./infrastructure/notifications/channel-adapters/channel-adapter.interface";
import { InternalNotificationsPostmarkWebhookController } from "./interface/http/internal-notifications-postmark-webhook.controller";
import { ManageAdminRuntimeProviderSettingsService } from "./application/manage-admin-runtime-provider-settings.service";
import { ManageAdminDocumentProcessingSettingsService } from "./application/manage-admin-document-processing-settings.service";
import { ManageAdminToolPathPricingService } from "./application/manage-admin-tool-path-pricing.service";
import { ResolveToolPathPricingCatalogService } from "./application/resolve-tool-path-pricing-catalog.service";
import { ManageAdminBillingProviderCredentialsService } from "./application/manage-admin-billing-provider-credentials.service";
import { ManageAdminToolCredentialsService } from "./application/manage-admin-tool-credentials.service";
import { ManageAdminToolPromptMetadataService } from "./application/manage-admin-tool-prompt-metadata.service";
import { ManageAdminKnowledgeSourcesService } from "./application/manage-admin-knowledge-sources.service";
import { ManageAdminSkillsService } from "./application/manage-admin-skills.service";
import { ManageAdminRolesService } from "./application/manage-admin-roles.service";
import { ManageAdminScriptsService } from "./application/manage-admin-scripts.service";
import { ManageSkillScenariosService } from "./application/manage-skill-scenarios.service";
import { GenerateSkillAuthoringDraftService } from "./application/generate-skill-authoring-draft.service";
import { ManageAdminKnowledgeRetrievalPolicyService } from "./application/manage-admin-knowledge-retrieval-policy.service";
import { ManageAdminMemoryBackfillService } from "./application/manage-admin-memory-backfill.service";
import { ListKnowledgeIndexingJobsService } from "./application/list-knowledge-indexing-jobs.service";
import { DocumentExtractionService } from "./application/document-extraction.service";
import { DocumentWorkspaceInspectionService } from "./application/document-workspace-inspection.service";
import { DocumentWorkspaceVersionRegistrationService } from "./application/document-workspace-version-registration.service";
import { DocumentSourceAttachmentExtractionService } from "./application/document-source-attachment-extraction.service";
import { ListWorkspaceFileShortDescriptionsService } from "./application/list-workspace-file-short-descriptions.service";
import { SearchWorkspaceFilesFromManifestService } from "./application/search-workspace-files-from-manifest.service";
import { GrepWorkspaceFilesFromStorageService } from "./application/grep-workspace-files-from-storage.service";
import { GlobWorkspaceFilesFromManifestService } from "./application/glob-workspace-files-from-manifest.service";
import { ListWorkspaceFilesFromManifestService } from "./application/list-workspace-files-from-manifest.service";
import { ListChatWorkspaceFilesService } from "./application/list-chat-workspace-files.service";
import { RegisterChatAttachmentService } from "./application/register-chat-attachment.service";
import { SandboxControlPlaneClientService } from "./application/sandbox-control-plane.client.service";
import { UpsertWorkspaceFileMetadataFromRuntimeService } from "./application/upsert-workspace-file-metadata-from-runtime.service";
import { DeleteWorkspaceFileFromRuntimeService } from "./application/delete-workspace-file-from-runtime.service";
import { WorkspaceFileMetadataService } from "./application/workspace-file-metadata.service";
import { WorkspaceFileMicroDescriptionService } from "./application/workspace-file-micro-description.service";
import { WorkspaceFileMicroDescriptionJobService } from "./application/workspace-file-micro-description-job.service";
import { WorkspaceFileMicroDescriptionJobSchedulerService } from "./application/workspace-file-micro-description-job-scheduler.service";
import { ASSISTANT_ROLE_REPOSITORY } from "./domain/assistant-role.repository";
import { WORKSPACE_FILE_METADATA_REPOSITORY } from "./domain/workspace-file-metadata.repository";
import { ASSISTANT_BROWSER_PROFILE_REPOSITORY } from "./domain/assistant-browser-profile.repository";
import { PrismaAssistantBrowserProfileRepository } from "./infrastructure/persistence/prisma-assistant-browser-profile.repository";
import { PrismaAssistantRoleRepository } from "./infrastructure/persistence/prisma-assistant-role.repository";
import { AssistantBrowserProfileService } from "./application/assistant-browser-profile.service";
import { ExpireAssistantBrowserProfilesService } from "./application/expire-assistant-browser-profiles.service";
import { AssistantBrowserProfileExpirySchedulerService } from "./application/assistant-browser-profile-expiry-scheduler.service";
import { OrphanWebChatTurnReconcileSchedulerService } from "./application/orphan-web-chat-turn-reconcile-scheduler.service";
import { ReconcileOrphanWebChatTurnAttemptsService } from "./application/reconcile-orphan-web-chat-turn-attempts.service";
import { PrismaWorkspaceFileMetadataRepository } from "./infrastructure/persistence/prisma-workspace-file-metadata.repository";
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
import { EnforceInboundSafetyGateService } from "./application/enforce-inbound-safety-gate.service";
import { EnforceInboundSafetyPrecheckFollowThroughService } from "./application/enforce-inbound-safety-precheck-follow-through.service";
import { EvaluateInboundSafetyPrecheckService } from "./application/evaluate-inbound-safety-precheck.service";
import { EnqueueSafetyModerationReviewService } from "./application/enqueue-safety-moderation-review.service";
import { OpenAiModerationClientService } from "./application/openai-moderation-client.service";
import { DeliverSafetyInboundWarnNoticeService } from "./application/deliver-safety-inbound-warn-notice.service";
import { PersistSafetyInboundThreadNoticeService } from "./application/persist-safety-inbound-thread-notice.service";
import { ProcessSafetyModerationReviewService } from "./application/process-safety-moderation-review.service";
import { SafetyModerationReviewCoreService } from "./application/safety-moderation-review-core.service";
import { SafetyModerationReviewSchedulerService } from "./application/safety-moderation-review-scheduler.service";
import { ManageAdminSafetyPolicyService } from "./application/manage-admin-safety-policy.service";
import { SeedSafetyHeuristicRulesService } from "./application/seed-safety-heuristic-rules.service";
import { ManageAdminAbuseControlsService } from "./application/manage-admin-abuse-controls.service";
import { ManageAdminSafetyControlsService } from "./application/manage-admin-safety-controls.service";
import { ManageAdminAssistantOwnershipService } from "./application/manage-admin-assistant-ownership.service";
import { ManageAdminAssistantPlanOverrideService } from "./application/manage-admin-assistant-plan-override.service";
import { ManageAdminWorkspaceSubscriptionService } from "./application/manage-admin-workspace-subscription.service";
import { ManageAdminOpsBillingSupportService } from "./application/manage-admin-ops-billing-support.service";
import { ManageAdminBillingLifecycleSettingsService } from "./application/manage-admin-billing-lifecycle-settings.service";
import { ManageAssistantBillingSubscriptionService } from "./application/manage-assistant-billing-subscription.service";
import { ManageAssistantPaymentIntentsService } from "./application/manage-assistant-payment-intents.service";
import { HandleCloudpaymentsWebhookService } from "./application/handle-cloudpayments-webhook.service";
import { ManageMediaPackageCatalogService } from "./application/manage-media-package-catalog.service";
import { ManageMediaPackagePurchaseService } from "./application/manage-media-package-purchase.service";
import { ManageWorkspaceSubscriptionLifecycleService } from "./application/manage-workspace-subscription-lifecycle.service";
import { ApplyWorkspaceSubscriptionBillingEventService } from "./application/apply-workspace-subscription-billing-event.service";
import { BillingLifecycleProducerService } from "./application/billing-lifecycle-producer.service";
import { ResolveUserLocaleService } from "./application/resolve-user-locale.service";
import { ApplyAssistantPublishedVersionService } from "./application/apply-assistant-published-version.service";
import { AssistantRuntimePreflightService } from "./application/assistant-runtime-preflight.service";
import { CreateAssistantService } from "./application/create-assistant.service";
import { EnforceAssistantCreationLimitService } from "./application/enforce-assistant-creation-limit.service";
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
import { ResolveUserSafetyStandingService } from "./application/resolve-user-safety-standing.service";
import { ManageAssistantKnowledgeSourcesService } from "./application/manage-assistant-knowledge-sources.service";
import { ManageAssistantRolesService } from "./application/manage-assistant-roles.service";
import { ManageAssistantAvatarService } from "./application/manage-assistant-avatar.service";
import { ManageAssistantWorkspaceMemoryService } from "./application/manage-assistant-workspace-memory.service";
import { ReadAssistantKnowledgeService } from "./application/read-assistant-knowledge.service";
import { SkillRetrievalPolicyService } from "./application/skill-retrieval-policy.service";
import { SkillRetrievalStateService } from "./application/skill-retrieval-state.service";
import { AutoSkillRoutingStateService } from "./application/auto-skill-routing-state.service";
import { InternalRuntimeSkillStateService } from "./application/internal-runtime-skill-state.service";
import { InternalRuntimeScriptArtifactService } from "./application/internal-runtime-script-artifact.service";
import { WriteAssistantMemoryService } from "./application/write-assistant-memory.service";
import { AssistantChatTodosService } from "./application/assistant-chat-todos.service";
import { HydrateMemoryForTurnService } from "./application/hydrate-memory-for-turn.service";
import { CloseMostSimilarOpenLoopService } from "./application/close-most-similar-open-loop.service";
import { CloseAssistantMemoryByRefService } from "./application/close-assistant-memory-by-ref.service";
import { ListRuntimeOpenLoopRefsService } from "./application/list-runtime-open-loop-refs.service";
import { FindCrossSessionCarryOverService } from "./application/find-cross-session-carry-over.service";
import { ResolveCrossSessionCarryOverSnapshotService } from "./application/resolve-cross-session-carry-over-snapshot.service";
import { MaterializeAssistantPublishedVersionService } from "./application/materialize-assistant-published-version.service";
import { ManageAdminPlansService } from "./application/manage-admin-plans.service";
import { ManageSitePagesService } from "./application/manage-site-pages.service";
import { ManageWebChatListService } from "./application/manage-web-chat-list.service";
import { PublishAssistantDraftService } from "./application/publish-assistant-draft.service";
import { RecordModelCostLedgerService } from "./application/record-model-cost-ledger.service";
import { RecordToolPathLedgerFromToolInvocationsService } from "./application/record-tool-path-ledger-from-tool-invocations.service";
import { ReapplyAssistantService } from "./application/reapply-assistant.service";
import { ResolveActiveAssistantService } from "./application/resolve-active-assistant.service";
import { ResolveAssistantLifecycleViewService } from "./application/resolve-assistant-lifecycle-view.service";
import { ResetAssistantService } from "./application/reset-assistant.service";
import { RollbackAssistantService } from "./application/rollback-assistant.service";
import { PreviewAssistantSetupService } from "./application/preview-assistant-setup.service";
import { SendNativeTelegramTurnService } from "./application/send-native-telegram-turn.service";
import { WebRuntimeCompactionClientService } from "./application/web-runtime-compaction-client.service";
import { WebRuntimeSessionStateClientService } from "./application/web-runtime-session-state-client.service";
import { WebRuntimeTurnClientService } from "./application/web-runtime-turn-client.service";
import { SendWebChatTurnService } from "./application/send-web-chat-turn.service";
import { WebRuntimeStreamClientService } from "./application/web-runtime-stream-client.service";
import { StreamWebChatTurnService } from "./application/stream-web-chat-turn.service";
import { SwitchActiveAssistantService } from "./application/switch-active-assistant.service";
import { AssistantMediaJobCompletionTurnService } from "./application/workspace-media-job-completion-turn.service";
import { AssistantMediaJobCompletionDeliveryService } from "./application/workspace-media-job-completion-delivery.service";
import { AssistantDocumentJobCompletionTurnService } from "./application/assistant-document-job-completion-turn.service";
import { AssistantDocumentJobDeliveryService } from "./application/assistant-document-job-delivery.service";
import { PrepareAssistantDocumentPptxService } from "./application/prepare-assistant-document-pptx.service";
import { AssistantDocumentJobSchedulerService } from "./application/assistant-document-job-scheduler.service";
import { AssistantMediaJobSchedulerService } from "./application/workspace-media-job-scheduler.service";
import { AssistantDocumentJobService } from "./application/assistant-document-job.service";
import { AssistantDocumentJobReadService } from "./application/assistant-document-job-read.service";
import { AssistantMediaJobService } from "./application/workspace-media-job.service";
import { EnqueueRuntimeDeferredDocumentJobService } from "./application/enqueue-runtime-deferred-document-job.service";
import { GammaThemeCatalogService } from "./application/gamma/gamma-theme-catalog.service";
import { GammaThemePickerService } from "./application/gamma/gamma-theme-picker.service";
import { KlingVoiceCatalogService } from "./application/kling/kling-voice-catalog.service";
import { HeyGenVoiceCatalogService } from "./application/heygen/heygen-voice-catalog.service";
import { HeyGenProviderGatewayClient } from "./application/heygen/heygen-provider-gateway.client";
import { ManageWorkspaceVideoPersonasService } from "./application/heygen/manage-workspace-video-personas.service";
import { ManageWorkspaceVideoClonedVoicesService } from "./application/heygen/manage-workspace-video-cloned-voices.service";
import { ReadWorkspaceVideoPersonaService } from "./application/heygen/read-workspace-video-persona.service";
import { ReadWorkspaceVideoPreviewService } from "./application/heygen/read-workspace-video-preview.service";
import { ReadHeygenVoiceCatalogForWorkspaceService } from "./application/heygen/read-heygen-voice-catalog-for-workspace.service";
import { WorkspaceVideoPersonasController } from "./interface/http/workspace-video-personas.controller";
import { WorkspaceVideoClonedVoicesController } from "./interface/http/workspace-video-cloned-voices.controller";
import { InternalRuntimeWorkspaceVideoPersonasController } from "./interface/http/internal-runtime-workspace-video-personas.controller";
import { WORKSPACE_VIDEO_PERSONA_REPOSITORY } from "./domain/workspace-video-persona.repository";
import { PrismaWorkspaceVideoPersonaRepository } from "./infrastructure/persistence/prisma-workspace-video-persona.repository";
import { WORKSPACE_VIDEO_CLONED_VOICE_REPOSITORY } from "./domain/workspace-video-cloned-voice.repository";
import { PrismaWorkspaceVideoClonedVoiceRepository } from "./infrastructure/persistence/prisma-workspace-video-cloned-voice.repository";
import { EnqueueRuntimeDeferredMediaJobService } from "./application/enqueue-runtime-deferred-media-job.service";
import { ResolveAssistantAsyncJobService } from "./application/resolve-assistant-async-job.service";
import { AssistantAsyncJobHandleStateService } from "./application/assistant-async-job-handle-state.service";
import { AssistantAsyncJobContinuationSchedulerService } from "./application/assistant-async-job-continuation-scheduler.service";
import { ChatWakeCoordinator } from "./application/chat-wake-coordinator.service";
import { InternalRuntimeAsyncContinuationClientService } from "./application/internal-runtime-async-continuation.client.service";
import { StreamWebAsyncContinuationService } from "./application/stream-web-async-continuation.service";
import { ConversationalPublishService } from "./application/conversational-publish.service";
import { CheckpointMediaJobAcceptedProviderTaskService } from "./application/checkpoint-media-job-accepted-provider-task.service";
import { InternalRuntimeDocumentJobClientService } from "./application/internal-runtime-document-job.client.service";
import { InternalRuntimeMediaJobClientService } from "./application/internal-runtime-media-job.client.service";
import { WebChatTurnAttemptService } from "./application/web-chat-turn-attempt.service";
import { WebChatTurnStopDispatchService } from "./application/web-chat-turn-stop-dispatch.service";
import { WebChatContinuationDiscoveryService } from "./application/web-chat-continuation-discovery.service";
import { WebChatTurnStreamBusService } from "./application/web-chat-turn-stream-bus.service";
import { WebChatTurnStreamRegistry } from "./application/web-chat-turn-stream-registry.service";
import { createTurnStreamEventStore } from "./application/turn-stream-event-store.factory";
import { TURN_STREAM_EVENT_STORE } from "./application/turn-stream-event-store";
import { PrepareAssistantInboundTurnService } from "./application/prepare-assistant-inbound-turn.service";
import { MergeStagedWebChatAttachmentsService } from "./application/merge-staged-web-chat-attachments.service";
import { HandleInternalCronFireService } from "./application/handle-internal-cron-fire.service";
import { BuildReminderContextSnapshotService } from "./application/build-reminder-context-snapshot.service";
import { PersaiScheduledActionSchedulerService } from "./application/persai-scheduled-action-scheduler.service";
import { PersaiBackgroundCompactionSchedulerService } from "./application/persai-background-compaction-scheduler.service";
import { ConsolidateAssistantMemoryService } from "./application/consolidate-assistant-memory.service";
import { ProactivePushPolicyService } from "./application/proactive-push-policy.service";
import { EnqueueBackgroundCompactionJobService } from "./application/enqueue-background-compaction-job.service";
import { InternalRuntimeCompactionClientService } from "./application/internal-runtime-compaction.client.service";
import { InternalRuntimeBackgroundTaskClientService } from "./application/internal-runtime-background-task.client.service";
import { BackgroundSchedulerMetricsService } from "./application/background-scheduler-metrics.service";
import { PersaiBackgroundTaskSchedulerService } from "./application/persai-background-task-scheduler.service";
import { PersaiIdleReengagementSchedulerService } from "./application/persai-idle-reengagement-scheduler.service";
import { PersaiIdleSessionMemoryExtractionSchedulerService } from "./application/persai-idle-session-memory-extraction-scheduler.service";
import { SchedulerLeaseService } from "./application/scheduler-lease.service";
import { BackgroundCompactionQueueService } from "./application/background-compaction-queue.service";
import { HandleInternalTelegramTurnService } from "./application/handle-internal-telegram-turn.service";
import { ConsumeInternalRuntimeToolDailyLimitService } from "./application/consume-internal-runtime-tool-daily-limit.service";
import { ReadInternalRuntimeQuotaStatusService } from "./application/read-internal-runtime-quota-status.service";
import { QuotaAdvisoryFollowUpService } from "./application/quota-advisory-follow-up.service";
import { CompactionAdvisoryFollowUpService } from "./application/compaction-advisory-follow-up.service";
import { QuotaGroundedLimitCopyService } from "./application/quota-grounded-limit-copy.service";
import { CreateInternalRuntimeQuotaCheckoutService } from "./application/create-internal-runtime-quota-checkout.service";
import { ResolveAssistantInboundRuntimeContextService } from "./application/resolve-assistant-inbound-runtime-context.service";
import { ResolveAssistantRuntimeTierService } from "./application/resolve-assistant-runtime-tier.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./application/ensure-assistant-materialized-spec-current.service";
import { RenderAssistantInboundSurfaceMessageService } from "./application/render-assistant-inbound-surface-message.service";
import { SyncAssistantTaskRegistryService } from "./application/sync-assistant-task-registry.service";
import { SyncTelegramChatTargetService } from "./application/sync-telegram-chat-target.service";
import { SyncTelegramGroupMembershipService } from "./application/sync-telegram-group-membership.service";
import { RefreshTelegramGroupsService } from "./application/refresh-telegram-groups.service";
import { TrackWorkspaceQuotaUsageService } from "./application/track-workspace-quota-usage.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./application/resolve-internal-runtime-tool-daily-policy.service";
import { UpdateAssistantDraftService } from "./application/update-assistant-draft.service";
import { ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY } from "./domain/assistant-chat-message-attachment.repository";
import { ASSISTANT_CHAT_REPOSITORY } from "./domain/assistant-chat.repository";
import { ASSISTANT_ABUSE_GUARD_REPOSITORY } from "./domain/assistant-abuse-guard.repository";
import { USER_RESTRICTION_REPOSITORY } from "./domain/user-restriction.repository";
import {
  SAFETY_HEURISTIC_RULE_REPOSITORY,
  SAFETY_POLICY_SETTINGS_REPOSITORY
} from "./domain/safety-policy.repository";
import { ASSISTANT_PLAN_CATALOG_REPOSITORY } from "./domain/assistant-plan-catalog.repository";
import { TOOL_CATALOG_REPOSITORY } from "./domain/tool-catalog.repository";
import { WORKSPACE_SUBSCRIPTION_REPOSITORY } from "./domain/workspace-subscription.repository";
import { WORKSPACE_QUOTA_ACCOUNTING_REPOSITORY } from "./domain/workspace-quota-accounting.repository";
import { WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY } from "./domain/workspace-tool-daily-usage.repository";
import { PrismaWorkspaceToolDailyUsageRepository } from "./infrastructure/persistence/prisma-workspace-tool-daily-usage.repository";
import { WORKSPACE_VCOIN_BALANCE_REPOSITORY } from "./domain/workspace-vcoin-balance.repository";
import { PrismaWorkspaceVcoinBalanceRepository } from "./infrastructure/persistence/prisma-workspace-vcoin-balance.repository";
import { WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY } from "./domain/workspace-vcoin-ledger-event.repository";
import { PrismaWorkspaceVcoinLedgerEventRepository } from "./infrastructure/persistence/prisma-workspace-vcoin-ledger-event.repository";
import { GrantMonthlyVcoinService } from "./application/vcoin/grant-monthly-vcoin.service";
import { ComputeTypicalVideoVcoinCostService } from "./application/vcoin/compute-typical-video-vcoin-cost.service";
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
import { PrismaUserRestrictionRepository } from "./infrastructure/persistence/prisma-user-restriction.repository";
import {
  PrismaSafetyHeuristicRuleRepository,
  PrismaSafetyPolicySettingsRepository
} from "./infrastructure/persistence/prisma-safety-policy.repository";
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
import { MaterializationRolloutService } from "./application/materialization-rollout.service";
import { MaterializationRolloutWorkerService } from "./application/materialization-rollout-worker.service";
import { SyncNativeRuntimeBundleService } from "./application/sync-native-runtime-bundle.service";
import { SyncProviderGatewayWarmupService } from "./application/sync-provider-gateway-warmup.service";
import { CompilePromptConstructorService } from "./application/compile-prompt-constructor.service";
import { AdminForceReapplyController } from "./interface/http/admin-force-reapply.controller";
import { MediaAttachmentController } from "./interface/http/media-attachment.controller";
import { TelegramWebhookController } from "./interface/http/telegram-webhook-proxy.controller";
import { ManageChatMediaService } from "./application/manage-chat-media.service";
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
import { TelegramAssistantChatOutboundService } from "./application/telegram-assistant-chat-outbound.service";
import { TelegramChannelAdapterService } from "./application/telegram-channel-adapter.service";
import { TelegramAlbumCollectorService } from "./application/telegram-album-collector.service";
import { TelegramAlbumFinalizerSchedulerService } from "./application/telegram-album-finalizer-scheduler.service";

@Module({
  imports: [IdentityAccessModule, PlatformCoreModule, forwardRef(() => BrowserBridgeModule)],
  controllers: [
    AppBootstrapController,
    AssistantController,
    AssistantBrowserProfilesController,
    AssistantSandboxEgressController,
    UserSupportController,
    AssistantBillingController,
    AssistantKnowledgeSourcesController,
    AdminPlansController,
    AdminSitePagesController,
    PublicPricingPlansController,
    PublicSitePagesController,
    PublicGeoHintController,
    AdminBillingLifecycleSettingsController,
    AdminSecurityController,
    AdminAbuseControlsController,
    AdminSafetyControlsController,
    AdminSafetyPolicyController,
    AdminAssistantOwnershipController,
    AdminOpsController,
    AdminSupportController,
    AdminBusinessController,
    AdminOverviewDashboardController,
    AdminNotificationsController,
    InternalNotificationsPostmarkWebhookController,
    AdminPlatformRolloutsController,
    AdminRuntimeProviderSettingsController,
    AdminDocumentProcessingSettingsController,
    AdminToolPathPricingController,
    AdminBillingProviderCredentialsController,
    AdminToolCredentialsController,
    AdminToolMetadataController,
    AdminPromptTemplatesController,
    AdminPersonaArchetypesController,
    AdminKnowledgeSourcesController,
    AdminMemoryMaintenanceController,
    AdminSkillsController,
    AdminRolesController,
    AdminScriptsController,
    AdminSkillScriptsController,
    KnowledgeIndexingJobsController,
    AssistantRolesController,
    CloudpaymentsWebhookController,
    InternalCronFireController,
    InternalRuntimeProviderSecretsController,
    InternalRuntimeAuditEventsController,
    InternalRuntimeConfigGenerationController,
    InternalRuntimeKnowledgeController,
    InternalRuntimeMemoryController,
    InternalRuntimeMemoryHydrationController,
    InternalRuntimeMemoryCloseMostSimilarController,
    InternalRuntimeMemoryCloseByRefController,
    InternalRuntimeMemoryOpenLoopRefsController,
    InternalRuntimeCrossSessionCarryOverController,
    InternalRuntimeCrossSessionSnapshotController,
    InternalRuntimeCompactionEnqueueController,
    InternalRuntimeDocumentJobsEnqueueController,
    InternalRuntimeAsyncJobsController,
    InternalRuntimeDocumentInspectController,
    InternalRuntimeDocumentRegisterVersionController,
    InternalRuntimeFilesController,
    InternalRuntimeBrowserProfilesController,
    InternalWorkspaceFilesController,
    InternalRuntimeMediaJobsEnqueueController,
    InternalRuntimeMediaJobsCheckpointController,
    InternalRuntimeTaskRegistryController,
    InternalRuntimeBackgroundTasksController,
    InternalRuntimeToolQuotaController,
    InternalRuntimeSkillStateController,
    InternalRuntimeScriptArtifactController,
    InternalRuntimeChatTodosController,
    AssistantChatTodosController,
    InternalSmokeReceiptsController,
    AdminForceReapplyController,
    MediaAttachmentController,
    TelegramWebhookController,
    WorkspaceVideoPersonasController,
    WorkspaceVideoClonedVoicesController,
    InternalRuntimeWorkspaceVideoPersonasController
  ],
  providers: [
    {
      provide: WorkspaceManagementPrismaService,
      useExisting: PrismaService
    },
    AppendAssistantAuditEventService,
    ManageAssistantSandboxEgressService,
    AdminAuthorizationService,
    ManageSitePagesService,
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
    AdminSystemNotificationProducerService,
    ManageSupportAttachmentsService,
    ManageUserSupportService,
    ManageAdminSupportService,
    UserSupportNotificationProducerService,
    AdminSystemDailyReportSchedulerService,
    SystemEventNotificationProducerService,
    // ADR-088: Unified notification platform – Slice 1
    NotificationRoutingService,
    StaticFallbackRendererService,
    TemplateRendererService,
    GroundedLlmRendererService,
    TelegramThreadChannelAdapter,
    WebThreadChannelAdapter,
    WebNotificationCenterChannelAdapter,
    EmailChannelAdapter,
    AdminWebhookChannelAdapter,
    WebPushChannelAdapter,
    MobilePushChannelAdapter,
    {
      provide: NOTIFICATION_CHANNEL_ADAPTERS,
      useFactory: (
        telegram: TelegramThreadChannelAdapter,
        web: WebThreadChannelAdapter,
        webNc: WebNotificationCenterChannelAdapter,
        email: EmailChannelAdapter,
        adminWebhook: AdminWebhookChannelAdapter,
        webPush: WebPushChannelAdapter,
        mobilePush: MobilePushChannelAdapter
      ) => [telegram, web, webNc, email, adminWebhook, webPush, mobilePush],
      inject: [
        TelegramThreadChannelAdapter,
        WebThreadChannelAdapter,
        WebNotificationCenterChannelAdapter,
        EmailChannelAdapter,
        AdminWebhookChannelAdapter,
        WebPushChannelAdapter,
        MobilePushChannelAdapter
      ]
    },
    NotificationIntentService,
    NotificationDeliveryWorkerService,
    ManageNotificationPlatformService,
    HandlePostmarkWebhookService,
    ResolveWorkspaceNotificationChannelsService,
    ManageAdminRuntimeProviderSettingsService,
    ManageAdminDocumentProcessingSettingsService,
    ManageAdminToolPathPricingService,
    ResolveToolPathPricingCatalogService,
    ManageAdminBillingProviderCredentialsService,
    ManageAdminToolCredentialsService,
    ManageAdminToolPromptMetadataService,
    ManageAdminKnowledgeSourcesService,
    ManageAdminSkillsService,
    ManageAdminRolesService,
    ManageAdminScriptsService,
    ManageSkillScenariosService,
    GenerateSkillAuthoringDraftService,
    ManageAdminKnowledgeRetrievalPolicyService,
    ManageAdminMemoryBackfillService,
    ListKnowledgeIndexingJobsService,
    DocumentExtractionService,
    DocumentWorkspaceInspectionService,
    DocumentWorkspaceVersionRegistrationService,
    DocumentSourceAttachmentExtractionService,
    ListWorkspaceFileShortDescriptionsService,
    SearchWorkspaceFilesFromManifestService,
    GrepWorkspaceFilesFromStorageService,
    GlobWorkspaceFilesFromManifestService,
    ListWorkspaceFilesFromManifestService,
    ListChatWorkspaceFilesService,
    RegisterChatAttachmentService,
    SandboxControlPlaneClientService,
    UpsertWorkspaceFileMetadataFromRuntimeService,
    DeleteWorkspaceFileFromRuntimeService,
    WorkspaceFileMetadataService,
    WorkspaceFileMicroDescriptionService,
    WorkspaceFileMicroDescriptionJobService,
    WorkspaceFileMicroDescriptionJobSchedulerService,
    AssistantBrowserProfileService,
    ExpireAssistantBrowserProfilesService,
    AssistantBrowserProfileExpirySchedulerService,
    ReconcileOrphanWebChatTurnAttemptsService,
    OrphanWebChatTurnReconcileSchedulerService,
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
    EnforceInboundSafetyGateService,
    EvaluateInboundSafetyPrecheckService,
    EnqueueSafetyModerationReviewService,
    OpenAiModerationClientService,
    SafetyModerationReviewCoreService,
    EnforceInboundSafetyPrecheckFollowThroughService,
    PersistSafetyInboundThreadNoticeService,
    DeliverSafetyInboundWarnNoticeService,
    ProcessSafetyModerationReviewService,
    SafetyModerationReviewSchedulerService,
    ManageAdminSafetyPolicyService,
    SeedSafetyHeuristicRulesService,
    ManageAdminAbuseControlsService,
    ManageAdminSafetyControlsService,
    ManageAdminAssistantOwnershipService,
    ManageAdminAssistantPlanOverrideService,
    ManageAdminWorkspaceSubscriptionService,
    ManageAdminOpsBillingSupportService,
    ManageAdminBillingLifecycleSettingsService,
    ManageAssistantPaymentIntentsService,
    HandleCloudpaymentsWebhookService,
    ManageWorkspaceSubscriptionLifecycleService,
    ApplyWorkspaceSubscriptionBillingEventService,
    ResolveUserLocaleService,
    BillingLifecycleProducerService,
    HandleInternalCronFireService,
    BuildReminderContextSnapshotService,
    BackgroundSchedulerMetricsService,
    BackgroundCompactionQueueService,
    PersaiScheduledActionSchedulerService,
    ConsolidateAssistantMemoryService,
    PersaiBackgroundCompactionSchedulerService,
    PersaiBackgroundTaskSchedulerService,
    ProactivePushPolicyService,
    EnqueueBackgroundCompactionJobService,
    EnqueueRuntimeDeferredDocumentJobService,
    GammaThemeCatalogService,
    GammaThemePickerService,
    KlingVoiceCatalogService,
    HeyGenVoiceCatalogService,
    EnqueueRuntimeDeferredMediaJobService,
    ResolveAssistantAsyncJobService,
    AssistantAsyncJobHandleStateService,
    ChatWakeCoordinator,
    InternalRuntimeAsyncContinuationClientService,
    ConversationalPublishService,
    StreamWebAsyncContinuationService,
    AssistantAsyncJobContinuationSchedulerService,
    CheckpointMediaJobAcceptedProviderTaskService,
    InternalRuntimeCompactionClientService,
    InternalRuntimeBackgroundTaskClientService,
    PersaiIdleReengagementSchedulerService,
    PersaiIdleSessionMemoryExtractionSchedulerService,
    SchedulerLeaseService,
    HandleInternalTelegramTurnService,
    ResolveInternalRuntimeToolDailyPolicyService,
    ConsumeInternalRuntimeToolDailyLimitService,
    ReadInternalRuntimeQuotaStatusService,
    QuotaAdvisoryFollowUpService,
    CompactionAdvisoryFollowUpService,
    QuotaGroundedLimitCopyService,
    CreateInternalRuntimeQuotaCheckoutService,
    ResolveAssistantInboundRuntimeContextService,
    ResolveAssistantRuntimeTierService,
    EnsureAssistantMaterializedSpecCurrentService,
    RenderAssistantInboundSurfaceMessageService,
    GetAssistantAppBootstrapService,
    ResolveUserSafetyStandingService,
    ManageAssistantAvatarService,
    ManageAssistantKnowledgeSourcesService,
    ManageAssistantRolesService,
    ManageAssistantWorkspaceMemoryService,
    ReadAssistantKnowledgeService,
    SkillRetrievalPolicyService,
    SkillRetrievalStateService,
    AutoSkillRoutingStateService,
    InternalRuntimeSkillStateService,
    InternalRuntimeScriptArtifactService,
    WriteAssistantMemoryService,
    AssistantChatTodosService,
    HydrateMemoryForTurnService,
    CloseMostSimilarOpenLoopService,
    CloseAssistantMemoryByRefService,
    ListRuntimeOpenLoopRefsService,
    FindCrossSessionCarryOverService,
    ResolveCrossSessionCarryOverSnapshotService,
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
    ElevenLabsVoiceCatalogService,
    ConnectTelegramIntegrationService,
    UpdateTelegramIntegrationConfigService,
    UpdateAssistantNotificationPreferenceService,
    AutoSelectNotificationChannelOnBindService,
    RevokeTelegramIntegrationSecretService,
    ResendTelegramOwnerMessageService,
    ResolvePlanVisibilityService,
    EnforceAssistantCapabilityAndQuotaService,
    TrackWorkspaceQuotaUsageService,
    RecordModelCostLedgerService,
    RecordToolPathLedgerFromToolInvocationsService,
    WebRuntimeCompactionClientService,
    WebRuntimeSessionStateClientService,
    ManageWebChatListService,
    ResolveActiveAssistantService,
    ResolveAssistantLifecycleViewService,
    CreateAssistantService,
    EnforceAssistantCreationLimitService,
    PublishAssistantDraftService,
    ReapplyAssistantService,
    RollbackAssistantService,
    ResetAssistantService,
    PreviewAssistantSetupService,
    SendNativeTelegramTurnService,
    WebRuntimeTurnClientService,
    WebRuntimeStreamClientService,
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
    RefreshTelegramGroupsService,
    MergeStagedWebChatAttachmentsService,
    PrepareAssistantInboundTurnService,
    SendWebChatTurnService,
    StreamWebChatTurnService,
    AssistantMediaJobCompletionTurnService,
    AssistantMediaJobCompletionDeliveryService,
    AssistantDocumentJobCompletionTurnService,
    AssistantDocumentJobDeliveryService,
    PrepareAssistantDocumentPptxService,
    AssistantMediaJobSchedulerService,
    TelegramAlbumCollectorService,
    TelegramAlbumFinalizerSchedulerService,
    AssistantDocumentJobSchedulerService,
    AssistantDocumentJobService,
    AssistantDocumentJobReadService,
    AssistantMediaJobService,
    InternalRuntimeDocumentJobClientService,
    InternalRuntimeMediaJobClientService,
    WebChatTurnAttemptService,
    WebChatTurnStopDispatchService,
    WebChatContinuationDiscoveryService,
    {
      provide: TURN_STREAM_EVENT_STORE,
      useFactory: () => createTurnStreamEventStore()
    },
    WebChatTurnStreamBusService,
    WebChatTurnStreamRegistry,
    UpdateAssistantDraftService,
    SwitchActiveAssistantService,
    ResolveTelegramChannelRuntimeConfigService,
    TelegramBotClientService,
    TelegramAssistantChatOutboundService,
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
      provide: WORKSPACE_VCOIN_BALANCE_REPOSITORY,
      useClass: PrismaWorkspaceVcoinBalanceRepository
    },
    {
      provide: WORKSPACE_VCOIN_LEDGER_EVENT_REPOSITORY,
      useClass: PrismaWorkspaceVcoinLedgerEventRepository
    },
    GrantMonthlyVcoinService,
    ComputeTypicalVideoVcoinCostService,
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
      provide: USER_RESTRICTION_REPOSITORY,
      useClass: PrismaUserRestrictionRepository
    },
    {
      provide: SAFETY_HEURISTIC_RULE_REPOSITORY,
      useClass: PrismaSafetyHeuristicRuleRepository
    },
    {
      provide: SAFETY_POLICY_SETTINGS_REPOSITORY,
      useClass: PrismaSafetyPolicySettingsRepository
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
    {
      provide: ASSISTANT_ROLE_REPOSITORY,
      useClass: PrismaAssistantRoleRepository
    },
    {
      provide: WORKSPACE_FILE_METADATA_REPOSITORY,
      useClass: PrismaWorkspaceFileMetadataRepository
    },
    {
      provide: ASSISTANT_BROWSER_PROFILE_REPOSITORY,
      useClass: PrismaAssistantBrowserProfileRepository
    },
    ManageChatMediaService,
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
    MaterializationRolloutService,
    MaterializationRolloutWorkerService,
    SyncNativeRuntimeBundleService,
    SyncProviderGatewayWarmupService,
    CompilePromptConstructorService,
    PostgresPgvectorKnowledgeIndex,
    {
      provide: KNOWLEDGE_VECTOR_INDEX,
      useExisting: PostgresPgvectorKnowledgeIndex
    },
    ManageMediaPackageCatalogService,
    ManageMediaPackagePurchaseService,
    HeyGenProviderGatewayClient,
    ManageWorkspaceVideoPersonasService,
    ManageWorkspaceVideoClonedVoicesService,
    ReadWorkspaceVideoPersonaService,
    ReadWorkspaceVideoPreviewService,
    ReadHeygenVoiceCatalogForWorkspaceService,
    {
      provide: WORKSPACE_VIDEO_CLONED_VOICE_REPOSITORY,
      useClass: PrismaWorkspaceVideoClonedVoiceRepository
    },
    {
      provide: WORKSPACE_VIDEO_PERSONA_REPOSITORY,
      useClass: PrismaWorkspaceVideoPersonaRepository
    }
  ],
  exports: [
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
    BackgroundSchedulerMetricsService,
    ResolveActiveAssistantService,
    ASSISTANT_REPOSITORY,
    ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
    ASSISTANT_GOVERNANCE_REPOSITORY,
    ASSISTANT_CHAT_REPOSITORY,
    ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
    SchedulerLeaseService
  ]
})
export class WorkspaceManagementModule {}
