import { Module } from "@nestjs/common";
import { BundlesModule } from "../bundles/bundles.module";
import { ObservabilityModule } from "../observability/observability.module";
import { SessionsModule } from "../sessions/sessions.module";
import { RuntimeStateModule } from "../runtime-state/runtime-state.module";
import { TurnsController } from "./interface/http/turns.controller";
import { InternalRuntimeSessionsController } from "./interface/http/internal-runtime-sessions.controller";
import { InternalRuntimeBackgroundTasksController } from "./interface/http/internal-runtime-background-tasks.controller";
import { InternalRuntimeDocumentJobsController } from "./interface/http/internal-runtime-document-jobs.controller";
import { InternalRuntimeMediaJobsController } from "./interface/http/internal-runtime-media-jobs.controller";
import { AutoExtractToMemoryService } from "./auto-extract-to-memory.service";
import { IdempotencyService } from "./idempotency.service";
import { LocalBrowserBridgeClient } from "./local-browser-bridge.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeBrowserToolService } from "./runtime-browser-tool.service";
import { RuntimeStoragePlaneFilesService } from "./runtime-storage-plane-files.service";
import { RuntimeFilesToolService } from "./runtime-files-tool.service";
import { RuntimeImageEditToolService } from "./runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "./runtime-image-generate-tool.service";
import { RuntimeKnowledgeToolService } from "./runtime-knowledge-tool.service";
import { RuntimeMemoryWriteToolService } from "./runtime-memory-write-tool.service";
import { RuntimeTodoWriteToolService } from "./runtime-todo-write-tool.service";
import { RuntimeSkillToolService } from "./runtime-skill-tool.service";
import { RuntimeQuotaStatusToolService } from "./runtime-quota-status-tool.service";
import { RuntimeBackgroundTaskToolService } from "./runtime-background-task-tool.service";
import { RuntimeBackgroundTaskEvaluationService } from "./runtime-background-task-evaluation.service";
import { RuntimeDocumentProviderAdapterService } from "./runtime-document-provider-adapter.service";
import { RuntimeDocumentJobCompletionService } from "./runtime-document-job-completion.service";
import { RuntimeDocumentJobRunService } from "./runtime-document-job-run.service";
import { RuntimeDocumentToolService } from "./runtime-document-tool.service";
import { RuntimeMediaJobCompletionService } from "./runtime-media-job-completion.service";
import { RuntimeMediaJobRunService } from "./runtime-media-job-run.service";
import { RuntimeScheduledActionToolService } from "./runtime-scheduled-action-tool.service";
import { RuntimeSandboxToolService } from "./runtime-sandbox-tool.service";
import { RuntimeGrepGlobToolService } from "./runtime-grep-glob-tool.service";
import { RuntimeTtsToolService } from "./runtime-tts-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
import { SandboxClientService } from "./sandbox-client.service";
import { RuntimeBundleAutoRefreshService } from "./runtime-bundle-auto-refresh.service";
import { SessionCompactionService } from "./session-compaction.service";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import { TurnAcceptanceService } from "./turn-acceptance.service";
import { RuntimeExecutionAdmissionService } from "./runtime-execution-admission.service";
import { TurnExecutionService } from "./turn-execution.service";
import { TurnFinalizationService } from "./turn-finalization.service";
import { TurnLeaseHeartbeatService } from "./turn-lease-heartbeat.service";
import { BuildActiveScenarioBlockService } from "./build-active-scenario-block.service";
import { BuildSystemReminderBlocksService } from "./build-system-reminder-blocks.service";
import { TurnRoutingService } from "./turn-routing.service";

@Module({
  imports: [BundlesModule, RuntimeStateModule, SessionsModule, ObservabilityModule],
  controllers: [
    TurnsController,
    InternalRuntimeSessionsController,
    InternalRuntimeBackgroundTasksController,
    InternalRuntimeDocumentJobsController,
    InternalRuntimeMediaJobsController
  ],
  providers: [
    PersaiInternalApiClientService,
    LocalBrowserBridgeClient,
    ProviderGatewayClientService,
    BuildActiveScenarioBlockService,
    BuildSystemReminderBlocksService,
    RuntimeBrowserToolService,
    RuntimeDocumentToolService,
    RuntimeDocumentProviderAdapterService,
    RuntimeDocumentJobCompletionService,
    RuntimeDocumentJobRunService,
    RuntimeFilesToolService,
    RuntimeStoragePlaneFilesService,
    RuntimeImageEditToolService,
    RuntimeImageGenerateToolService,
    RuntimeKnowledgeToolService,
    RuntimeMemoryWriteToolService,
    RuntimeTodoWriteToolService,
    RuntimeSkillToolService,
    RuntimeQuotaStatusToolService,
    RuntimeVideoGenerateToolService,
    RuntimeBackgroundTaskToolService,
    RuntimeBackgroundTaskEvaluationService,
    RuntimeMediaJobCompletionService,
    RuntimeMediaJobRunService,
    RuntimeBundleAutoRefreshService,
    RuntimeScheduledActionToolService,
    RuntimeSandboxToolService,
    RuntimeGrepGlobToolService,
    RuntimeTtsToolService,
    SandboxClientService,
    IdempotencyService,
    PersaiMediaObjectStorageService,
    TurnContextHydrationService,
    AutoExtractToMemoryService,
    SessionCompactionService,
    TurnAcceptanceService,
    RuntimeExecutionAdmissionService,
    TurnRoutingService,
    TurnExecutionService,
    TurnFinalizationService,
    TurnLeaseHeartbeatService
  ],
  exports: [
    PersaiInternalApiClientService,
    LocalBrowserBridgeClient,
    ProviderGatewayClientService,
    BuildActiveScenarioBlockService,
    BuildSystemReminderBlocksService,
    RuntimeBrowserToolService,
    RuntimeDocumentToolService,
    RuntimeDocumentProviderAdapterService,
    RuntimeDocumentJobCompletionService,
    RuntimeDocumentJobRunService,
    RuntimeFilesToolService,
    RuntimeStoragePlaneFilesService,
    RuntimeImageEditToolService,
    RuntimeImageGenerateToolService,
    RuntimeKnowledgeToolService,
    RuntimeMemoryWriteToolService,
    RuntimeTodoWriteToolService,
    RuntimeSkillToolService,
    RuntimeQuotaStatusToolService,
    RuntimeVideoGenerateToolService,
    RuntimeBackgroundTaskToolService,
    RuntimeBackgroundTaskEvaluationService,
    RuntimeMediaJobCompletionService,
    RuntimeMediaJobRunService,
    RuntimeBundleAutoRefreshService,
    RuntimeScheduledActionToolService,
    RuntimeSandboxToolService,
    RuntimeGrepGlobToolService,
    RuntimeTtsToolService,
    SandboxClientService,
    IdempotencyService,
    PersaiMediaObjectStorageService,
    TurnContextHydrationService,
    AutoExtractToMemoryService,
    SessionCompactionService,
    TurnAcceptanceService,
    RuntimeExecutionAdmissionService,
    TurnRoutingService,
    TurnExecutionService,
    TurnFinalizationService,
    TurnLeaseHeartbeatService
  ]
})
export class TurnsModule {}
